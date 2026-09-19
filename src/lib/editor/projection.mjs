import { normalizeSelection } from './selection.mjs';
import { deriveEditableHandle } from './picking.mjs';
import { childrenOf, effectiveNodeState } from '../scene/hierarchy.mjs';
import {
  multiplyTransforms,
  transformPoint,
  worldMatrix,
} from '../scene/transforms.mjs';
import { sameOutputRef, resolveAppearance } from '../relief/appearance.mjs';

const clone = (value) => structuredClone(value);
const coordinateBounds = (
  coordinates,
  result = [Infinity, Infinity, -Infinity, -Infinity],
) => {
  if (!Array.isArray(coordinates)) return result;
  if (coordinates.length === 2 && coordinates.every(Number.isFinite)) {
    result[0] = Math.min(result[0], coordinates[0]);
    result[1] = Math.min(result[1], coordinates[1]);
    result[2] = Math.max(result[2], coordinates[0]);
    result[3] = Math.max(result[3], coordinates[1]);
  } else for (const item of coordinates) coordinateBounds(item, result);
  return result;
};
const mapCoordinates = (coordinates, matrix) =>
  coordinates.length === 2 && coordinates.every(Number.isFinite)
    ? transformPoint(matrix, coordinates)
    : coordinates.map((item) => mapCoordinates(item, matrix));
const finiteBounds = (value) => (value[0] === Infinity ? null : value);
const absent = (domain) => ({
  domain,
  status: 'absent',
  diagnostics: [],
  dependencies: [],
});

// Only current published results enter the default canvas. Intermediate stages
// remain available to the advanced inspector, never substitutes for failed outputs.
export function projectEditor(document, snapshot = {}, sessionView = {}) {
  const candidates = [],
    curves = [],
    diagnostics = [],
    details = [];
  const nodeStates = new Map();
  for (const node of Object.values(document.nodes)) {
    if (node.kind !== 'shape') continue;
    const program = document.programs[node.programId];
    const output = (domain) => {
      const ref = program?.outputs[domain];
      return (
        snapshot.published?.[`${node.id}:${domain}`] ||
        (ref &&
          snapshot.components?.[`operator:${ref.operatorId}`]?.ports?.[
            ref.port
          ]) ||
        absent(domain)
      );
    };
    const curveStage = output('curves'),
      regionStage = output('regions');
    const stages = [curveStage, regionStage];
    nodeStates.set(
      node.id,
      stages.some((stage) => stage.status === 'blocked')
        ? 'blocked'
        : stages.some((stage) => stage.status === 'ready')
          ? 'ready'
          : 'empty',
    );
    diagnostics.push(
      ...stages.flatMap((stage) =>
        (stage.diagnostics || []).map((item) => ({
          ...clone(item),
          ownerNodeId: node.id,
        })),
      ),
    );
    const effective = effectiveNodeState(document, node.id);
    if (!effective.visible) continue;
    const matrix = worldMatrix(document, node.id);
    if (curveStage.status === 'ready')
      for (const curve of curveStage.value.curves)
        curves.push({
          ...clone(curve),
          ownerNodeId: node.id,
          locked: effective.locked,
          edges: curve.edges.map((edge) => ({
            ...clone(edge),
            cubic: edge.cubic.map((point) => transformPoint(matrix, point)),
            transform: multiplyTransforms(
              matrix,
              edge.transform || [1, 0, 0, 1, 0, 0],
            ),
          })),
        });
    if (regionStage.status === 'ready')
      for (const region of regionStage.value.regions) {
        const appearance = resolveAppearance(document, node.id, region.ref);
        const candidate = {
          ...clone(region),
          locked: effective.locked,
          color: appearance.status === 'ready' ? appearance.value.color : null,
          geometry: {
            ...clone(region.geometry),
            coordinates: mapCoordinates(region.geometry.coordinates, matrix),
          },
        };
        candidates.push(candidate);
        const painted =
          Boolean(document.appearances.defaults[node.id]) ||
          Object.values(document.appearances.overrides).some((item) =>
            sameOutputRef(item.target, region.ref),
          );
        candidate.painted = painted;
        if (painted) details.push(candidate);
      }
  }
  const build = (parentId) =>
    childrenOf(document, parentId).map((node) => ({
      ref: { kind: 'node', id: node.id },
      id: node.id,
      name: node.name,
      kind: node.kind,
      ...effectiveNodeState(document, node.id),
      children: node.kind === 'group' ? build(node.id) : [],
      state: nodeStates.get(node.id) || 'ready',
    }));
  return {
    tree: build(null),
    selection: normalizeSelection(sessionView.selection),
    canvas: {
      candidates,
      curves,
      bounds: {
        curves: finiteBounds(
          coordinateBounds(
            curves.flatMap((curve) => curve.edges.map((edge) => edge.cubic)),
          ),
        ),
        regions: finiteBounds(
          coordinateBounds(
            candidates.map((region) => region.geometry.coordinates),
          ),
        ),
      },
    },
    details: {
      regions: sessionView.showDetails ? clone(details) : [],
      diagnostics,
    },
    capabilities: { deriveEditableHandle },
  };
}
