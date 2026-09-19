import { validateDocument } from '../document/schema.mjs';
import { ancestorsOf, childrenOf, reparentNodes } from './hierarchy.mjs';
import { planNodeRebase } from './rebase.mjs';

// Promote group-owned datums/parameters instead of leaving dangling ownership.
// Their coordinates are first re-expressed in the former parent's frame.
export function ungroupNodes(document, groupIds) {
  validateDocument(document);
  if (!Array.isArray(groupIds)) throw Error('解组选区必须是数组');
  const ids = [...new Set(groupIds)];
  for (const id of ids)
    if (
      !Object.hasOwn(document.nodes, id) ||
      document.nodes[id].kind !== 'group'
    )
      throw Error('只有组可以解组');
  ids.sort(
    (a, b) => ancestorsOf(document, b).length - ancestorsOf(document, a).length,
  );
  let next = document;
  for (const id of ids) {
    const parentId = next.nodes[id].parentId;
    const children = childrenOf(next, id).map((node) => node.id);
    const index = childrenOf(next, parentId).findIndex(
      (node) => node.id === id,
    );
    next = planNodeRebase(next, id, {
      translationMM: [0, 0],
      rotationRad: 0,
    }).document;
    next = reparentNodes(next, children, parentId, { index });
    // reparentNodes validates before returning; take our own copy before removal.
    next = structuredClone(next);
    for (const child of children) {
      next.nodes[child].visible =
        next.nodes[child].visible && next.nodes[id].visible;
      next.nodes[child].locked =
        next.nodes[child].locked || next.nodes[id].locked;
    }
    for (const resources of [next.datums, next.parameters])
      for (const resource of Object.values(resources))
        if (resource.ownerNodeId === id) resource.ownerNodeId = parentId;
    for (const collection of Object.values(next.collections)) {
      const existing = new Set(
        collection.members
          .filter((member) => member.kind === 'node' && member.id !== id)
          .map((member) => member.id),
      );
      collection.members = collection.members.flatMap((member) => {
        if (member.kind !== 'node' || member.id !== id) return [member];
        return children
          .filter((child) => {
            if (existing.has(child)) return false;
            existing.add(child);
            return true;
          })
          .map((child) => ({ kind: 'node', id: child }));
      });
    }
    delete next.nodes[id];
    childrenOf(next, parentId).forEach((node, order) => {
      next.nodes[node.id].order = order;
    });
    validateDocument(next);
  }
  return next;
}
