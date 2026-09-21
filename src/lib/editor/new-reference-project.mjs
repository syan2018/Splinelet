import { createDocument, validateDocument } from '../document/schema.mjs';
import { sha256 } from '../project-container.mjs';
import { createSourceViewFrame } from './source-view.mjs';

/** Create an empty authoritative document from decoded image metadata and bytes. */
export function createReferenceProject({
  bytes,
  mediaType,
  name,
  width,
  height,
  widthMM = 100,
}) {
  const extensions = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
  };
  const extension = extensions[mediaType];
  if (
    !Object.hasOwn(extensions, mediaType) ||
    !(bytes instanceof Uint8Array) ||
    !bytes.length
  )
    throw Error('新工程需要 PNG、JPG 或 WebP 图片字节');
  const frame = createSourceViewFrame({ width, height, widthMM });
  const document = createDocument();
  document.sourceFrame = { width, height, widthMM };
  const assetId = crypto.randomUUID();
  const referenceId = crypto.randomUUID();
  const ownedBytes = bytes.slice();
  document.assets[assetId] = {
    id: assetId,
    path: `assets/reference.${extension}`,
    mediaType,
    size: ownedBytes.length,
    sha256: sha256(ownedBytes),
  };
  document.references[referenceId] = {
    id: referenceId,
    assetId,
    name,
    pixelWidth: width,
    pixelHeight: height,
    pixelToWorld: frame.pixelToWorld,
    visible: true,
    locked: true,
    opacity: 1,
  };
  validateDocument(document);
  return {
    kind: 'v4',
    document,
    assets: { [assetId]: ownedBytes },
    target: null,
    dirty: true,
  };
}
