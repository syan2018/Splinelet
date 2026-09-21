import { validateProject } from '../project.ts';
import { creationDocument } from '../creation-schema.mjs';
import {
  prepareSplineEdits,
  splineNodes,
  splineSpace,
} from './spline-proposal.mjs';
export { splineNodes } from './spline-proposal.mjs';

export function inspectSplines(project, { pathIds, units = 'image' } = {}) {
  const convert = splineSpace(project, units).read;
  if (
    pathIds !== undefined &&
    (!Array.isArray(pathIds) ||
      pathIds.some((id) => !project.paths.some((p) => p.id === id)))
  )
    throw Error('pathIds 必须为现有路径 ID');
  return {
    units,
    splines: project.paths
      .filter((p) => !pathIds || pathIds.includes(p.id))
      .map((p) => ({
        id: p.id,
        name: p.name,
        closed: p.closed,
        nodes: splineNodes(p).map((n) =>
          Object.fromEntries(
            Object.entries(n).map(([k, v]) => [k, convert(v)]),
          ),
        ),
      })),
  };
}

// Validate the entire shared proposal before allocating IDs or changing a clone.
export function editSplines(
  project,
  { splines, objectId, units = 'image' } = {},
) {
  const creation = creationDocument(project);
  const proposals = prepareSplineEdits(
    {
      frame: project,
      paths: project.paths,
      objects: creation.objects,
    },
    { splines, objectId, units },
  );
  const next = structuredClone(project),
    pathIds = [],
    newRoles = new Map();
  for (const { pathId, ownerId, role, ...geometry } of proposals) {
    const old =
      pathId === null ? null : next.paths.find((p) => p.id === pathId);
    const id = old?.id ?? crypto.randomUUID();
    const path = {
      ...(old || { id, color: '#b99a60', visible: true, quality: 1 }),
      ...geometry,
    };
    if (old) next.paths[next.paths.indexOf(old)] = path;
    else {
      next.paths.push(path);
      newRoles.set(id, role);
      if (ownerId !== null) {
        const owner = creation.objects.find((o) => o.id === ownerId);
        owner.pathIds.push(id);
        owner.roles[id] = role;
      }
    }
    pathIds.push(id);
  }
  next.version = 3;
  next.creation = creation;
  next.creation = creationDocument(next);
  for (const [id, role] of newRoles) {
    const assigned = next.creation.objects.find((o) => o.pathIds.includes(id));
    assigned.roles[id] = role;
  }
  validateProject(next);
  return { project: next, pathIds };
}
