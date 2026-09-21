import GeoJSONWriter from 'jsts/org/locationtech/jts/io/GeoJSONWriter.js';
import DistanceOp from 'jsts/org/locationtech/jts/operation/distance/DistanceOp.js';
import UnaryUnionOp from 'jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js';
import { readGeometry } from '../../../region-engine.mjs';

const writer = new GeoJSONWriter();
const line = (coordinates) => readGeometry({ type: 'LineString', coordinates });
const point = (coordinates) => readGeometry({ type: 'Point', coordinates });
const union = (geometries) =>
  UnaryUnionOp.union(
    readGeometry({
      type: 'GeometryCollection',
      geometries: geometries.map((geometry) => {
        if (geometry.getGeometryType() !== 'LinearRing')
          return writer.write(geometry);
        return {
          type: 'LineString',
          coordinates: geometry.getCoordinates().map(({ x, y }) => [x, y]),
        };
      }),
    }),
  );

export function validatePartitionEndpointJoin(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy))
    return 'partition endpointJoin 必须是对象';
  if (
    Object.keys(policy).some(
      (key) => !['toleranceMM', 'disabled', 'cohorts'].includes(key),
    )
  )
    return 'partition endpointJoin 含未声明字段';
  if (!Number.isFinite(policy.toleranceMM) || policy.toleranceMM < 0)
    return 'partition endpointJoin.toleranceMM 必须是非负有限数';
  if (
    policy.disabled !== undefined &&
    (!Array.isArray(policy.disabled) ||
      policy.disabled.some(
        (entry) =>
          !entry ||
          typeof entry !== 'object' ||
          Array.isArray(entry) ||
          Object.keys(entry).some(
            (key) => !['pathId', 'endpoint'].includes(key),
          ) ||
          typeof entry.pathId !== 'string' ||
          !entry.pathId ||
          ![0, 1].includes(entry.endpoint),
      ))
  )
    return 'partition endpointJoin.disabled 必须是 Path 端点数组';
  if (
    !Array.isArray(policy.cohorts) ||
    policy.cohorts.some(
      (cohort) =>
        !Array.isArray(cohort) ||
        cohort.some((id) => typeof id !== 'string' || !id),
    )
  )
    return 'partition endpointJoin.cohorts 必须是 Path ID 数组';
  const flattened = policy.cohorts.flat();
  if (new Set(flattened).size !== flattened.length)
    return 'partition endpointJoin.cohorts 包含重复 Path ID';
  return true;
}

const validatePolicy = (policy, cutterIds) => {
  const valid = validatePartitionEndpointJoin(policy);
  if (valid !== true) throw Error(valid);
  const disabledEntries = policy.disabled || [];
  if (disabledEntries.some((entry) => !cutterIds.includes(entry.pathId)))
    throw Error('partition endpointJoin.disabled 含无效 Path 端点');
  const disabledKeys = disabledEntries.map(
    (entry) => `${entry.pathId}:${entry.endpoint}`,
  );
  if (new Set(disabledKeys).size !== disabledKeys.length)
    throw Error('partition endpointJoin.disabled 含重复 Path 端点');
  if (
    !Array.isArray(policy.cohorts) ||
    policy.cohorts.some(
      (cohort) =>
        !Array.isArray(cohort) || cohort.some((id) => typeof id !== 'string'),
    )
  )
    throw Error('partition endpointJoin.cohorts 必须是 Path ID 数组');
  const flattened = policy.cohorts.flat();
  if (
    new Set(flattened).size !== flattened.length ||
    flattened.some((id) => !cutterIds.includes(id))
  )
    throw Error('partition endpointJoin.cohorts 含缺失或重复 Path ID');
  return { disabled: new Set(disabledKeys), cohorts: policy.cohorts };
};

/**
 * Applies the legacy endpoint attachment policy to sampled cutter lines.
 * Returned coordinates are transient evaluation data; source curves and Paths
 * are never mutated or materialized.
 */
export function connectPartitionCutters({
  baseGeometries,
  cutters,
  endpointJoin,
}) {
  if (!endpointJoin)
    return {
      cutters: cutters.map((cutter) => ({
        ...structuredClone(cutter),
        geometry: line(cutter.coordinates),
      })),
      connections: [],
      diagnostics: [],
    };
  if (!Array.isArray(baseGeometries) || !baseGeometries.length)
    throw Error('partition endpointJoin 需要至少一个底面');
  if (
    !Array.isArray(cutters) ||
    cutters.some(
      (cutter) =>
        typeof cutter?.id !== 'string' ||
        !cutter.id ||
        !Array.isArray(cutter.coordinates) ||
        cutter.coordinates.length < 2,
    )
  )
    throw Error('partition endpointJoin 需要稳定 Path ID 与有效 cutter');
  const cutterIds = cutters.map((cutter) => cutter.id);
  if (new Set(cutterIds).size !== cutterIds.length)
    throw Error('partition endpointJoin cutter Path ID 重复');
  const { disabled, cohorts } = validatePolicy(endpointJoin, cutterIds);
  const cohortFor = new Map();
  cohorts.forEach((cohort, index) =>
    cohort.forEach((id) => cohortFor.set(id, index)),
  );
  const base = union(baseGeometries);
  const sourceLines = cutters.map((cutter) => line(cutter.coordinates));
  const connections = [];
  const diagnostics = [];
  const connected = cutters.map((cutter, index) => {
    const coordinates = cutter.coordinates.map((value) => value.slice());
    const targets = union([
      base.getBoundary(),
      ...sourceLines.filter(
        (_, targetIndex) =>
          index !== targetIndex &&
          (cohortFor.get(cutters[targetIndex].id) ?? Infinity) <=
            (cohortFor.get(cutter.id) ?? Infinity),
      ),
    ]);
    for (const end of [0, -1]) {
      const from = coordinates.at(end);
      const nearest = DistanceOp.nearestPoints(point(from), targets)[1];
      const to = [nearest.x, nearest.y];
      const gapMM = Math.hypot(from[0] - to[0], from[1] - to[1]);
      const endpoint = end === 0 ? 0 : 1;
      const isDisabled = disabled.has(`${cutter.id}:${endpoint}`);
      if (gapMM > 1e-7 && gapMM <= endpointJoin.toleranceMM && !isDisabled) {
        const extraMM = Math.min(0.005, endpointJoin.toleranceMM / 100);
        const extended = to.map(
          (value, axis) => value + ((value - from[axis]) / gapMM) * extraMM,
        );
        const connection = {
          pathId: cutter.id,
          endpoint,
          from: from.slice(),
          to,
          gapMM,
          extended,
        };
        connections.push(connection);
        diagnostics.push({
          code: 'partition-endpoint-connected',
          message: `分区线 ${cutter.id} 端点 ${endpoint} 已动态连接`,
          ...connection,
        });
        if (end === 0) coordinates.unshift(extended);
        else coordinates.push(extended);
      } else if (gapMM > 1e-7)
        diagnostics.push({
          code: isDisabled
            ? 'partition-endpoint-disabled'
            : 'partition-endpoint-unconnected',
          message: `分区线 ${cutter.id} 端点 ${endpoint} 未连接`,
          pathId: cutter.id,
          endpoint,
          from: from.slice(),
          to,
          gapMM,
          toleranceMM: endpointJoin.toleranceMM,
        });
    }
    return {
      ...structuredClone(cutter),
      coordinates,
      geometry: line(coordinates),
    };
  });
  return { cutters: connected, connections, diagnostics };
}
