import { validateDocument } from '../document/schema.mjs';
import {
  identityTransform,
  inverseTransform,
  matrixPose,
  multiplyTransforms,
  worldMatrix,
} from './transforms.mjs';

const getNode = (document, id) => {
  if (typeof id !== 'string' || !Object.hasOwn(document.nodes, id))
    throw Error(`场景节点不存在：${id}`);
  const node = document.nodes[id];
  if (!node) throw Error(`场景节点不存在：${id}`);
  return node;
};

export function childrenOf(document, parentId) {
  return Object.values(document.nodes)
    .filter((node) => node.parentId === parentId)
    .sort(
      (left, right) =>
        left.order - right.order ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
}

export function ancestorsOf(document, nodeId) {
  const ancestors = [];
  const seen = new Set([nodeId]);
  let current = getNode(document, nodeId);
  while (current.parentId !== null) {
    if (seen.has(current.parentId)) throw Error('场景父链存在循环');
    seen.add(current.parentId);
    current = getNode(document, current.parentId);
    if (current.kind !== 'group') throw Error('场景父级必须是组');
    ancestors.push(current.id);
  }
  return ancestors;
}

export function selectedRoots(document, ids) {
  if (!Array.isArray(ids)) throw Error('节点选区必须是数组');
  const unique = [...new Set(ids)];
  const selection = new Set(unique);
  for (const id of unique) getNode(document, id);
  return unique.filter(
    (id) =>
      !ancestorsOf(document, id).some((ancestor) => selection.has(ancestor)),
  );
}

export function descendantsOf(document, nodeId) {
  getNode(document, nodeId);
  const byParent = new Map();
  for (const node of Object.values(document.nodes)) {
    if (!byParent.has(node.parentId)) byParent.set(node.parentId, []);
    byParent.get(node.parentId).push(node.id);
  }
  const result = [];
  const seen = new Set([nodeId]);
  const pending = [...(byParent.get(nodeId) || [])];
  for (let index = 0; index < pending.length; index++) {
    const id = pending[index];
    if (seen.has(id)) throw Error('场景父链存在循环');
    seen.add(id);
    result.push(id);
    pending.push(...(byParent.get(id) || []));
  }
  return result;
}

export function effectiveNodeState(document, nodeId) {
  const chain = [nodeId, ...ancestorsOf(document, nodeId)].map((id) =>
    getNode(document, id),
  );
  return {
    visible: chain.every((node) => node.visible),
    locked: chain.some((node) => node.locked),
    hiddenBy: chain.filter((node) => !node.visible).map((node) => node.id),
    lockedBy: chain.filter((node) => node.locked).map((node) => node.id),
  };
}

function commitNodes(document, nodes) {
  return validateDocument({ ...document, nodes });
}

export function transformNodes(document, nodeIds, worldTransform) {
  matrixPose(worldTransform);
  const roots = selectedRoots(document, nodeIds);
  if (!roots.length) return document;
  const nodes = { ...document.nodes };
  const cache = new Map();
  for (const id of roots) {
    const node = nodes[id];
    const local = multiplyTransforms(
      inverseTransform(worldMatrix(document, node.parentId, cache)),
      multiplyTransforms(worldTransform, worldMatrix(document, id, cache)),
    );
    nodes[id] = { ...node, pose: matrixPose(local) };
  }
  return commitNodes(document, nodes);
}

export function reparentNodes(
  document,
  nodeIds,
  parentId,
  { keepWorld = true, index } = {},
) {
  if (typeof keepWorld !== 'boolean') throw Error('keepWorld 必须是布尔值');
  if (parentId !== null && getNode(document, parentId).kind !== 'group')
    throw Error('新父级必须是组');
  const roots = selectedRoots(document, nodeIds);
  if (!roots.length) return document;
  for (const id of roots)
    if (
      parentId === id ||
      (parentId !== null && ancestorsOf(document, parentId).includes(id))
    )
      throw Error('不能将节点放入自身或后代');
  const selection = new Set(roots);
  const siblings = childrenOf(document, parentId).filter(
    (node) => !selection.has(node.id),
  );
  const insertIndex = index ?? siblings.length;
  if (
    !Number.isSafeInteger(insertIndex) ||
    insertIndex < 0 ||
    insertIndex > siblings.length
  )
    throw Error('插入位置超出同级范围');
  const cache = new Map();
  const inverseParent = inverseTransform(
    worldMatrix(document, parentId, cache),
  );
  const nodes = { ...document.nodes };
  for (const id of roots) {
    nodes[id] = {
      ...nodes[id],
      parentId,
      pose: keepWorld
        ? matrixPose(
            multiplyTransforms(inverseParent, worldMatrix(document, id, cache)),
          )
        : nodes[id].pose,
    };
  }
  const order = siblings.map((node) => node.id);
  order.splice(insertIndex, 0, ...roots);
  order.forEach((id, siblingIndex) => {
    nodes[id] = { ...nodes[id], order: siblingIndex };
  });
  return commitNodes(document, nodes);
}

export function groupNodes(document, nodeIds, { id, name = '组合' }) {
  const roots = selectedRoots(document, nodeIds);
  if (!roots.length) throw Error('请选择要编组的部件或组');
  if (typeof id !== 'string' || !id.trim() || Object.hasOwn(document.nodes, id))
    throw Error('组合 ID 无效或已存在');
  const parentChains = roots.map((nodeId) => [
    ...ancestorsOf(document, nodeId),
    null,
  ]);
  const parentId = parentChains[0].find((candidate) =>
    parentChains.every((chain) => chain.includes(candidate)),
  );
  const group = {
    id,
    kind: 'group',
    name,
    parentId,
    order: childrenOf(document, parentId).length,
    pose: matrixPose(identityTransform()),
    visible: true,
    locked: false,
  };
  const withGroup = commitNodes(document, { ...document.nodes, [id]: group });
  return reparentNodes(withGroup, roots, id);
}
