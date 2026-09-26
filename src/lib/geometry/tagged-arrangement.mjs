import ArrayList from 'jsts/java/util/ArrayList.js';
import Coordinate from 'jsts/org/locationtech/jts/geom/Coordinate.js';
import PrecisionModel from 'jsts/org/locationtech/jts/geom/PrecisionModel.js';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import NodedSegmentString from 'jsts/org/locationtech/jts/noding/NodedSegmentString.js';
import NodingValidator from 'jsts/org/locationtech/jts/noding/NodingValidator.js';
import MCIndexSnapRounder from 'jsts/org/locationtech/jts/noding/snapround/MCIndexSnapRounder.js';
import RelateOp from 'jsts/org/locationtech/jts/operation/relate/RelateOp.js';
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js';

const clone = (value) => structuredClone(value);
const reader = new GeoJSONReader();
const compareNumber = (left, right) => left - right;
const comparePoint = (left, right) =>
  compareNumber(left[0], right[0]) || compareNumber(left[1], right[1]);
const samePoint = (left, right) => left[0] === right[0] && left[1] === right[1];
const pointKey = ([x, y]) => `${x},${y}`;
const edgeKey = (from, to) => `${pointKey(from)}|${pointKey(to)}`;
const signedArea = (ring) =>
  ring
    .slice(1)
    .reduce(
      (area, point, index) =>
        area + ring[index][0] * point[1] - point[0] * ring[index][1],
      0,
    ) / 2;
const ringCoordinates = (halfEdges) => [
  halfEdges[0].from.slice(),
  ...halfEdges.map((halfEdge) => halfEdge.to.slice()),
];
const flip = (direction) => (direction === '+' ? '-' : '+');

function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw Error('source 必须是 JSON 可表示的有限值');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!value || Object.getPrototypeOf(value) !== Object.prototype)
    throw Error('source 必须是 JSON object、array 或 primitive');
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

const numericPoint = (value) =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((coordinate) => Number.isFinite(coordinate));

const snapPoint = (point, precisionScale) => {
  const snap = (coordinate) => {
    if (Math.abs(coordinate * precisionScale) > Number.MAX_SAFE_INTEGER)
      throw Error('坐标超出 precisionScale 的安全整数范围');
    const value = Math.round(coordinate * precisionScale) / precisionScale;
    return Object.is(value, -0) ? 0 : value;
  };
  return [snap(point[0]), snap(point[1])];
};

const sourceParameterAt = (data, point) => {
  const [fromX, fromY] = data.coordinates[0];
  const [toX, toY] = data.coordinates[1];
  const dx = toX - fromX;
  const dy = toY - fromY;
  const fraction =
    ((point[0] - fromX) * dx + (point[1] - fromY) * dy) / (dx * dx + dy * dy);
  return (
    data.sourceParameter[0] +
    fraction * (data.sourceParameter[1] - data.sourceParameter[0])
  );
};

const contribution = (data, from, to) => {
  const canonical = comparePoint(from, to) <= 0 ? [from, to] : [to, from];
  return {
    source: clone(data.source),
    sourceKey: data.sourceKey,
    direction: samePoint(from, canonical[0]) ? '+' : '-',
    sourceParameter: canonical.map((point) => sourceParameterAt(data, point)),
  };
};

const contributionKey = (item) =>
  JSON.stringify([item.sourceKey, item.direction, item.sourceParameter]);

const boundaryEdge = (halfEdge) => ({
  halfEdgeId: halfEdge.id,
  edgeId: halfEdge.edgeId,
  coordinates: [halfEdge.from.slice(), halfEdge.to.slice()],
  sources: clone(halfEdge.sources),
});

function nodeSegments(segments, precisionScale, diagnostics) {
  const inputs = new ArrayList();
  let snappedInputs = 0;
  for (const [index, segment] of segments.entries()) {
    if (
      !segment ||
      !Array.isArray(segment.coordinates) ||
      segment.coordinates.length !== 2
    )
      throw Error(`segments[${index}] 必须有两个 coordinates`);
    if (
      !numericPoint(segment.coordinates[0]) ||
      !numericPoint(segment.coordinates[1])
    )
      throw Error(`segments[${index}] coordinates 必须是有限二维点`);
    if (segment.source === undefined)
      throw Error(`segments[${index}] 必须提供 source`);
    const sourceKey = canonicalJson(segment.source);
    const sourceParameter = segment.sourceParameter || [0, 1];
    if (
      !Array.isArray(sourceParameter) ||
      sourceParameter.length !== 2 ||
      !sourceParameter.every(Number.isFinite)
    )
      throw Error(`segments[${index}] sourceParameter 必须是两个有限数`);
    const coordinates = segment.coordinates.map((point) =>
      snapPoint(point, precisionScale),
    );
    if (samePoint(coordinates[0], coordinates[1])) {
      diagnostics.push({
        code: samePoint(segment.coordinates[0], segment.coordinates[1])
          ? 'zero-length-segment'
          : 'snap-collapsed-segment',
        segmentIndex: index,
      });
      continue;
    }
    if (
      !samePoint(coordinates[0], segment.coordinates[0]) ||
      !samePoint(coordinates[1], segment.coordinates[1])
    )
      snappedInputs++;
    const data = {
      source: JSON.parse(sourceKey),
      sourceKey,
      sourceParameter: sourceParameter.slice(),
      coordinates,
    };
    inputs.add(
      new NodedSegmentString(
        coordinates.map((point) => new Coordinate(...point)),
        data,
      ),
    );
  }
  if (snappedInputs)
    diagnostics.push({ code: 'inputs-snapped', count: snappedInputs });
  if (!inputs.size()) return [];
  const noder = new MCIndexSnapRounder(new PrecisionModel(precisionScale));
  noder.computeNodes(inputs);
  const noded = noder.getNodedSubstrings();
  new NodingValidator(noded).checkValid();
  const output = [];
  for (const iterator = noded.iterator(); iterator.hasNext();) {
    const substring = iterator.next();
    const data = substring.getData();
    const coordinates = substring
      .getCoordinates()
      .map((point) => snapPoint([point.x, point.y], precisionScale));
    for (let index = 1; index < coordinates.length; index++) {
      const from = coordinates[index - 1];
      const to = coordinates[index];
      if (samePoint(from, to)) {
        diagnostics.push({
          code: 'noded-zero-length-segment',
          sourceKey: data.sourceKey,
        });
        continue;
      }
      output.push({ from, to, data });
    }
  }
  return output;
}

function atomicEdges(noded) {
  const byKey = new Map();
  for (const substring of noded) {
    const [from, to] =
      comparePoint(substring.from, substring.to) <= 0
        ? [substring.from, substring.to]
        : [substring.to, substring.from];
    const key = edgeKey(from, to);
    const edge = byKey.get(key) || {
      coordinates: [from.slice(), to.slice()],
      sources: [],
      sourceKeys: new Set(),
    };
    const item = contribution(substring.data, substring.from, substring.to);
    if (!edge.sourceKeys.has(contributionKey(item))) {
      edge.sources.push(item);
      edge.sourceKeys.add(contributionKey(item));
    }
    byKey.set(key, edge);
  }
  return [...byKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, edge], index) => ({
      id: `edge:${index}`,
      key,
      coordinates: edge.coordinates,
      sources: edge.sources.sort((left, right) =>
        contributionKey(left).localeCompare(contributionKey(right)),
      ),
    }));
}

const graph = (edges) => {
  const incident = new Map();
  const add = (vertex, edge) => {
    const key = pointKey(vertex);
    if (!incident.has(key)) incident.set(key, []);
    incident.get(key).push(edge);
  };
  for (const edge of edges) {
    add(edge.coordinates[0], edge);
    add(edge.coordinates[1], edge);
  }
  return incident;
};

function bridgeIds(edges) {
  const incident = graph(edges);
  const discovery = new Map();
  const low = new Map();
  const bridges = new Set();
  let sequence = 0;
  const visit = (vertexKey, parentEdgeId = null) => {
    const time = ++sequence;
    discovery.set(vertexKey, time);
    low.set(vertexKey, time);
    for (const edge of incident.get(vertexKey) || []) {
      if (edge.id === parentEdgeId) continue;
      const [from, to] = edge.coordinates;
      const next = pointKey(pointKey(from) === vertexKey ? to : from);
      if (!discovery.has(next)) {
        visit(next, edge.id);
        low.set(vertexKey, Math.min(low.get(vertexKey), low.get(next)));
        if (low.get(next) > discovery.get(vertexKey)) bridges.add(edge.id);
      } else
        low.set(vertexKey, Math.min(low.get(vertexKey), discovery.get(next)));
    }
  };
  for (const vertexKey of incident.keys())
    if (!discovery.has(vertexKey)) visit(vertexKey);
  return bridges;
}

function pruneDangles(edges) {
  let active = edges.slice();
  const dangles = new Set();
  const cutEdges = new Set();
  while (active.length) {
    const incident = graph(active);
    const leaves = new Set(
      [...incident.values()]
        .filter((items) => items.length <= 1)
        .flatMap((items) => items.map((edge) => edge.id)),
    );
    if (leaves.size) {
      for (const edgeId of leaves) dangles.add(edgeId);
      active = active.filter((edge) => !leaves.has(edge.id));
      continue;
    }
    const bridges = bridgeIds(active);
    if (!bridges.size) break;
    for (const edgeId of bridges) {
      dangles.add(edgeId);
      cutEdges.add(edgeId);
    }
    active = active.filter((edge) => !bridges.has(edge.id));
  }
  return {
    active,
    dangles: [...dangles].sort((left, right) => left.localeCompare(right)),
    cutEdges: [...cutEdges].sort((left, right) => left.localeCompare(right)),
  };
}

function buildHalfEdges(edges) {
  const vertices = new Map();
  const halfEdges = [];
  const add = (halfEdge) => {
    halfEdges.push(halfEdge);
    const key = pointKey(halfEdge.from);
    if (!vertices.has(key)) vertices.set(key, []);
    vertices.get(key).push(halfEdge);
  };
  for (const edge of edges) {
    const [from, to] = edge.coordinates;
    const orient = (forward) =>
      edge.sources.map((source) => ({
        ...clone(source),
        direction: forward ? source.direction : flip(source.direction),
        sourceParameter: forward
          ? source.sourceParameter.slice()
          : source.sourceParameter.slice().reverse(),
      }));
    const forward = {
      id: `${edge.id}:+`,
      edgeId: edge.id,
      from: from.slice(),
      to: to.slice(),
      twinId: `${edge.id}:-`,
      sources: orient(true),
    };
    const backward = {
      id: `${edge.id}:-`,
      edgeId: edge.id,
      from: to.slice(),
      to: from.slice(),
      twinId: `${edge.id}:+`,
      sources: orient(false),
    };
    add(forward);
    add(backward);
  }
  const byId = new Map(halfEdges.map((halfEdge) => [halfEdge.id, halfEdge]));
  for (const outgoing of vertices.values())
    outgoing.sort(
      (left, right) =>
        Math.atan2(left.to[1] - left.from[1], left.to[0] - left.from[0]) -
          Math.atan2(
            right.to[1] - right.from[1],
            right.to[0] - right.from[0],
          ) || left.id.localeCompare(right.id),
    );
  for (const halfEdge of halfEdges) {
    const outgoing = vertices.get(pointKey(halfEdge.to));
    const twinIndex = outgoing.findIndex(
      (candidate) => candidate.id === halfEdge.twinId,
    );
    if (twinIndex < 0) throw Error('half-edge twin 不在目标顶点');
    halfEdge.nextId =
      outgoing[(twinIndex - 1 + outgoing.length) % outgoing.length].id;
  }
  return { halfEdges, byId };
}

function faceCycles(halfEdges, byId, diagnostics) {
  const visited = new Set();
  const cycles = [];
  for (const first of halfEdges) {
    if (visited.has(first.id)) continue;
    const halfEdgeIds = [];
    let current = first;
    while (!visited.has(current.id)) {
      visited.add(current.id);
      halfEdgeIds.push(current.id);
      current = byId.get(current.nextId);
      if (!current) throw Error('half-edge next 不存在');
    }
    if (current.id !== first.id) {
      diagnostics.push({
        code: 'non-closing-half-edge-walk',
        halfEdgeId: first.id,
      });
      continue;
    }
    const walk = halfEdgeIds.map((id) => byId.get(id));
    const coordinates = ringCoordinates(walk);
    const area = signedArea(coordinates);
    cycles.push({
      halfEdgeIds,
      coordinates,
      area,
      usedEdgeIds: walk.map((item) => item.edgeId),
    });
  }
  return cycles;
}

/** A face walk may visit a cut vertex twice. Split it into simple directed
 * cycles before assigning shells and holes; every original half-edge remains
 * in exactly one child cycle. */
function splitRepeatedVertices(cycle) {
  const items = cycle.items || cycle.halfEdgeIds;
  const edgeId = (item) =>
    typeof item === 'string'
      ? item.slice(0, item.lastIndexOf(':'))
      : item.edgeId;
  const split = (halfEdgeIds, coordinates, currentItems) => {
    const seen = new Map();
    for (let index = 0; index < coordinates.length - 1; index++) {
      const key = pointKey(coordinates[index]);
      const start = seen.get(key);
      if (start === undefined) {
        seen.set(key, index);
        continue;
      }
      const firstIds = halfEdgeIds.slice(start, index);
      const secondIds = [
        ...halfEdgeIds.slice(index),
        ...halfEdgeIds.slice(0, start),
      ];
      const firstItems = currentItems.slice(start, index);
      const secondItems = [
        ...currentItems.slice(index),
        ...currentItems.slice(0, start),
      ];
      const firstCoordinates = coordinates.slice(start, index + 1);
      const secondCoordinates = [
        ...coordinates.slice(index),
        ...coordinates.slice(1, start + 1),
      ];
      return [
        ...split(firstIds, firstCoordinates, firstItems),
        ...split(secondIds, secondCoordinates, secondItems),
      ];
    }
    return [
      {
        ...cycle,
        halfEdgeIds,
        coordinates,
        area: signedArea(coordinates),
        usedEdgeIds: currentItems.map(edgeId),
        items: currentItems,
      },
    ];
  };
  return split(cycle.halfEdgeIds, cycle.coordinates, items);
}

const cyclePolygon = (cycle) =>
  reader.read({ type: 'Polygon', coordinates: [cycle.coordinates] });

function facesFromCycles(cycles, halfEdges, diagnostics) {
  const usable = cycles.flatMap(splitRepeatedVertices).filter((cycle) => {
    if (cycle.area !== 0) return true;
    diagnostics.push({
      code: 'zero-area-cycle',
      halfEdgeIds: cycle.halfEdgeIds,
    });
    return false;
  });
  const undirectedEdges = (cycle) =>
    cycle.usedEdgeIds.slice().sort((left, right) => left.localeCompare(right));
  const sameUndirectedEdges = (left, right) => {
    const leftIds = undirectedEdges(left);
    const rightIds = undirectedEdges(right);
    return (
      leftIds.length === rightIds.length &&
      leftIds.every((edgeId, index) => edgeId === rightIds[index])
    );
  };
  const positives = usable.filter((cycle) => cycle.area > 0);
  const negatives = usable.filter((cycle) => cycle.area < 0);
  const faces = positives.map((outer, index) => {
    const geometry = cyclePolygon(outer);
    if (!IsValidOp.isValid(geometry))
      throw Error('tagged arrangement 产生无效正向边界环');
    return {
      id: `face:${index}`,
      outer,
      geometry,
      holes: [],
    };
  });
  for (const negative of negatives) {
    const geometry = cyclePolygon(negative);
    if (!IsValidOp.isValid(geometry)) {
      diagnostics.push({
        code: 'invalid-negative-cycle',
        halfEdgeIds: negative.halfEdgeIds,
      });
      continue;
    }
    const container = faces
      .filter(
        (face) =>
          !sameUndirectedEdges(face.outer, negative) &&
          RelateOp.covers(face.geometry, geometry),
      )
      .sort(
        (left, right) => Math.abs(left.outer.area) - Math.abs(right.outer.area),
      )[0];
    if (!container) continue;
    container.holes.push(negative);
  }
  const byId = new Map(halfEdges.map((halfEdge) => [halfEdge.id, halfEdge]));
  return faces.map((face) => {
    const boundaryCycles = [face.outer, ...face.holes];
    for (const cycle of boundaryCycles)
      for (const halfEdgeId of cycle.halfEdgeIds)
        byId.get(halfEdgeId).faceId = face.id;
    const edgeBoundary = (cycle) =>
      cycle.halfEdgeIds.map((halfEdgeId) => boundaryEdge(byId.get(halfEdgeId)));
    const geometry = {
      type: 'Polygon',
      coordinates: [
        face.outer.coordinates,
        ...face.holes.map((hole) => hole.coordinates),
      ],
    };
    if (!IsValidOp.isValid(reader.read(geometry)))
      throw Error('tagged arrangement 产生无效面边界');
    return {
      id: face.id,
      geometry,
      boundary: {
        outer: edgeBoundary(face.outer),
        holes: face.holes.map(edgeBoundary),
      },
    };
  });
}

/**
 * Nodes tagged straight segments and returns a provenance-carrying planar DTO.
 * No polygon-boundary proximity matching is used to recover a source.
 */
export function buildTaggedArrangement({
  segments = [],
  precisionScale = 1e9,
} = {}) {
  if (!Array.isArray(segments)) throw Error('segments 必须是数组');
  if (!Number.isFinite(precisionScale) || precisionScale <= 0)
    throw Error('precisionScale 必须是正有限数');
  const diagnostics = [];
  const noded = nodeSegments(segments, precisionScale, diagnostics);
  const edges = atomicEdges(noded);
  const pruned = pruneDangles(edges);
  const { halfEdges, byId } = buildHalfEdges(pruned.active);
  const cycles = faceCycles(halfEdges, byId, diagnostics);
  const faces = facesFromCycles(cycles, halfEdges, diagnostics);
  for (const edgeId of pruned.cutEdges)
    diagnostics.push({ code: 'cut-edge-pruned', edgeId });
  const faceEdgeIds = new Set(
    faces.flatMap((face) => [
      ...face.boundary.outer.map((edge) => edge.edgeId),
      ...face.boundary.holes.flatMap((hole) => hole.map((edge) => edge.edgeId)),
    ]),
  );
  const dangles = [
    ...new Set([
      ...pruned.dangles,
      ...pruned.active
        .filter((edge) => !faceEdgeIds.has(edge.id))
        .map((edge) => edge.id),
    ]),
  ].sort((left, right) => left.localeCompare(right));
  return {
    precisionScale,
    atomicEdges: edges.map(({ id, coordinates, sources }) => ({
      id,
      coordinates,
      sources,
    })),
    halfEdges: halfEdges.map((halfEdge) => ({ ...halfEdge })),
    faces,
    dangles,
    diagnostics,
  };
}

/**
 * Returns the directed boundary of a selected face union without a geometry
 * union. A retained half-edge always has selected area on its left.
 */
export function extractTaggedBoundary(arrangement, selectedFaceIds) {
  if (!arrangement || !Array.isArray(arrangement.halfEdges))
    throw Error('arrangement 必须来自 buildTaggedArrangement');
  const selected = new Set(selectedFaceIds || []);
  if (!selected.size) return { exterior: [], holes: [], diagnostics: [] };
  const knownFaces = new Set((arrangement.faces || []).map((face) => face.id));
  for (const faceId of selected)
    if (!knownFaces.has(faceId)) throw Error(`未知 faceId：${faceId}`);
  const halfEdges = new Map(
    arrangement.halfEdges.map((halfEdge) => [halfEdge.id, halfEdge]),
  );
  const retained = new Set(
    arrangement.halfEdges
      .filter((halfEdge) => {
        const twin = halfEdges.get(halfEdge.twinId);
        return selected.has(halfEdge.faceId) && !selected.has(twin?.faceId);
      })
      .map((halfEdge) => halfEdge.id),
  );
  const outgoing = new Map();
  for (const halfEdgeId of retained) {
    const halfEdge = halfEdges.get(halfEdgeId);
    const key = pointKey(halfEdge.from);
    if (!outgoing.has(key)) outgoing.set(key, []);
    outgoing.get(key).push(halfEdge);
  }
  for (const values of outgoing.values())
    values.sort(
      (left, right) =>
        Math.atan2(left.to[1] - left.from[1], left.to[0] - left.from[0]) -
          Math.atan2(
            right.to[1] - right.from[1],
            right.to[0] - right.from[0],
          ) || left.id.localeCompare(right.id),
    );
  const next = (halfEdge) => {
    const values = outgoing.get(pointKey(halfEdge.to)) || [];
    const twinAngle = Math.atan2(
      halfEdge.from[1] - halfEdge.to[1],
      halfEdge.from[0] - halfEdge.to[0],
    );
    const ordered = [...values].sort(
      (left, right) =>
        ((twinAngle -
          Math.atan2(left.to[1] - left.from[1], left.to[0] - left.from[0]) +
          Math.PI * 2) %
          (Math.PI * 2)) -
          ((twinAngle -
            Math.atan2(
              right.to[1] - right.from[1],
              right.to[0] - right.from[0],
            ) +
            Math.PI * 2) %
            (Math.PI * 2)) || left.id.localeCompare(right.id),
    );
    return ordered[0];
  };
  const visited = new Set();
  const rings = [];
  const diagnostics = [];
  for (const startId of retained) {
    if (visited.has(startId)) continue;
    const ring = [];
    let current = halfEdges.get(startId);
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      ring.push(current);
      current = next(current);
    }
    if (!current || current.id !== startId) {
      diagnostics.push({
        code: 'non-manifold-selected-boundary',
        halfEdgeId: startId,
      });
      continue;
    }
    const pieces = splitRepeatedVertices({
      halfEdgeIds: ring.map((halfEdge) => halfEdge.id),
      coordinates: ringCoordinates(ring),
      items: ring,
    });
    for (const piece of pieces) {
      if (piece.area === 0) {
        diagnostics.push({
          code: 'zero-area-selected-boundary',
          halfEdgeId: startId,
        });
        continue;
      }
      rings.push({
        coordinates: piece.coordinates,
        area: piece.area,
        edges: piece.items.map(boundaryEdge),
      });
    }
  }
  return {
    exterior: rings.filter((ring) => ring.area > 0),
    holes: rings.filter((ring) => ring.area < 0),
    diagnostics,
  };
}
