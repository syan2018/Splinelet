import { effectiveNodeState } from '../../scene/hierarchy.mjs';
import { definitionRef } from '../../construction/region-definitions.mjs';
import {
  inverseTransform,
  multiplyTransforms,
  transformPoint,
  worldMatrix,
} from '../../scene/transforms.mjs';

/** Adds a disconnected author Source. Publishing or reconnecting remains a
 * separate explicit action; this never silently replaces the broken chain. */
export function createBakeRegionSnapshotCommand(
  { ownerNodeId, name, sourceRevision, sourceWorldMatrix },
  stage,
) {
  if (
    stage?.domain !== 'regions' ||
    !['ready', 'empty'].includes(stage.status) ||
    stage.value?.frame?.kind !== 'local' ||
    stage.value.frame.ownerNodeId !== ownerNodeId
  )
    throw Error('只能固化属于当前部件的成功局部区域快照');
  const geometries = stage.value.regions.map((region) =>
    structuredClone(region.geometry),
  );
  return (document, { idFactory }) => {
    const owner = document.nodes[ownerNodeId];
    const program = document.programs[owner?.programId];
    if (
      document.version !== 5 ||
      owner?.kind !== 'shape' ||
      !program ||
      effectiveNodeState(document, ownerNodeId).locked
    )
      throw Error('无法向当前部件添加快照来源');
    if (!Number.isInteger(sourceRevision) || sourceRevision < 0)
      throw Error('快照修订无效');
    const operatorId = idFactory();
    const transform = sourceWorldMatrix
      ? multiplyTransforms(
          inverseTransform(worldMatrix(document, ownerNodeId)),
          sourceWorldMatrix,
        )
      : null;
    const coordinates = (value) =>
      typeof value[0] === 'number'
        ? transformPoint(transform, value)
        : value.map(coordinates);
    const regions = geometries.map((geometry) => ({
      id: idFactory(),
      geometry: transform
        ? { ...geometry, coordinates: coordinates(geometry.coordinates) }
        : structuredClone(geometry),
    }));
    program.operators[operatorId] = {
      id: operatorId,
      type: 'region-snapshot-source',
      name: name || `固定区域快照 · 修订 ${sourceRevision}`,
      enabled: true,
      inputs: {},
      params: { regions, sourceRevision },
    };
    const refs = regions.map((region) => {
      const definition = {
        id: idFactory(),
        context: { ownerNodeId, operatorId, port: 'regions', instances: [] },
        selector: { kind: 'result', role: 'snapshot', id: region.id },
      };
      document.regionDefinitions[definition.id] = definition;
      return definitionRef(definition);
    });
    return {
      document,
      changedRefs: [{ kind: 'program', id: program.id }, ...refs],
    };
  };
}
