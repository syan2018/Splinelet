import { resolveSketch } from '../geometry/sketch.mjs';
import { resolveRelation } from '../geometry/relations.mjs';
import { worldMatrix, transformPoint } from '../scene/transforms.mjs';
import { resolveAppearance } from '../relief/appearance.mjs';

const mapCoordinates = (coordinates, matrix) =>
  coordinates.length === 2 && coordinates.every(Number.isFinite)
    ? transformPoint(matrix, coordinates)
    : coordinates.map((value) => mapCoordinates(value, matrix));
const aggregate = (domain, field, stages, values) => {
  const diagnostics = stages.flatMap((stage) => stage.diagnostics || []);
  const blocked =
    stages.some((stage) => stage.status === 'blocked') ||
    diagnostics.some((item) => item.severity === 'error');
  return {
    domain,
    status: blocked ? 'blocked' : values.length ? 'ready' : 'empty',
    ...(blocked
      ? {}
      : { value: { frame: { kind: 'world' }, [field]: values } }),
    diagnostics,
    dependencies: [
      ...new Set(stages.flatMap((stage) => stage.dependencies || [])),
    ],
  };
};

/** Derived export views belong to the same evaluation snapshot, including poses and appearance. */
export function evaluateExportViews(
  document,
  { source = false, regions = [] } = {},
) {
  const sourceStages = [],
    curves = [],
    worldRegions = [],
    appearanceStages = [];
  if (source)
    for (const sketch of Object.values(document.sketches)) {
      const stage = resolveSketch(document, sketch.id, { resolveRelation });
      sourceStages.push(stage);
      if (stage.status !== 'ready') continue;
      const matrix = worldMatrix(document, sketch.ownerNodeId);
      curves.push(
        ...stage.value.curves.map((curve) => ({
          ...curve,
          ownerNodeId: sketch.ownerNodeId,
          edges: curve.edges.map((edge) => ({
            ...edge,
            transform: matrix,
            cubic: edge.cubic.map((point) => transformPoint(matrix, point)),
          })),
        })),
      );
    }
  for (const stage of regions) {
    if (stage.status !== 'ready') continue;
    for (const region of stage.value.regions) {
      const appearance = resolveAppearance(
        document,
        region.ref.ownerNodeId,
        region.ref,
      );
      appearanceStages.push(appearance);
      const matrix = worldMatrix(document, region.ref.ownerNodeId);
      worldRegions.push({
        ...region,
        color: appearance.value?.color || null,
        geometry: {
          ...region.geometry,
          coordinates: mapCoordinates(region.geometry.coordinates, matrix),
        },
      });
    }
  }
  return {
    sourceCurves: aggregate('curves', 'curves', sourceStages, curves),
    worldRegions: aggregate(
      'regions',
      'regions',
      [...regions, ...appearanceStages],
      worldRegions,
    ),
  };
}
