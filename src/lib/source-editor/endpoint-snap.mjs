import { creationDocument } from '../creation-schema.mjs';
import {
  modifierTransforms,
  transformPoint,
  composeTransforms,
  identityTransform,
  fixedSet,
} from '../curve-transforms.mjs';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const projectToLine = (p, line) => {
  const t =
    (p.x - line.point.x) * line.direction.x +
    (p.y - line.point.y) * line.direction.y;
  return {
    x: line.point.x + t * line.direction.x,
    y: line.point.y + t * line.direction.y,
  };
};

// Capture immutable targets at gesture start. A point's own moving copies are
// NOT snap targets: solve their fixed set so the endpoint cannot chase itself.
export function endpointSnapContext(project, pathId, nodeIndex) {
  const path = project.paths.find((p) => p.id === pathId);
  if (
    !path ||
    path.closed ||
    !path.curves.length ||
    ![0, path.curves.length].includes(nodeIndex)
  )
    return null;
  const origin = nodeIndex === 0 ? path.curves[0][0] : path.curves.at(-1)[3];
  const doc = creationDocument(project),
    owner = doc.objects.find((o) => o.pathIds.includes(pathId));
  const mm = project.widthMM / project.width;
  const toModel = (p) => ({
    x: (p.x - project.width / 2) * mm,
    y: (project.height / 2 - p.y) * mm,
  });
  const toImage = (p) => ({
    x: project.width / 2 + p.x / mm,
    y: project.height / 2 - p.y / mm,
  });
  let transforms = [identityTransform()];
  const sourceCount = project.paths
    .filter((p) => owner?.pathIds.includes(p.id))
    .reduce((n, p) => n + p.curves.length, 0);
  for (const m of owner?.modifiers || []) {
    if (!m.enabled) continue;
    if (!['curve_mirror', 'curve_array'].includes(m.type)) break;
    const copies = modifierTransforms(m);
    if (transforms.length * copies.length * sourceCount > 20000) break;
    transforms = copies.flatMap((a) =>
      transforms.map((b) => composeTransforms(a, b)),
    );
  }
  transforms = [
    ...new Map(
      transforms.map((t) => [t.map((v) => Math.round(v * 1e9)).join(','), t]),
    ).values(),
  ];
  // Deduplicate repeated rotations/axes; stable IDs provide magnetic hysteresis.
  const lines = [],
    points = [],
    seen = new Set();
  const add = (kind, point, label, direction = null) => {
    if (
      direction &&
      (direction.x < -1e-9 || (Math.abs(direction.x) < 1e-9 && direction.y < 0))
    )
      direction = { x: -direction.x, y: -direction.y };
    const key = JSON.stringify(
      [kind, point.x, point.y, direction?.x, direction?.y].map((v) =>
        typeof v === 'number' ? Math.round(v * 1e7) : v,
      ),
    );
    if (seen.has(key)) return;
    seen.add(key);
    const target = {
      id: key,
      kind,
      point,
      label,
      ...(direction ? { direction } : {}),
    };
    (kind === 'line' ? lines : points).push(target);
  };
  for (const t of transforms) {
    const fixed = fixedSet(t);
    if (!fixed) continue;
    if (fixed.kind === 'line')
      add('line', toImage(fixed.point), '对称接缝', {
        x: fixed.direction.x,
        y: -fixed.direction.y,
      });
    else if (
      transforms.filter(
        (other) =>
          distance(transformPoint(other, fixed.point), fixed.point) < 1e-7,
      ).length === 2
    )
      add('point', toImage(fixed.point), '旋转中心');
  }
  const endpointTargets = new Map();
  for (const p of project.paths) {
    if (
      !p.visible ||
      p.closed ||
      !p.curves.length ||
      doc.objects.some((o) => !o.visible && o.pathIds.includes(p.id))
    )
      continue;
    const copies = owner?.pathIds.includes(p.id)
      ? transforms
      : [identityTransform()];
    for (const [index, end] of [
      [0, p.curves[0][0]],
      [p.curves.length, p.curves.at(-1)[3]],
    ]) {
      if (p.id === pathId && index === nodeIndex) continue;
      for (const [i, t] of copies.entries()) {
        const point = toImage(transformPoint(t, toModel(end)));
        const key = `${Math.round(point.x * 1e7)},${Math.round(point.y * 1e7)}`;
        const target = endpointTargets.get(key);
        if (target) target.degree++;
        else
          endpointTargets.set(key, {
            point,
            degree: 1,
            label: `${i ? '派生' : '源'}端点 · ${p.name}`,
          });
      }
    }
  }
  // Joining onto an already joined endpoint would introduce a branch. In
  // particular, do not magnetically collapse the inner and outer seam tips.
  for (const target of endpointTargets.values())
    if (target.degree === 1) add('point', target.point, target.label);
  const join =
    (owner?.modifiers.find((m) => m.enabled && m.type === 'fill')?.joinMM ??
      0.001) / mm;
  const locked = lines.find(
    (line) =>
      distance(origin, projectToLine(origin, line)) <= Math.max(join, 1e-7),
  );
  return { origin, lines, points, lockedId: locked?.id };
}

export function snapEndpoint(
  context,
  desired,
  { scale = 1, preserveSeam = true, previousId = '' } = {},
) {
  if (!context) return null;
  const locked =
    preserveSeam && context.lines.find((s) => s.id === context.lockedId);
  if (locked) {
    const projected = projectToLine(desired, locked);
    const point = context.points
      .filter(
        (s) =>
          distance(s.point, projectToLine(s.point, locked)) < 1e-7 &&
          distance(s.point, projected) * scale <= 10,
      )
      .sort(
        (a, b) => distance(a.point, projected) - distance(b.point, projected),
      )[0];
    return {
      ...locked,
      raw: desired,
      position: point?.point || projected,
      ...(point ? { label: `${locked.label} + ${point.label}` } : {}),
      locked: true,
    };
  }
  const candidates = [...context.points, ...context.lines].map((s) => {
    const position = s.kind === 'line' ? projectToLine(desired, s) : s.point;
    return {
      ...s,
      raw: desired,
      position,
      locked: false,
      distancePX: distance(position, desired) * scale,
    };
  });
  const previous = candidates.find(
    (s) => s.id === previousId && s.distancePX <= 16,
  );
  const point = candidates
    .filter((s) => s.kind === 'point' && s.distancePX <= 10)
    .sort((a, b) => a.distancePX - b.distancePX)[0];
  return (
    (previous?.kind === 'point' ? previous : point) ||
    previous ||
    candidates
      .filter((s) => s.distancePX <= 10)
      .sort((a, b) => a.distancePX - b.distancePX)[0] ||
    null
  );
}
