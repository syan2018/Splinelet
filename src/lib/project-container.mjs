import { strFromU8, unzipSync } from 'three/addons/libs/fflate.module.js';

export const SPL_MIME = 'application/vnd.splinelet.project+zip';
export const PROJECT_FORMAT = 'splinelet-project';
export const CONTAINER_VERSION = 1;
export const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
export const MAX_EXPANDED_BYTES = 128 * 1024 * 1024;
export const MAX_PROJECT_BYTES = 16 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 1024 * 1024;
export const MAX_ENTRIES = 16;
export const FIXED_MTIME = new Date(2000, 0, 1);

export const containerFail = (message) => {
  throw Error(`.spl 工程无效：${message}`);
};
export const asBytes = (value) => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  containerFail('输入必须是文本或二进制数据');
};
export const parseJson = (text, label) => {
  try {
    return JSON.parse(text);
  } catch {
    containerFail(`${label} 不是有效 JSON`);
  }
};

// Synchronous SHA-256 keeps codecs usable in browsers, workers, and Node.
export const sha256 = (input) => {
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
    for (let i = 16; i < 64; i++)
      w[i] =
        (w[i - 16] +
          (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) +
          w[i - 7] +
          (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10))) >>>
        0;
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

const safeEntryName = (name) => {
  if (
    !name ||
    name.includes('\\') ||
    name.includes('\0') ||
    name.startsWith('/') ||
    /^[A-Za-z]:/.test(name)
  )
    return false;
  return name.split('/').every((part) => part && part !== '.' && part !== '..');
};
const readEndOfDirectory = (bytes) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimum = Math.max(0, bytes.length - 65557);
  for (let offset = bytes.length - 22; offset >= minimum; offset--) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength !== bytes.length) continue;
    if (
      view.getUint16(offset + 4, true) !== 0 ||
      view.getUint16(offset + 6, true) !== 0
    )
      containerFail('不支持多磁盘 ZIP');
    const count = view.getUint16(offset + 10, true);
    const size = view.getUint32(offset + 12, true);
    const directoryOffset = view.getUint32(offset + 16, true);
    if (
      count === 0xffff ||
      size === 0xffffffff ||
      directoryOffset === 0xffffffff
    )
      containerFail('不支持 ZIP64');
    if (count > MAX_ENTRIES || directoryOffset + size > offset)
      containerFail(count > MAX_ENTRIES ? 'ZIP 条目过多' : 'ZIP 目录越界');
    return { view, offset, count, size, directoryOffset };
  }
  containerFail('ZIP 目录损坏');
};

export const inspectZip = (input) => {
  const bytes = asBytes(input);
  if (bytes.length > MAX_ARCHIVE_BYTES) containerFail('文件过大');
  const { view, count, size, directoryOffset } = readEndOfDirectory(bytes);
  const entries = [];
  const names = new Set();
  const localRanges = [];
  let cursor = directoryOffset;
  let expanded = 0;
  for (let index = 0; index < count; index++) {
    if (
      cursor + 46 > directoryOffset + size ||
      view.getUint32(cursor, true) !== 0x02014b50
    )
      containerFail('ZIP 目录损坏');
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (
      next > directoryOffset + size ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff
    )
      containerFail('ZIP 目录损坏');
    if (flags & 1 || ![0, 8].includes(method))
      containerFail('ZIP 压缩方式不受支持');
    const name = strFromU8(
      bytes.subarray(cursor + 46, cursor + 46 + nameLength),
    );
    if (!safeEntryName(name)) containerFail('ZIP 包含不安全路径');
    if (names.has(name)) containerFail('ZIP 包含重复条目');
    names.add(name);
    if (name === 'project.json' && uncompressedSize > MAX_PROJECT_BYTES)
      containerFail('project.json 过大');
    if (name === 'manifest.json' && uncompressedSize > MAX_MANIFEST_BYTES)
      containerFail('manifest.json 过大');
    expanded += uncompressedSize;
    if (expanded > MAX_EXPANDED_BYTES) containerFail('解压后内容过大');
    if (
      localOffset + 30 > directoryOffset ||
      view.getUint32(localOffset, true) !== 0x04034b50
    )
      containerFail('ZIP 本地条目损坏');
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const localName = strFromU8(
      bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength),
    );
    if (localName !== name || dataOffset + compressedSize > directoryOffset)
      containerFail('ZIP 本地条目越界');
    localRanges.push([localOffset, dataOffset + compressedSize]);
    entries.push({ name, compressedSize, uncompressedSize, method });
    cursor = next;
  }
  if (cursor !== directoryOffset + size) containerFail('ZIP 目录长度无效');
  localRanges.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < localRanges.length; i++)
    if (localRanges[i][0] < localRanges[i - 1][1])
      containerFail('ZIP 条目重叠');
  return { bytes, entries };
};

export const unzipChecked = (input) => {
  const inspected = inspectZip(input);
  let files;
  try {
    files = unzipSync(inspected.bytes);
  } catch {
    containerFail('ZIP 数据损坏');
  }
  let expanded = 0;
  for (const entry of inspected.entries) {
    const file = files[entry.name];
    if (!file || file.length !== entry.uncompressedSize)
      containerFail('ZIP 解压尺寸不匹配');
    expanded += file.length;
    if (expanded > MAX_EXPANDED_BYTES) containerFail('解压后内容过大');
  }
  if (Object.keys(files).length !== inspected.entries.length)
    containerFail('ZIP 解压条目不匹配');
  return {
    entries: files,
    names: inspected.entries.map((entry) => entry.name),
  };
};
