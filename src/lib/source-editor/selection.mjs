import { pathNodes, removeNode } from './node-edit.mjs';
import { evaluate } from '../../../public/geometry.mjs';

/**
 * @param {string[]} existing
 * @param {string} id
 * @param {string[]} ordered
 * @param {{ toggle?: boolean, range?: boolean, anchor?: string | null }} [options]
 */
export function pickSelection(
  existing,
  id,
  ordered,
  { toggle = false, range = false, anchor = null } = {},
) {
  if (range && ordered.includes(anchor) && ordered.includes(id)) {
    const a = ordered.indexOf(anchor),
      b = ordered.indexOf(id);
    const ids = ordered.slice(Math.min(a, b), Math.max(a, b) + 1);
    return toggle ? [...new Set([...existing, ...ids])] : ids;
  }
  return toggle
    ? existing.includes(id)
      ? existing.filter((v) => v !== id)
      : [...existing, id]
    : [id];
}
export function movePaths(project, ids, groupId = '', targetId, after = false) {
  const selected = new Set(ids);
  if (!ids.length || ids.some((id) => !project.paths.some((p) => p.id === id)))
    throw Error('请选择存在的路径');
  if (groupId && !project.groups?.some((g) => g.id === groupId))
    throw Error('目标分组不存在');
  const target = targetId && project.paths.find((p) => p.id === targetId);
  if (targetId && !target) throw Error('目标路径不存在');
  if (target && selected.has(target.id)) return false;
  if (target) groupId = target.groupId || '';
  // Keep the visible tree order even when selection spans several groups.
  const order = [...(project.groups || []), { id: '' }].flatMap((g) =>
    project.paths.filter((p) => (p.groupId || '') === g.id),
  );
  const moving = order.filter((p) => selected.has(p.id));
  const rest = project.paths.filter((p) => !selected.has(p.id));
  let at = target
    ? rest.findIndex((p) => p.id === target.id) + (after ? 1 : 0)
    : rest.findLastIndex((p) => (p.groupId || '') === groupId) + 1;
  if (!target && at === 0) at = rest.length;
  moving.forEach((p) => {
    if (groupId) p.groupId = groupId;
    else delete p.groupId;
  });
  rest.splice(at, 0, ...moving);
  project.paths = rest;
  return true;
}
export function translatePaths(project, ids, dx, dy) {
  const selected = new Set(ids),
    shift = (p) => ({ x: p.x + dx, y: p.y + dy });
  for (const path of project.paths)
    if (selected.has(path.id)) {
      path.start = shift(path.start);
      path.anchors = path.anchors.map(shift);
      path.curves = path.curves.map((c) => c.map(shift));
      delete path.fitError;
    }
  if (project.creation) {
    project.creation = structuredClone(project.creation);
    const shiftCoordinates = (a) =>
      typeof a[0] === 'number'
        ? [a[0] + dx / project.width, a[1] - dy / project.width]
        : a.map(shiftCoordinates);
    for (const object of project.creation.objects)
      if (
        object.pathIds.length &&
        object.pathIds.every((id) => selected.has(id))
      )
        for (const paint of object.paints)
          paint.geometry.coordinates = shiftCoordinates(
            paint.geometry.coordinates,
          );
  }
  if (project.model) {
    const sources = (id, seen = new Set()) => {
      if (seen.has(id)) return [];
      seen.add(id);
      const r = project.model.regions.find((r) => r.id === id);
      if (!r) return [];
      return [
        ...(r.pathId ? [r.pathId] : []),
        ...(r.pathIds || []),
        ...[r.a, r.b, r.baseId]
          .filter(Boolean)
          .flatMap((id) => sources(id, seen)),
      ];
    };
    const moving = project.model.regions
      .filter(
        (r) =>
          r.kind === 'split' && sources(r.id).every((id) => selected.has(id)),
      )
      .map((r) => r.id);
    if (moving.length) {
      project.model = structuredClone(project.model);
      for (const r of project.model.regions.filter((r) =>
        moving.includes(r.id),
      )) {
        const scale = (r.seedWidthMM || project.widthMM) / project.width;
        r.seed = [r.seed[0] + dx * scale, r.seed[1] - dy * scale];
      }
    }
  }
}
export function translateNodes(path, ids, dx, dy) {
  const selected = new Set(ids),
    shift = (p) => ({ x: p.x + dx, y: p.y + dy });
  if (!path.curves.length) {
    if (selected.has(0)) {
      path.start = shift(path.start);
      path.anchors = [path.start];
    }
    return;
  }
  path.curves = path.curves.map((c, i) => {
    const next = path.closed ? (i + 1) % path.curves.length : i + 1;
    return [
      selected.has(i) ? shift(c[0]) : c[0],
      selected.has(i) ? shift(c[1]) : c[1],
      selected.has(next) ? shift(c[2]) : c[2],
      selected.has(next) ? shift(c[3]) : c[3],
    ];
  });
  path.start = path.curves[0][0];
  path.anchors = pathNodes(path);
  delete path.fitError;
}
export function deleteNodes(path, indices, tolerance) {
  // Descending order preserves original indices, including the closed seam.
  for (const i of [...new Set(indices)].sort((a, b) => b - a)) {
    if (!path) break;
    path = removeNode(path, i, tolerance).path;
  }
  return path;
}
export const inBox = (p, r) =>
  p.x >= r.x && p.y >= r.y && p.x <= r.x + r.width && p.y <= r.y + r.height;
function segmentHits(a, b, r) {
  let lo = 0,
    hi = 1;
  for (const [origin, delta, min, max] of [
    [a.x, b.x - a.x, r.x, r.x + r.width],
    [a.y, b.y - a.y, r.y, r.y + r.height],
  ]) {
    if (Math.abs(delta) < 1e-9) {
      if (origin < min || origin > max) return false;
      continue;
    }
    const t1 = (min - origin) / delta,
      t2 = (max - origin) / delta;
    lo = Math.max(lo, Math.min(t1, t2));
    hi = Math.min(hi, Math.max(t1, t2));
    if (lo > hi) return false;
  }
  return true;
}
export function pathHitsBox(path, r) {
  if (!path.curves.length) return inBox(path.start, r);
  return path.curves.some((c) => {
    let a = c[0];
    for (let i = 1; i <= 64; i++) {
      const b = evaluate(c, i / 64);
      if (segmentHits(a, b, r)) return true;
      a = b;
    }
    return false;
  });
}
