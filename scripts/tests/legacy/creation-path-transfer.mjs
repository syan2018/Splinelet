import {
  acceptDividerGraph,
  regionSources,
} from '../../../src/lib/creation-schema.mjs';
import { usesCurvePipeline } from '../../../src/lib/modifier-stages.mjs';

// A modifier or a paint record is not a lock on every path in a collection.
// Only paths participating in the owner's surface construction need the
// existing coordinated-transfer safeguards. Draft boundaries and guides are
// free to move, including out of an object they were just moved into.
function independentPaths(project, object) {
  const dependencies = new Set([
    ...(usesCurvePipeline(object) ? object.pathIds : []),
    ...object.featureIds.flatMap((id) =>
      regionSources(
        project.model,
        project.model?.features.find((f) => f.id === id)?.regionId,
      ),
    ),
    ...(object.regionIds || []).flatMap((id) =>
      regionSources(project.model, id),
    ),
    ...(object.baseRegionIds || []).flatMap((id) =>
      regionSources(project.model, id),
    ),
    ...(object.clipRegionIds || []).flatMap((id) =>
      regionSources(project.model, id),
    ),
    ...(object.basePathIds || []),
  ]);
  const inputPaths = (input) =>
    input?.kind === 'path'
      ? [input.id]
      : input?.kind === 'region'
        ? regionSources(project.model, input.id)
        : [];
  for (const source of Object.values(object.sources || {})) {
    for (const id of regionSources(project.model, source.regionId))
      dependencies.add(id);
    for (const modifier of source.modifiers)
      for (const id of inputPaths(modifier.input)) dependencies.add(id);
  }
  for (const modifier of object.modifiers || [])
    for (const id of inputPaths(modifier.input)) dependencies.add(id);
  return new Set(
    project.paths
      .filter((path) => {
        const role =
          object.roles[path.id] || (path.closed ? 'boundary' : 'guide');
        return (
          object.pathIds.includes(path.id) &&
          !dependencies.has(path.id) &&
          (role === 'guide' || (role === 'boundary' && !path.closed))
        );
      })
      .map((path) => path.id),
  );
}

export function moveCreationPaths(p, creation, a) {
  const target = creation.objects.find((o) => o.id === a.objectId),
    ids = new Set(a.pathIds),
    donors = new Set();
  if (!target) throw Error('目标集合已不存在');
  acceptDividerGraph(target);
  for (const id of ids)
    if (!p.paths.some((p) => p.id === id)) throw Error('线条已不存在');
  for (const o of creation.objects) {
    if (o.id !== target.id) {
      const moved = o.pathIds.filter((id) => ids.has(id));
      const independent = independentPaths(p, o);
      const constructing = moved.filter((id) => !independent.has(id));
      if (
        constructing.length &&
        creation.printStack &&
        o.printLayerId !== target.printLayerId
      )
        throw Error(
          '这条线参与的面属于另一个堆叠层；请先调整部件所属层，再整理构造',
        );
      if (constructing.length && o.modifiers?.length)
        throw Error(
          `「${p.paths.find((path) => path.id === constructing[0]).name}」参与「${o.name}」的面或修改器构造，需连同对应构造一起整理；未参与构造的线条可直接移动`,
        );
      if (moved.length) donors.add(o.id);
      if (
        constructing.length &&
        (o.paints.length || o.surfaceGraph?.outputs.length)
      ) {
        if (moved.length !== o.pathIds.length || o.baseRegionIds?.length)
          throw Error(
            '这个对象已有局部填色，请整体整理部件；分区线的位置可在画布中直接编辑',
          );
        if (
          o.attachId ||
          target.attachId ||
          o.zMM !== target.zMM ||
          creation.objects.some((other) => other.attachId === o.id)
        )
          throw Error('这些部件的高度基准或叠放关系不同，请保留独立部件');
        target.paints.push(...o.paints);
        o.paints = [];
        if (o.surfaceGraph) {
          target.surfaceGraph ||= { version: 1, outputs: [] };
          target.surfaceGraph.outputs.push(...o.surfaceGraph.outputs);
          delete o.surfaceGraph;
        }
      }
      const ownsInput = (id) => {
        const own = regionSources(p.model, id).filter((id) =>
          o.pathIds.includes(id),
        );
        return own.length && own.every((id) => ids.has(id));
      };
      const movedFeatures = o.featureIds.filter((id) =>
        ownsInput(p.model.features.find((f) => f.id === id)?.regionId),
      );
      for (const id of movedFeatures) {
        target.featureIds.push(id);
        target.featureSwatches[id] = o.featureSwatches[id];
        delete o.featureSwatches[id];
        if (o.sources?.[id]) {
          target.sources[id] = o.sources[id];
          delete o.sources[id];
        }
      }
      o.featureIds = o.featureIds.filter((id) => !movedFeatures.includes(id));
      const movedRegions = o.regionIds.filter(ownsInput);
      target.regionIds.push(...movedRegions);
      o.regionIds = o.regionIds.filter((id) => !movedRegions.includes(id));
    }
    for (const id of ids)
      if (o.pathIds.includes(id)) {
        if (o.roles[id]) target.roles[id] = o.roles[id];
        else delete target.roles[id];
        if (o.id !== target.id) delete o.roles[id];
      }
    o.pathIds = o.pathIds.filter((id) => !ids.has(id));
  }
  target.pathIds.push(...ids);
  for (const path of p.paths.filter((path) => ids.has(path.id))) {
    if (p.groups?.some((group) => group.id === target.groupId))
      path.groupId = target.groupId;
    else delete path.groupId;
  }
  creation.objects = creation.objects.filter(
    (o) =>
      !donors.has(o.id) ||
      o.pathIds.length ||
      o.featureIds.length ||
      o.regionIds.length ||
      o.paints.length ||
      o.surfaceGraph?.outputs.length ||
      o.baseRegionIds?.length ||
      o.basePathIds?.length ||
      o.modifiers?.length ||
      creation.objects.some(
        (other) =>
          other.attachId === o.id ||
          other.modifiers?.some(
            (modifier) =>
              modifier.input?.kind === 'object' && modifier.input.id === o.id,
          ),
      ),
  );
}
