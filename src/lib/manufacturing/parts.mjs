import { sameOutputRef } from '../relief/appearance.mjs';

export function partForRelief(document, relief) {
  const assignments = Object.values(document.manufacturing.assignments || {});
  const exact = assignments.filter(
    (item) =>
      item.target.kind === 'output' && sameOutputRef(item.target, relief.ref),
  );
  if (exact.length > 1) throw Error('同一输出存在多个制造 Part 赋值');
  const shape = assignments.filter(
    (item) =>
      item.target.kind === 'node' && item.target.id === relief.ref.ownerNodeId,
  );
  if (shape.length > 1) throw Error('同一 Shape 存在多个制造 Part 赋值');
  const partId =
    exact[0]?.partId ??
    shape[0]?.partId ??
    document.manufacturing.defaultPartId;
  if (!document.manufacturing.parts[partId])
    throw Error(`制造 Part 不存在：${partId}`);
  return partId;
}

export function isExcluded(document, relief) {
  return document.manufacturing.excluded.some(
    (target) =>
      (target.kind === 'node' && target.id === relief.ref.ownerNodeId) ||
      (target.kind === 'output' && sameOutputRef(target, relief.ref)),
  );
}
