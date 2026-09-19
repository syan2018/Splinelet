import { validateDocument } from '../document/schema.mjs';
import { evaluatePlanar } from '../construction/document-evaluation.mjs';
import {
  fixedSet,
  transformPoint as transformLegacyPoint,
} from '../curve-transforms.mjs';
import {
  identityTransform,
  inverseTransform,
  multiplyTransforms,
  transformPoint,
  worldMatrix,
} from '../scene/transforms.mjs';
import { projectSourceView } from './source-view.mjs';

const epsilon = 1e-7;
const freeze = (value, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freeze(child, seen);
  return Object.freeze(value);
};
const distance = (left, right) =>
  Math.hypot(left.x - right.x, left.y - right.y);
const finiteMatrix = (value) =>
  Array.isArray(value) && value.length === 6 && value.every(Number.isFinite);
const samePathRef = (left, right) =>
  left?.kind === 'path' &&
  right?.kind === 'path' &&
  left.sketchId === right.sketchId &&
  left.id === right.id;
const sameVertex = (left, right) =>
  left?.kind === 'vertex' &&
  right?.kind === 'vertex' &&
  left.sketchId === right.sketchId &&
  left.id === right.id;
const pixel = (matrix, point) => {
  const [x, y] = transformPoint(matrix, point);
  return { x, y };
};
const world = (matrix, point) => transformPoint(matrix, point);
const matrixKey = (matrix) =>
  matrix.map((value) => Math.round(value * 1e9)).join(',');
const pointKey = (point) =>
  `${Math.round(point.x * 1e7)},${Math.round(point.y * 1e7)}`;
const identity = (matrix) =>
  matrix.every(
    (value, index) => Math.abs(value - identityTransform()[index]) < 1e-9,
  );

const endpointPairs = (path) => [
  [0, path.curves[0][0]],
  [path.curves.length, path.curves.at(-1)[3]],
];

const curveEndpoints = (curve) => {
  if (!curve?.edges?.length) return null;
  const first = curve.edges[0];
  const last = curve.edges.at(-1);
  if (
    !Array.isArray(first?.cubic) ||
    !Array.isArray(last?.cubic) ||
    first.cubic.length !== 4 ||
    last.cubic.length !== 4
  )
    return null;
  return [first.cubic[0], last.cubic[3]];
};

const outputForOwner = (document, planar, ownerNodeId) => {
  const stage = planar.published[`${ownerNodeId}:curves`];
  if (stage?.status !== 'ready' || stage.value?.frame?.kind !== 'local')
    return null;
  if (!document.nodes[stage.value.frame.ownerNodeId]) return null;
  return stage.value;
};

const topologyDegrees = (output) => {
  const parents = new Map();
  const vertices = new Map();
  const endpointKey = (edgeKey, end) => JSON.stringify([edgeKey, end]);
  const root = (key) => {
    let current = key;
    while (parents.get(current) !== current) current = parents.get(current);
    return current;
  };
  const join = (left, right) => parents.set(root(right), root(left));
  for (const edge of output.curves.flatMap((curve) => curve.edges || [])) {
    for (const end of ['start', 'end']) {
      if (typeof edge.key !== 'string' || typeof edge[`${end}Key`] !== 'string')
        return null;
      const key = endpointKey(edge.key, end);
      if (parents.has(key)) return null;
      parents.set(key, key);
      const vertex = edge[`${end}Key`];
      if (vertices.has(vertex)) join(key, vertices.get(vertex));
      else vertices.set(vertex, key);
    }
  }
  for (const junction of output.junctions || []) {
    const keys = junction.endpoints?.map(({ edgeKey, end }) =>
      endpointKey(edgeKey, end),
    );
    if (!keys?.length || keys.some((key) => !parents.has(key))) return null;
    for (const key of keys.slice(1)) join(keys[0], key);
  }
  const degree = new Map();
  for (const key of parents.keys()) {
    const component = root(key);
    degree.set(component, (degree.get(component) || 0) + 1);
  }
  return new Map(
    [...parents.keys()].map((key) => [key, degree.get(root(key))]),
  );
};

/**
 * Projects the immutable V4 source/canvas state to the legacy endpoint snap
 * DTO.  Construction output is read only: it supplies actual instance poses
 * and never becomes a writable source path.
 */
export function projectEndpointSnapContext(
  document,
  source,
  pathId,
  nodeIndex,
) {
  try {
    validateDocument(document);
    if (!source?.frame) return null;

    // Reproject from the supplied frame.  A view is a display DTO, so its
    // coordinates must not be trusted after the document has changed.
    const view = projectSourceView(document, source.frame);
    const path = view.paths.find((candidate) => candidate.id === pathId);
    if (
      !path ||
      path.closed ||
      !path.curves.length ||
      ![0, path.curves.length].includes(nodeIndex)
    )
      return null;
    const ref = view.identities.paths[pathId];
    const sketch =
      ref?.kind === 'path' ? document.sketches[ref.sketchId] : undefined;
    const sourcePath = sketch?.paths?.[ref.id];
    if (!sketch || !sourcePath || sketch.ownerNodeId !== path.ownerNodeId)
      return null;

    const origin = nodeIndex === 0 ? path.curves[0][0] : path.curves.at(-1)[3];
    const planar = evaluatePlanar(document, { requestedDomains: ['curves'] });
    const sourceWorld = new Map();
    const outputByOwner = new Map();
    const degreeByOwner = new Map();
    const outputCurves = (ownerNodeId) => {
      if (!outputByOwner.has(ownerNodeId))
        outputByOwner.set(
          ownerNodeId,
          outputForOwner(document, planar, ownerNodeId),
        );
      return outputByOwner.get(ownerNodeId);
    };
    const addSourceWorld = (ownerNodeId) => {
      if (!sourceWorld.has(ownerNodeId))
        sourceWorld.set(ownerNodeId, worldMatrix(document, ownerNodeId));
      return sourceWorld.get(ownerNodeId);
    };

    const derivedForPath = (candidate, candidateRef) => {
      if (candidate.ownerNodeId !== path.ownerNodeId) return [];
      const output = outputCurves(candidate.ownerNodeId);
      if (!output) return [];
      if (!degreeByOwner.has(candidate.ownerNodeId))
        degreeByOwner.set(candidate.ownerNodeId, topologyDegrees(output));
      const degrees = degreeByOwner.get(candidate.ownerNodeId);
      if (!degrees) return [];
      const targetCurves = output.curves.filter((curve) =>
        samePathRef(curve.pathRef, candidateRef),
      );
      if (!targetCurves.length) return [];
      const outputWorld = worldMatrix(document, output.frame.ownerNodeId);
      const inputWorld = addSourceWorld(candidate.ownerNodeId);
      return targetCurves.flatMap((curve) => {
        const endpoints = curveEndpoints(curve);
        const edge = curve.edges?.[0];
        if (!endpoints || !finiteMatrix(edge?.transform)) return [];
        let pose;
        try {
          pose = multiplyTransforms(
            outputWorld,
            multiplyTransforms(edge.transform, inverseTransform(inputWorld)),
          );
        } catch {
          return [];
        }
        return endpoints.map((value, index) => ({
          point: pixel(view.frame.worldToPixel, world(outputWorld, value)),
          pose,
          degree:
            degrees.get(
              JSON.stringify([
                index ? curve.edges.at(-1).key : curve.edges[0].key,
                index ? 'end' : 'start',
              ]),
            ) || 1,
        }));
      });
    };

    const rawDegrees = new Map();
    for (const candidate of view.paths) {
      if (!candidate.visible || candidate.closed || !candidate.curves.length)
        continue;
      for (const index of [0, candidate.curves.length]) {
        const anchorId = candidate.identity.anchorIds[index];
        rawDegrees.set(anchorId, (rawDegrees.get(anchorId) || 0) + 1);
      }
    }
    const endpointTargets = [];
    for (const candidate of view.paths) {
      if (!candidate.visible || candidate.closed || !candidate.curves.length)
        continue;
      const candidateRef = view.identities.paths[candidate.id];
      if (candidateRef?.kind !== 'path') continue;
      const derived = derivedForPath(candidate, candidateRef);
      const endpoints = derived.length
        ? derived.map((entry, index) => [
            index % 2 ? candidate.curves.length : 0,
            entry.point,
            entry.pose,
            entry.degree,
          ])
        : endpointPairs(candidate).map(([index, point]) => [
            index,
            point,
            identityTransform(),
            rawDegrees.get(candidate.identity.anchorIds[index]) || 1,
          ]);
      for (const [index, point, pose, degree] of endpoints) {
        const vertex =
          view.identities.anchors[candidate.identity.anchorIds[index]];
        const moving = sameVertex(
          vertex,
          view.identities.anchors[path.identity.anchorIds[nodeIndex]],
        );
        endpointTargets.push({
          point,
          degree,
          label: `${identity(pose) ? '源' : '派生'}端点 · ${candidate.name}`,
          excluded: moving,
        });
      }
    }
    const coincidentDegrees = new Map();
    for (const target of endpointTargets) {
      const key = pointKey(target.point);
      coincidentDegrees.set(key, (coincidentDegrees.get(key) || 0) + 1);
    }
    for (const target of endpointTargets)
      target.degree = Math.max(
        target.degree,
        coincidentDegrees.get(pointKey(target.point)),
      );

    const operatorTypes = new Map(
      Object.values(document.programs).flatMap((program) =>
        Object.values(program.operators).map((operator) => [
          operator.id,
          operator.type,
        ]),
      ),
    );
    const transforms = new Map();
    for (const curve of outputForOwner(document, planar, path.ownerNodeId)
      ?.curves || []) {
      if (!samePathRef(curve.pathRef, ref)) continue;
      for (const edge of curve.edges || []) {
        if (
          !finiteMatrix(edge.transform) ||
          !edge.instances?.some((instance) =>
            ['curve-mirror', 'curve-array'].includes(
              operatorTypes.get(instance.operatorId),
            ),
          )
        )
          continue;
        try {
          const full = multiplyTransforms(
            worldMatrix(document, path.ownerNodeId),
            multiplyTransforms(
              edge.transform,
              inverseTransform(worldMatrix(document, path.ownerNodeId)),
            ),
          );
          transforms.set(matrixKey(full), full);
        } catch {
          // Invalid transforms have no reliable fixed set and cannot guide a drag.
        }
      }
    }

    const lines = [];
    const points = [];
    const seen = new Set();
    const addGuide = (kind, point, label, direction = null) => {
      if (
        direction &&
        (direction.x < -1e-9 ||
          (Math.abs(direction.x) < 1e-9 && direction.y < 0))
      )
        direction = { x: -direction.x, y: -direction.y };
      const key = JSON.stringify(
        [kind, point.x, point.y, direction?.x, direction?.y].map((value) =>
          typeof value === 'number' ? Math.round(value * 1e7) : value,
        ),
      );
      if (seen.has(key)) return;
      seen.add(key);
      const guide = {
        id: key,
        kind,
        point,
        label,
        ...(direction ? { direction } : {}),
      };
      (kind === 'line' ? lines : points).push(guide);
    };
    const transformList = [...transforms.values()];
    for (const pose of transformList) {
      const fixed = fixedSet(pose);
      if (!fixed) continue;
      if (fixed.kind === 'line')
        addGuide(
          'line',
          pixel(view.frame.worldToPixel, [fixed.point.x, fixed.point.y]),
          '对称接缝',
          { x: fixed.direction.x, y: -fixed.direction.y },
        );
      else if (
        transformList.filter(
          (other) =>
            distance(transformLegacyPoint(other, fixed.point), fixed.point) <
            epsilon,
        ).length === 2
      )
        addGuide(
          'point',
          pixel(view.frame.worldToPixel, [fixed.point.x, fixed.point.y]),
          '旋转中心',
        );
    }
    for (const target of endpointTargets)
      if (!target.excluded && target.degree === 1)
        addGuide('point', target.point, target.label);

    const pixelsPerMM = view.frame.width / view.frame.widthMM;
    const locked = lines.find((line) => {
      const dx = origin.x - line.point.x;
      const dy = origin.y - line.point.y;
      const projection = dx * line.direction.x + dy * line.direction.y;
      return (
        distance(origin, {
          x: line.point.x + projection * line.direction.x,
          y: line.point.y + projection * line.direction.y,
        }) <=
        Math.max(
          document.geometrySettings.joinToleranceMM * pixelsPerMM,
          epsilon,
        )
      );
    });
    return freeze({ origin, lines, points, lockedId: locked?.id });
  } catch {
    // A blocked/malformed construction graph cannot safely supply stale guides.
    return null;
  }
}
