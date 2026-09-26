import { sha256 } from '../project-container.mjs';
import { createSourceViewFrame } from './source-view.mjs';
import {
  baseReference,
  orderedReferences,
} from '../editing/commands/references.mjs';

const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const near = (a, b) =>
  Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/** Owns one reference image URL for the original, centered pixel canvas.
 * Reads persisted source calibration; no URL or transient display preferences
 * are written into Document or asset bytes.
 */
export function createStudioPresentation(opened, options, urls = URL) {
  const {
    referenceId,
    frame: suppliedFrame,
    fileName,
    blenderExtrusionMM,
  } = options;
  if (
    !(fileName === null || typeof fileName === 'string') ||
    !Number.isFinite(blenderExtrusionMM) ||
    blenderExtrusionMM < 0 ||
    blenderExtrusionMM > 1000
  )
    throw Error('参考图展示需要明确的文件名和 Blender 挤出厚度');
  const references = Object.values(opened.document.references);
  let reference = null;
  if (referenceId !== null) {
    if (referenceId !== undefined) {
      reference = opened.document.references[referenceId];
      if (!reference) throw Error('所选参考图不存在');
    } else {
      reference = baseReference(opened.document);
    }
  }
  const frame = structuredClone(
    opened.document.sourceFrame ||
      suppliedFrame ||
      (reference && {
        width: reference.pixelWidth,
        height: reference.pixelHeight,
        widthMM: reference.pixelWidth * reference.pixelToWorld[0],
      }),
  );
  const sourceFrame = createSourceViewFrame(frame);
  if (
    reference &&
    (reference.pixelWidth !== frame.width ||
      reference.pixelHeight !== frame.height ||
      !reference.pixelToWorld.every((value, index) =>
        near(value, sourceFrame.pixelToWorld[index]),
      ))
  )
    throw Error('当前参考图仿射无法由原 Studio 坐标系精确显示');
  const assetUrls = {};
  const pixelCounts = {};
  const byteCounts = {};
  let released = false;
  const addAssets = (descriptors, resources, imageReferences = []) => {
    if (released) throw Error('参考图资源已释放');
    const created = {};
    const addedPixels = {},
      addedBytes = {};
    for (const asset of descriptors) {
      if (!asset || assetUrls[asset.id]) continue;
      addedBytes[asset.id] = asset.size;
      addedPixels[asset.id] = Math.max(
        0,
        ...imageReferences
          .filter((ref) => ref.assetId === asset.id)
          .map((ref) => ref.pixelWidth * ref.pixelHeight),
      );
    }
    // Deleted images remain reachable from undo. Bound the whole lease, not just
    // the current document, so repeated import/delete cannot grow without limit.
    if (
      Object.keys(assetUrls).length &&
      (Object.keys(assetUrls).length + Object.keys(addedBytes).length > 128 ||
        [...Object.values(byteCounts), ...Object.values(addedBytes)].reduce(
          (a, b) => a + b,
          0,
        ) >
          96 * 1024 * 1024 ||
        [...Object.values(pixelCounts), ...Object.values(addedPixels)].reduce(
          (a, b) => a + b,
          0,
        ) >
          96 * 1024 * 1024)
    )
      throw Error('参考图撤销缓存已达上限，请保存并重新打开工程后再添加');
    try {
      for (const asset of descriptors) {
        if (!asset) throw Error('参考图资源缺失');
        if (assetUrls[asset.id] || created[asset.id]) continue;
        const bytes = resources?.[asset.id];
        if (
          !(bytes instanceof Uint8Array) ||
          bytes.length !== asset.size ||
          sha256(bytes) !== asset.sha256
        )
          throw Error('参考图资源缺失或校验失败');
        if (!asset.mediaType.startsWith('image/'))
          throw Error('参考图资源不是图片');
        created[asset.id] = urls.createObjectURL(
          new Blob([bytes], { type: asset.mediaType }),
        );
      }
    } catch (error) {
      Object.values(created).forEach((url) => urls.revokeObjectURL(url));
      throw error;
    }
    Object.assign(assetUrls, created);
    Object.assign(pixelCounts, addedPixels);
    Object.assign(byteCounts, addedBytes);
    return {
      assetUrls: { ...assetUrls },
      rollback() {
        for (const [id, url] of Object.entries(created)) {
          urls.revokeObjectURL(url);
          delete assetUrls[id];
          delete pixelCounts[id];
          delete byteCounts[id];
        }
      },
    };
  };
  addAssets(
    references.map((item) => opened.document.assets[item.assetId]),
    opened.assets,
    references,
  );
  const presentation = freeze({
    reference: reference
      ? { ...structuredClone(reference), url: assetUrls[reference.assetId] }
      : null,
    references: orderedReferences(opened.document).map((item) => ({
      ...structuredClone(item),
      url: assetUrls[item.assetId],
    })),
    assetUrls: { ...assetUrls },
    frame,
    fileName,
    blenderExtrusionMM,
  });
  return Object.freeze({
    presentation,
    addAssets,
    dispose() {
      if (released) return;
      released = true;
      Object.values(assetUrls).forEach((url) => urls.revokeObjectURL(url));
    },
  });
}
