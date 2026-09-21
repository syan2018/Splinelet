import {
  strFromU8,
  strToU8,
  zipSync,
} from 'three/addons/libs/fflate.module.js';
import { validateProject } from './project.ts';
import {
  CONTAINER_VERSION,
  FIXED_MTIME,
  MAX_MANIFEST_BYTES,
  MAX_PROJECT_BYTES,
  PROJECT_FORMAT,
  SPL_MIME,
  asBytes,
  containerFail,
  parseJson,
  sha256,
  unzipChecked,
} from './project-container.mjs';

export { SPL_MIME };

const media = {
  png: { type: 'image/png', extension: 'png' },
  jpeg: { type: 'image/jpeg', extension: 'jpg' },
  webp: { type: 'image/webp', extension: 'webp' },
};
const fail = containerFail;
const parseDataUrl = (value) => {
  const match =
    /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match) fail('参考图片必须是 PNG、JPEG 或 WebP data URL');
  let binary;
  try {
    binary = atob(match[2]);
  } catch {
    fail('参考图片的 base64 数据无效');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index);
  if (!bytes.length) fail('参考图片为空');
  return { bytes, ...media[match[1]] };
};
const bytesToBase64 = (bytes) => {
  let result = '';
  for (let index = 0; index < bytes.length; index += 0x8000)
    result += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(result);
};
const imageMatchesType = (bytes, type) => {
  if (type === 'image/png')
    return [137, 80, 78, 71, 13, 10, 26, 10].every(
      (value, index) => bytes[index] === value,
    );
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8;
  return (
    type === 'image/webp' &&
    strFromU8(bytes.subarray(0, 4)) === 'RIFF' &&
    strFromU8(bytes.subarray(8, 12)) === 'WEBP'
  );
};

export function encodeProject(project, { appVersion } = {}) {
  validateProject(project);
  const asset = parseDataUrl(project.image);
  if (!imageMatchesType(asset.bytes, asset.type))
    fail('参考图片内容与媒体类型不符');
  const assetPath = `assets/reference.${asset.extension}`;
  const storedProject = structuredClone(project);
  storedProject.image = { asset: 'reference' };
  const projectBytes = strToU8(JSON.stringify(storedProject));
  if (projectBytes.length > MAX_PROJECT_BYTES) fail('project.json 过大');
  const manifest = {
    format: PROJECT_FORMAT,
    containerVersion: CONTAINER_VERSION,
    documentVersion: project.version,
    ...(appVersion === undefined ? {} : { appVersion }),
    entrypoint: 'project.json',
    assets: [
      {
        id: 'reference',
        path: assetPath,
        mediaType: asset.type,
        size: asset.bytes.length,
        sha256: sha256(asset.bytes),
      },
    ],
  };
  const options = { level: 6, mtime: FIXED_MTIME };
  return zipSync({
    mimetype: [strToU8(SPL_MIME), { level: 0, mtime: FIXED_MTIME }],
    'manifest.json': [strToU8(JSON.stringify(manifest)), options],
    'project.json': [projectBytes, options],
    [assetPath]: [asset.bytes, options],
  });
}

export function decodeProject(input) {
  if (typeof input === 'string')
    return validateProject(parseJson(input, '旧版工程'));
  const bytes = asBytes(input);
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b))
    return validateProject(parseJson(strFromU8(bytes), '旧版工程'));
  const { entries, names } = unzipChecked(bytes);
  for (const required of ['mimetype', 'manifest.json', 'project.json'])
    if (!names.includes(required) || !entries[required])
      fail(`缺少 ${required}`);
  if (strFromU8(entries.mimetype) !== SPL_MIME) fail('MIME 类型不匹配');
  if (entries['manifest.json'].length > MAX_MANIFEST_BYTES)
    fail('manifest.json 过大');
  if (entries['project.json'].length > MAX_PROJECT_BYTES)
    fail('project.json 过大');
  const manifest = parseJson(
    strFromU8(entries['manifest.json']),
    'manifest.json',
  );
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
    fail('manifest.json 结构无效');
  if (manifest.format !== PROJECT_FORMAT) fail('工程格式标识不匹配');
  if (manifest.containerVersion !== CONTAINER_VERSION)
    fail(
      manifest.containerVersion > CONTAINER_VERSION
        ? '需要更新版本才能打开此工程'
        : '不支持的容器版本',
    );
  if (manifest.entrypoint !== 'project.json') fail('工程入口无效');
  if (!Array.isArray(manifest.assets) || manifest.assets.length !== 1)
    fail('资源清单无效');
  const descriptor = manifest.assets[0];
  if (
    !descriptor ||
    descriptor.id !== 'reference' ||
    typeof descriptor.path !== 'string' ||
    !/^assets\/reference\.(png|jpg|webp)$/.test(descriptor.path) ||
    !['image/png', 'image/jpeg', 'image/webp'].includes(descriptor.mediaType) ||
    !Number.isSafeInteger(descriptor.size) ||
    descriptor.size < 1 ||
    typeof descriptor.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(descriptor.sha256)
  )
    fail('参考图片资源描述无效');
  const asset = entries[descriptor.path];
  if (!asset) fail('缺少参考图片资源');
  if (asset.length !== descriptor.size) fail('参考图片大小不匹配');
  if (sha256(asset) !== descriptor.sha256) fail('参考图片哈希不匹配');
  if (!imageMatchesType(asset, descriptor.mediaType))
    fail('参考图片内容与媒体类型不符');
  const storedProject = parseJson(
    strFromU8(entries['project.json']),
    'project.json',
  );
  if (
    !storedProject ||
    typeof storedProject !== 'object' ||
    Array.isArray(storedProject) ||
    !storedProject.image ||
    typeof storedProject.image !== 'object' ||
    storedProject.image.asset !== 'reference'
  )
    fail('project.json 的参考图片引用无效');
  storedProject.image = `data:${descriptor.mediaType};base64,${bytesToBase64(asset)}`;
  if (manifest.documentVersion !== storedProject.version)
    fail('工程版本与清单不一致');
  return validateProject(storedProject);
}
