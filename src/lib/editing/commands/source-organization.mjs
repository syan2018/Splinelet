import { validateDocument } from '../../document/schema.mjs';
import { effectiveNodeState } from '../../scene/hierarchy.mjs';

export const SOURCE_ORGANIZATION_ACTIONS = Object.freeze([
  'create-path-collection',
  'assign-path-collection',
  'rename-collection',
  'delete-collection',
  'reorder-source-paths',
]);

const record = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const ACTION_FIELDS = Object.freeze({
  'create-path-collection': ['kind', 'name', 'pathRefs'],
  'assign-path-collection': ['kind', 'collectionId', 'pathRefs'],
  'rename-collection': ['kind', 'collectionId', 'name'],
  'delete-collection': ['kind', 'collectionId'],
  'reorder-source-paths': ['kind', 'pathRefs'],
});
const collectionRef = (id) => ({ kind: 'collection', id });
const pathRef = (sketchId, id) => ({ kind: 'path', sketchId, id });
const pathKey = (ref) => JSON.stringify([ref.sketchId, ref.id]);
const name = (value) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 80)
    throw Error('集合名称需要 1–80 个字符');
  return value.trim();
};

const requireCollection = (document, id) => {
  if (typeof id !== 'string' || !document.collections[id])
    throw Error(`Collection 不存在：${id}`);
  return document.collections[id];
};

const requirePathRef = (document, value) => {
  if (
    !record(value) ||
    value.kind !== 'path' ||
    typeof value.sketchId !== 'string' ||
    typeof value.id !== 'string' ||
    Object.keys(value).some((key) => !['kind', 'sketchId', 'id'].includes(key))
  )
    throw Error('PathRef 无效');
  const sketch = document.sketches[value.sketchId];
  if (!sketch?.paths[value.id]) throw Error('PathRef 指向的 Path 不存在');
  if (effectiveNodeState(document, sketch.ownerNodeId).locked)
    throw Error('Path 所属部件已锁定');
  return pathRef(sketch.id, value.id);
};

const uniquePathRefs = (document, values, { complete = false } = {}) => {
  if (!Array.isArray(values)) throw Error('pathRefs 必须是数组');
  const refs = values.map((value) => requirePathRef(document, value));
  const keys = refs.map(pathKey);
  if (new Set(keys).size !== keys.length) throw Error('pathRefs 不能重复');
  if (complete) {
    const current = Object.values(document.sketches).flatMap((sketch) =>
      Object.keys(sketch.paths).map((id) =>
        pathKey({ sketchId: sketch.id, id }),
      ),
    );
    if (
      keys.length !== current.length ||
      current.some((key) => !keys.includes(key))
    )
      throw Error('reorder-source-paths 必须完整列出所有现有 Path');
  }
  return refs;
};

const collectIds = (document) => {
  const result = new Set();
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    if (typeof value.id === 'string') result.add(value.id);
    Object.values(value).forEach(visit);
  };
  visit(document);
  return result;
};
const newId = (document, idFactory) => {
  if (typeof idFactory !== 'function') throw Error('idFactory 必须是函数');
  const id = idFactory();
  if (typeof id !== 'string' || !id.trim() || collectIds(document).has(id))
    throw Error('Collection ID 无效或重复');
  return id;
};

const nextCollectionOrder = (document) => {
  const values = Object.values(document.collections).map(
    (item) => item.order ?? 0,
  );
  const maximum = values.reduce((max, value) => Math.max(max, value), -1);
  const order = maximum + 1;
  if (!Number.isFinite(order) || order <= maximum)
    throw Error('无法分配 Collection.order');
  return order;
};

const assertActionFields = (action) => {
  const fields = ACTION_FIELDS[action?.kind];
  if (!fields) return;
  const keys = Object.keys(action);
  if (
    keys.length !== fields.length ||
    keys.some((key) => !fields.includes(key))
  )
    throw Error(`${action.kind} 请求字段无效`);
};

const memberOwners = (document, member) => {
  if (member.kind === 'node') return [member.id];
  if (member.kind === 'output') return [member.ownerNodeId];
  if (['path', 'vertex', 'edge', 'edge-end'].includes(member.kind)) {
    const ownerNodeId = document.sketches[member.sketchId]?.ownerNodeId;
    return ownerNodeId ? [ownerNodeId] : [];
  }
  if (member.kind === 'program') {
    const ownerNodeId = document.programs[member.id]?.ownerNodeId;
    return ownerNodeId ? [ownerNodeId] : [];
  }
  if (member.kind === 'datum') {
    const ownerNodeId = document.datums[member.id]?.ownerNodeId;
    return ownerNodeId ? [ownerNodeId] : [];
  }
  if (member.kind === 'parameter') {
    const ownerNodeId = document.parameters[member.id]?.ownerNodeId;
    return ownerNodeId ? [ownerNodeId] : [];
  }
  if (member.kind === 'relation') {
    const relation = document.relations[member.id];
    if (!relation) return [];
    return [relation.target, relation.source]
      .filter(Boolean)
      .flatMap((target) => memberOwners(document, target));
  }
  return [];
};

const assertCollectionMembersWritable = (document, collection) => {
  const owners = new Set(
    collection.members.flatMap((member) => memberOwners(document, member)),
  );
  for (const ownerNodeId of owners)
    if (
      document.nodes[ownerNodeId] &&
      effectiveNodeState(document, ownerNodeId).locked
    )
      throw Error('Collection 含已锁定部件的成员，不能删除');
};

const pathOnlyCollection = (collection) =>
  collection.members.every((member) => member.kind === 'path');

const assignPathCollection = (document, collectionId, refs) => {
  if (collectionId !== null && typeof collectionId !== 'string')
    throw Error('collectionId 必须是 string 或 null');
  const target =
    collectionId === null ? null : requireCollection(document, collectionId);
  if (target && !pathOnlyCollection(target))
    throw Error('目标 Collection 必须只包含 Path');

  const selected = new Set(refs.map(pathKey));
  const pathCollections = Object.values(document.collections).filter(
    pathOnlyCollection,
  );
  const changedCollectionIds = [];
  for (const collection of pathCollections) {
    if (collection === target) continue;
    const members = collection.members.filter(
      (member) => !selected.has(pathKey(member)),
    );
    if (members.length !== collection.members.length) {
      collection.members = members;
      changedCollectionIds.push(collection.id);
    }
  }
  if (target) {
    const current = new Set(target.members.map(pathKey));
    const missing = refs.filter((ref) => !current.has(pathKey(ref)));
    if (missing.length) {
      target.members.push(...missing);
      changedCollectionIds.push(target.id);
    }
  }
  return changedCollectionIds;
};

/** Edits source-list organization without moving or rewriting source geometry. */
export function createSourceOrganizationCommand(request) {
  const action = structuredClone(request);
  return (document, { idFactory } = {}) => {
    assertActionFields(action);
    validateDocument(document);
    let changedRefs;
    if (action?.kind === 'create-path-collection') {
      const refs = uniquePathRefs(document, action.pathRefs);
      const collectionName = name(action.name);
      const order = nextCollectionOrder(document);
      const id = newId(document, idFactory);
      document.collections[id] = {
        id,
        name: collectionName,
        members: refs,
        origin: 'user',
        order,
      };
      changedRefs = [collectionRef(id), ...refs];
    } else if (action?.kind === 'assign-path-collection') {
      const refs = uniquePathRefs(document, action.pathRefs);
      const changedCollectionIds = assignPathCollection(
        document,
        action.collectionId,
        refs,
      );
      changedRefs = [
        ...refs,
        ...changedCollectionIds.map((id) => collectionRef(id)),
      ];
    } else if (action?.kind === 'rename-collection') {
      const collection = requireCollection(document, action.collectionId);
      collection.name = name(action.name);
      changedRefs = [collectionRef(collection.id)];
    } else if (action?.kind === 'delete-collection') {
      const collection = requireCollection(document, action.collectionId);
      assertCollectionMembersWritable(document, collection);
      delete document.collections[collection.id];
      changedRefs = [collectionRef(collection.id)];
    } else if (action?.kind === 'reorder-source-paths') {
      const refs = uniquePathRefs(document, action.pathRefs, {
        complete: true,
      });
      refs.forEach((item, order) => {
        document.sketches[item.sketchId].paths[item.id].order = order;
      });
      changedRefs = refs;
    } else throw Error(`不支持的源组织动作：${action?.kind}`);
    validateDocument(document);
    return { document, changedRefs };
  };
}
