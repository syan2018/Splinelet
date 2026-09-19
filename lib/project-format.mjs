import {
  strFromU8,
  strToU8,
  unzipSync,
  zipSync,
} from 'three/addons/libs/fflate.module.js';
import { validateProject } from './project.ts';

export const SPL_MIME = 'application/vnd.splinelet.project+zip';
const FORMAT = 'splinelet-project';
const CONTAINER_VERSION = 1;
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 128 * 1024 * 1024;
const MAX_PROJECT_BYTES = 16 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_ENTRIES = 16;
const FIXED_MTIME = new Date(2000, 0, 1);

const media = {
  png: { type: 'image/png', extension: 'png' },
  jpeg: { type: 'image/jpeg', extension: 'jpg' },
  webp: { type: 'image/webp', extension: 'webp' },
};

const fail = (message) => {
  throw Error(`.spl 工程无效：${message}`);
};

const asBytes = (value) => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  fail('输入必须是文本或二进制数据');
};

const parseJson = (text, label) => {
  try {
    return JSON.parse(text);
  } catch {
    fail(`${label} 不是有效 JSON`);
  }
};

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
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (!bytes.length) fail('参考图片为空');
  return { bytes, ...media[match[1]] };
};

const bytesToBase64 = (bytes) => {
  let result = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk)
    result += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(result);
};

// Small synchronous SHA-256 implementation keeps this codec usable in workers,
// browsers, and Node without making the public encode/decode API asynchronous.
const sha256 = (input) => {
  const k = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bitLength = input.length * 8;
  const paddedLength = ((input.length + 9 + 63) >> 6) << 6;
  const data = new Uint8Array(paddedLength);
  data.set(input);
  data[input.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15],
        b = w[i - 2];
      w[i] =
        (w[i - 16] +
          (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) +
          w[i - 7] +
          (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) >>>
        0;
    }
    let [a, b, c, d, e, f, g, q] = h;
    for (let i = 0; i < 64; i++) {
      const t1 =
        (q +
          (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) +
          ((e & f) ^ (~e & g)) +
          k[i] +
          w[i]) >>>
        0;
      const t2 =
        ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) +
          ((a & b) ^ (a & c) ^ (b & c))) >>>
        0;
      q = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + q) >>> 0;
  }
  return [...h].map((part) => part.toString(16).padStart(8, '0')).join('');
};

const imageMatchesType = (bytes, type) => {
  if (type === 'image/png')
    return [137, 80, 78, 71, 13, 10, 26, 10].every(
      (value, i) => bytes[i] === value,
    );
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (type === 'image/webp')
    return (
      strFromU8(bytes.subarray(0, 4)) === 'RIFF' &&
      strFromU8(bytes.subarray(8, 12)) === 'WEBP'
    );
  return false;
};

const zipEntryNames = (bytes) => {
  let end = bytes.length - 22;
  const min = Math.max(0, bytes.length - 65557);
  while (
    end >= min &&
    new DataView(bytes.buffer, bytes.byteOffset).getUint32(end, true) !==
      0x06054b50
  )
    end--;
  if (end < min) fail('ZIP 目录损坏');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(end + 10, true);
  const directorySize = view.getUint32(end + 12, true);
  let cursor = view.getUint32(end + 16, true);
  if (count > MAX_ENTRIES) fail('ZIP 条目过多');
  if (cursor + directorySize > end) fail('ZIP 目录越界');
  const names = [];
  let expanded = 0;
  for (let i = 0; i < count; i++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) fail('ZIP 目录损坏');
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    expanded += view.getUint32(cursor + 24, true);
    if (expanded > MAX_EXPANDED_BYTES) fail('解压后内容过大');
    const name = strFromU8(
      bytes.subarray(cursor + 46, cursor + 46 + nameLength),
    );
    if (
      !name ||
      name.includes('\\') ||
      name.startsWith('/') ||
      name.split('/').some((part) => part === '..' || part === '')
    )
      fail('ZIP 包含不安全路径');
    if (names.includes(name)) fail('ZIP 包含重复条目');
    names.push(name);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== view.getUint32(end + 16, true) + directorySize)
    fail('ZIP 目录长度无效');
  return names;
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
    format: FORMAT,
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
  if (bytes.length > MAX_ARCHIVE_BYTES) fail('文件过大');
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b))
    return validateProject(parseJson(strFromU8(bytes), '旧版工程'));
  const names = zipEntryNames(bytes);
  let entries;
  try {
    entries = unzipSync(bytes);
  } catch {
    fail('ZIP 数据损坏');
  }
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
  if (manifest.format !== FORMAT) fail('工程格式标识不匹配');
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
