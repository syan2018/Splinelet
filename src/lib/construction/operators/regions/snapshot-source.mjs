import { readGeometry } from '../../../region-engine.mjs';
import { resolveRegionDefinitions } from '../../region-definitions.mjs';
import { transformPoint } from '../../../scene/transforms.mjs';

/** Explicit author data, never an automatic fallback to an evaluation cache. */
export const regionSnapshotSourceOperator = {
  type: 'region-snapshot-source',
  inputPorts: {},
  outputPorts: { regions: { domain: 'regions' } },
  validateParams(params) {
    if (
      Object.keys(params).some(
        (key) => !['regions', 'sourceRevision'].includes(key),
      ) ||
      !Number.isInteger(params.sourceRevision) ||
      params.sourceRevision < 0 ||
      !Array.isArray(params.regions)
    )
      return '快照来源参数无效';
    const ids = new Set();
    for (const region of params.regions) {
      if (
        Object.keys(region).some((key) => !['id', 'geometry'].includes(key)) ||
        typeof region.id !== 'string' ||
        !region.id ||
        ids.has(region.id) ||
        !['Polygon', 'MultiPolygon'].includes(region.geometry?.type)
      )
        return '快照区域无效或重复';
      ids.add(region.id);
      try {
        if (!readGeometry(region.geometry).isValid()) return '快照包含无效几何';
      } catch {
        return '快照几何无法读取';
      }
    }
    return true;
  },
  copy: (operator) => structuredClone(operator),
  rebase(operator, { transform }) {
    const next = structuredClone(operator);
    const coordinates = (value) =>
      typeof value[0] === 'number'
        ? transformPoint(transform, value)
        : value.map(coordinates);
    for (const region of next.params.regions)
      region.geometry.coordinates = coordinates(region.geometry.coordinates);
    return next;
  },
  evaluate({ document, ownerNodeId, operator }) {
    const candidates = operator.params.regions.map((region) => {
      const polygons =
        region.geometry.type === 'Polygon'
          ? [region.geometry.coordinates]
          : region.geometry.coordinates;
      const boundaries = polygons.map((polygon, polygonIndex) => {
        const rings = polygon.map((ring, ringIndex) =>
          ring.slice(1).map((point, index) => ({
            coordinates: [ring[index], point],
            sources: [
              {
                source: {
                  kind: 'baked-boundary',
                  operatorId: operator.id,
                  role: `boundary:${polygonIndex}:${ringIndex}`,
                  regionId: region.id,
                  parity: 1,
                },
                sourceParameter: [index, index + 1],
              },
            ],
          })),
        );
        return { outer: rings[0], holes: rings.slice(1) };
      });
      return {
        geometry: structuredClone(region.geometry),
        boundaries,
        selector: { kind: 'result', role: 'snapshot', id: region.id },
      };
    });
    return {
      regions: resolveRegionDefinitions(
        document,
        ownerNodeId,
        operator.id,
        candidates,
      ),
    };
  },
};
