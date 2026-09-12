import { regionContext } from './region-engine.mjs';

export function objectHoles(project, object) {
  if (Array.isArray(object.modifiers)) return [];
  const paths = project.paths.filter(
    (p) => object.pathIds.includes(p.id) && object.roles[p.id] === 'hole',
  );
  if (!paths.length) return [];
  const ctx = regionContext(project);
  return paths.map((p) => {
    if (!p.closed) throw Error(`挖洞路径「${p.name}」尚未闭合，请先闭合端点`);
    try {
      return ctx.calculate({ kind: 'path', pathId: p.id }).cells[0];
    } catch (e) {
      throw Error(`挖洞路径「${p.name}」：${e.message}`);
    }
  });
}

export function subtractHoles(geometry, holes) {
  for (const hole of holes) {
    if (geometry.isEmpty()) break;
    geometry = geometry.difference(hole);
  }
  return geometry;
}
