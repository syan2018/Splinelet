import {
  strFromU8,
  strToU8,
  zipSync,
} from 'three/addons/libs/fflate.module.js';
import {
  CONTAINER_VERSION,
  FIXED_MTIME,
  MAX_ENTRIES,
  MAX_ARCHIVE_BYTES,
  MAX_EXPANDED_BYTES,
  MAX_MANIFEST_BYTES,
  MAX_PROJECT_BYTES,
  PROJECT_FORMAT,
  SPL_MIME,
  asBytes,
  containerFail,
  parseJson,
  sha256,
  unzipChecked,
} from '../project-container.mjs';
import { validateDocument } from './schema.mjs';
import { validateDurableRegionReferences } from './region-reference-validation.mjs';

const fail = (message) => containerFail(message);
const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const assetPath = (path) =>
  typeof path === 'string' &&
  /^assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(path);
const stableJson = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(',')}}`;
};
const bytesRecord = (value) => {
  if (!isRecord(value)) fail('assets 必须是 ID 到 Uint8Array 的对象');
  const result = {};
  for (const [assetId, bytes] of Object.entries(value)) {
    if (!(bytes instanceof Uint8Array))
      fail(`资源 ${assetId} 必须是 Uint8Array`);
    result[assetId] = bytes;
  }
  return result;
};
const descriptor = (asset) => ({
  id: asset.id,
  path: asset.path,
  mediaType: asset.mediaType,
  size: asset.size,
  sha256: asset.sha256,
});
const descriptorKey = (asset) => stableJson(descriptor(asset));
const validateAssetDescriptors = (document, resources) => {
  const ids = Object.keys(document.assets).sort();
  if (ids.length > MAX_ENTRIES - 3) fail('资源数量超过容器限额');
  if (
    Object.keys(resources).length !== ids.length ||
    Object.keys(resources).some((assetId) => !document.assets[assetId])
  )
    fail('Document.assets 与资源字节必须一一匹配');
  const paths = new Set();
  for (const assetId of ids) {
    const asset = document.assets[assetId];
    const bytes = resources[assetId];
    if (!assetPath(asset.path)) fail(`资源路径无效 ${asset.path}`);
    if (paths.has(asset.path)) fail('资源路径重复');
    paths.add(asset.path);
    if (bytes.length !== asset.size) fail(`资源 ${assetId} 大小不匹配`);
    if (sha256(bytes) !== asset.sha256) fail(`资源 ${assetId} 哈希不匹配`);
  }
  return ids.map((assetId) => descriptor(document.assets[assetId]));
};
const validateManifest = (manifest) => {
  if (!isRecord(manifest)) fail('manifest.json 结构无效');
  const allowed = new Set([
    'format',
    'containerVersion',
    'documentVersion',
    'appVersion',
    'entrypoint',
    'assets',
  ]);
  for (const key of Object.keys(manifest))
    if (!allowed.has(key)) fail(`manifest.json 含未声明字段 ${key}`);
  for (const key of [
    'format',
    'containerVersion',
    'documentVersion',
    'entrypoint',
    'assets',
  ])
    if (!Object.hasOwn(manifest, key)) fail(`manifest.json 缺少字段 ${key}`);
  if (manifest.format !== PROJECT_FORMAT) fail('工程格式标识不匹配');
  if (manifest.containerVersion !== CONTAINER_VERSION) {
    fail(
      manifest.containerVersion > CONTAINER_VERSION
        ? '需要更新版本才能打开此工程'
        : '不支持的容器版本',
    );
  }
  if (![4, 5].includes(manifest.documentVersion)) fail('不支持的文档版本');
  if (manifest.entrypoint !== 'project.json') fail('工程入口无效');
  if (
    manifest.appVersion !== undefined &&
    typeof manifest.appVersion !== 'string'
  )
    fail('appVersion 无效');
  if (
    !Array.isArray(manifest.assets) ||
    manifest.assets.length > MAX_ENTRIES - 3
  )
    fail('资源清单无效');
  const ids = new Set();
  const paths = new Set();
  for (const asset of manifest.assets) {
    if (
      !isRecord(asset) ||
      Object.keys(asset).length !== 5 ||
      !['id', 'path', 'mediaType', 'size', 'sha256'].every((key) =>
        Object.hasOwn(asset, key),
      )
    )
      fail('资源描述无效');
    if (
      typeof asset.id !== 'string' ||
      !asset.id ||
      ids.has(asset.id) ||
      !assetPath(asset.path) ||
      paths.has(asset.path) ||
      typeof asset.mediaType !== 'string' ||
      !Number.isSafeInteger(asset.size) ||
      asset.size < 0 ||
      !/^[a-f0-9]{64}$/.test(asset.sha256)
    )
      fail('资源描述无效');
    ids.add(asset.id);
    paths.add(asset.path);
  }
  return manifest;
};

export function encodeDocument(document, { assets = {}, appVersion } = {}) {
  validateDocument(document);
  validateDurableRegionReferences(document);
  if (appVersion !== undefined && typeof appVersion !== 'string')
    fail('appVersion 无效');
  const resources = bytesRecord(assets);
  const assetsManifest = validateAssetDescriptors(document, resources).sort(
    (left, right) => compareText(left.id, right.id),
  );
  const projectBytes = strToU8(stableJson(document));
  if (projectBytes.length > MAX_PROJECT_BYTES) fail('project.json 过大');
  const manifest = {
    format: PROJECT_FORMAT,
    containerVersion: CONTAINER_VERSION,
    documentVersion: document.version,
    ...(appVersion === undefined ? {} : { appVersion }),
    entrypoint: 'project.json',
    assets: assetsManifest,
  };
  const manifestBytes = strToU8(stableJson(manifest));
  if (manifestBytes.length > MAX_MANIFEST_BYTES) fail('manifest.json 过大');
  const expandedSize =
    projectBytes.length +
    manifestBytes.length +
    strToU8(SPL_MIME).length +
    assetsManifest.reduce((total, asset) => total + asset.size, 0);
  if (expandedSize > MAX_EXPANDED_BYTES) fail('解压后内容过大');
  const options = { level: 6, mtime: FIXED_MTIME };
  const entries = {
    mimetype: [strToU8(SPL_MIME), { level: 0, mtime: FIXED_MTIME }],
    'manifest.json': [manifestBytes, options],
    'project.json': [projectBytes, options],
  };
  for (const asset of [...assetsManifest].sort((left, right) =>
    compareText(left.path, right.path),
  ))
    entries[asset.path] = [resources[asset.id], options];
  const archive = zipSync(entries);
  if (archive.length > MAX_ARCHIVE_BYTES) fail('文件过大');
  return archive;
}

export function decodeDocument(input) {
  const bytes = asBytes(input);
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b))
    fail('V4 文档必须使用 ZIP 容器');
  const { entries, names } = unzipChecked(bytes);
  for (const required of ['mimetype', 'manifest.json', 'project.json'])
    if (!names.includes(required) || !entries[required])
      fail(`缺少 ${required}`);
  if (strFromU8(entries.mimetype) !== SPL_MIME) fail('MIME 类型不匹配');
  if (entries['manifest.json'].length > MAX_MANIFEST_BYTES)
    fail('manifest.json 过大');
  if (entries['project.json'].length > MAX_PROJECT_BYTES)
    fail('project.json 过大');
  const manifest = validateManifest(
    parseJson(strFromU8(entries['manifest.json']), 'manifest.json'),
  );
  const document = validateDocument(
    parseJson(strFromU8(entries['project.json']), 'project.json'),
  );
  validateDurableRegionReferences(document);
  if (document.version !== manifest.documentVersion)
    fail('工程版本与清单不一致');
  const declared = Object.keys(document.assets).sort();
  const manifestAssets = [...manifest.assets].sort((left, right) =>
    compareText(left.id, right.id),
  );
  if (
    declared.length !== manifestAssets.length ||
    !declared.every((assetId, index) => assetId === manifestAssets[index].id)
  )
    fail('project.json 与 manifest 资源不一致');
  const expectedNames = new Set(['mimetype', 'manifest.json', 'project.json']);
  const assets = {};
  for (const item of manifestAssets) {
    const asset = document.assets[item.id];
    if (!asset || descriptorKey(asset) !== descriptorKey(item))
      fail('project.json 与 manifest 资源描述不一致');
    expectedNames.add(item.path);
    const resource = entries[item.path];
    if (!resource) fail(`缺少资源 ${item.path}`);
    if (resource.length !== item.size) fail(`资源 ${item.id} 大小不匹配`);
    if (sha256(resource) !== item.sha256) fail(`资源 ${item.id} 哈希不匹配`);
    assets[item.id] = resource;
  }
  if (
    names.length !== expectedNames.size ||
    names.some((name) => !expectedNames.has(name))
  )
    fail('ZIP 包含未声明条目');
  return { document, assets };
}
