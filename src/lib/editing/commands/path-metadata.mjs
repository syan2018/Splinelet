import { effectiveNodeState } from '../../scene/hierarchy.mjs';

export const PATH_METADATA_ACTIONS = Object.freeze(['set-paths']);

const record = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const validateValue = (value) => {
  if (!record(value)) throw Error('路径元数据必须是对象');
  const keys = Object.keys(value);
  if (keys.some((key) => !['name', 'visible'].includes(key)))
    throw Error('只能修改路径名称与显示状态');
  if (Object.hasOwn(value, 'name') && typeof value.name !== 'string')
    throw Error('路径名称必须是字符串');
  if (Object.hasOwn(value, 'visible') && typeof value.visible !== 'boolean')
    throw Error('路径显示状态必须是布尔值');
  return keys;
};

const resolvePath = (document, ref) => {
  if (
    !record(ref) ||
    ref.kind !== 'path' ||
    typeof ref.sketchId !== 'string' ||
    typeof ref.id !== 'string' ||
    Object.keys(ref).some((key) => !['kind', 'sketchId', 'id'].includes(key))
  )
    throw Error('路径引用无效');
  const sketch = document.sketches[ref.sketchId];
  if (!sketch) throw Error('路径来源不存在');
  const path = sketch.paths[ref.id];
  if (!path) throw Error('路径不存在');
  if (
    !document.nodes[sketch.ownerNodeId] ||
    effectiveNodeState(document, sketch.ownerNodeId).locked
  )
    throw Error('路径所属部件不存在或已锁定');
  return { sketch, path };
};

/** Atomically updates display metadata on explicitly referenced source Paths. */
export function createPathMetadataCommand(request) {
  const action = structuredClone(request);
  return (document) => {
    if (action?.kind !== 'set-paths') throw Error('不支持的路径元数据动作');
    if (!Array.isArray(action.pathRefs)) throw Error('路径选区必须是数组');
    const fields = validateValue(action.value);
    const unique = [],
      seen = new Set();
    for (const ref of action.pathRefs) {
      const resolved = resolvePath(document, ref);
      const key = JSON.stringify([ref.sketchId, ref.id]);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({
        ref: { kind: 'path', sketchId: ref?.sketchId, id: ref?.id },
        ...resolved,
      });
    }
    for (const { path } of unique)
      for (const field of fields) path[field] = action.value[field];
    return {
      document,
      changedRefs: unique.map(({ ref }) => ref),
    };
  };
}
