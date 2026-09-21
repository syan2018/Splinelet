import { MAX_ARCHIVE_BYTES } from '../project-container.mjs';

/** Convert the public load envelope to the same bytes used by file opening.
 * Decoding, migration and resource validation remain the file pipeline's job.
 */
export function readAgentProjectInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw Error('load_project 需要 project 或 base64');
  const hasProject = Object.hasOwn(input, 'project');
  const hasBase64 = Object.hasOwn(input, 'base64');
  if (
    hasProject === hasBase64 ||
    Object.keys(input).some(
      (key) => !['project', 'base64', 'filename'].includes(key),
    )
  )
    throw Error('project 与 base64 必须且只能提供一个');
  const name = input.filename ?? 'API 导入工程.spl';
  if (typeof name !== 'string' || !name.trim() || name.length > 255)
    throw Error('filename 必须为 1–255 个字符');
  if (hasProject) {
    if (
      !input.project ||
      typeof input.project !== 'object' ||
      Array.isArray(input.project)
    )
      throw Error('project 必须为旧版工程对象；V4 请提供完整 .spl 的 base64');
    return { bytes: JSON.stringify(input.project), name };
  }
  const encoded = input.base64;
  if (
    typeof encoded !== 'string' ||
    !encoded.length ||
    encoded.length > Math.ceil(MAX_ARCHIVE_BYTES / 3) * 4 ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  )
    throw Error('base64 必须为有效且不超过工程大小限制的 .spl 数据');
  const binary = atob(encoded);
  return {
    bytes: Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    name,
  };
}
