import { sha256 } from '../project-container.mjs';
import { createSourceViewFrame } from './source-view.mjs';

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
      if (references.length > 1) throw Error('多个参考图需要明确选择展示对象');
      reference = references[0] || null;
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
  let url;
  if (reference) {
    const asset = opened.document.assets[reference.assetId];
    const bytes = opened.assets?.[reference.assetId];
    if (
      !asset ||
      !(bytes instanceof Uint8Array) ||
      bytes.length !== asset.size ||
      sha256(bytes) !== asset.sha256
    )
      throw Error('参考图资源缺失或校验失败');
    if (!asset.mediaType.startsWith('image/'))
      throw Error('参考图资源不是图片');
    url = urls.createObjectURL(new Blob([bytes], { type: asset.mediaType }));
  }
  const presentation = freeze({
    reference: reference ? { ...structuredClone(reference), url } : null,
    frame,
    fileName,
    blenderExtrusionMM,
  });
  let released = false;
  return Object.freeze({
    presentation,
    dispose() {
      if (released) return;
      released = true;
      if (url) urls.revokeObjectURL(url);
    },
  });
}
