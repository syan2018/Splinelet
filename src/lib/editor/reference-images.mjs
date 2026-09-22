import { sha256, MAX_ENTRIES } from '../project-container.mjs';
import { orderedReferences } from '../editing/commands/references.mjs';

const extensions = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
export const MAX_REFERENCE_PIXELS = 48 * 1024 * 1024;
export const MAX_REFERENCE_BYTES = 48 * 1024 * 1024;

/** Bytes stay outside Document/history. Images are independent world-space guides. */
export function prepareReferenceImages(document, frame, images) {
  if (!Array.isArray(images) || !images.length) throw Error('请选择参考图');
  if (Object.keys(document.references).length + images.length > 32)
    throw Error('最多放置 32 张参考图');
  const assets = [],
    references = [],
    bytes = {};
  let pixels = Object.values(document.references).reduce(
    (sum, ref) => sum + ref.pixelWidth * ref.pixelHeight,
    0,
  );
  let size = Object.values(document.assets).reduce(
    (sum, asset) => sum + asset.size,
    0,
  );
  let order = Math.max(
    0,
    ...orderedReferences(document).map((ref) => ref.order || 0),
  );
  for (const image of images) {
    const { width, height, name, mediaType } = image;
    if (
      !Object.hasOwn(extensions, mediaType) ||
      !(image.bytes instanceof Uint8Array) ||
      !image.bytes.length ||
      !Number.isInteger(width) ||
      width < 1 ||
      width > 4096 ||
      !Number.isInteger(height) ||
      height < 1 ||
      height > 4096 ||
      typeof name !== 'string' ||
      !name.trim()
    )
      throw Error('参考图数据无效');
    pixels += width * height;
    if (pixels > MAX_REFERENCE_PIXELS)
      throw Error('参考图总像素超过 48 MP，请缩小图片后再添加');
    const hash = sha256(image.bytes);
    let asset = [...Object.values(document.assets), ...assets].find(
      (item) => item.sha256 === hash && item.mediaType === mediaType,
    );
    if (!asset) {
      size += image.bytes.length;
      if (
        size > MAX_REFERENCE_BYTES ||
        Object.keys(document.assets).length + assets.length >= MAX_ENTRIES - 3
      )
        throw Error('参考图资源超出工程容量（最多 13 个资源、共 48 MB）');
      const id = crypto.randomUUID();
      asset = {
        id,
        path: `assets/${id}.${extensions[mediaType]}`,
        mediaType,
        size: image.bytes.length,
        sha256: hash,
      };
      assets.push(asset);
      bytes[id] = image.bytes.slice();
    }
    const scale =
      ((Math.min(frame.width / width, frame.height / height) * frame.widthMM) /
        frame.width) *
      0.65;
    references.push({
      id: crypto.randomUUID(),
      assetId: asset.id,
      name,
      pixelWidth: width,
      pixelHeight: height,
      pixelToWorld: [
        scale,
        0,
        0,
        -scale,
        (-width * scale) / 2,
        (height * scale) / 2,
      ],
      role: 'overlay',
      order: ++order,
      visible: true,
      locked: false,
      opacity: 1,
    });
  }
  return { assets, references, bytes };
}

/** Decode sequentially in the UI so large multi-file imports do not spike memory. */
export async function readReferenceImage(file) {
  if (!Object.hasOwn(extensions, file.type))
    throw Error('请导入 PNG、JPG 或 WebP 图片');
  if (file.size > 30 * 1024 * 1024) throw Error('单张图片不能超过 30 MB');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    let width = image.naturalWidth,
      height = image.naturalHeight;
    if (!width || !height || width * height > 100 * 1024 * 1024)
      throw Error('图片像素过大或尺寸无效');
    let blob = file;
    if (Math.max(width, height) > 4096) {
      const scale = 4096 / Math.max(width, height);
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(image, 0, 0, width, height);
      blob = await new Promise((resolve, reject) =>
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(Error('图片缩放失败'))),
          'image/png',
        ),
      );
    }
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mediaType: blob.type,
      name: file.name,
      width,
      height,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
