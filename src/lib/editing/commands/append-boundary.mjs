import { evaluateProgram } from '../../construction/document-evaluation.mjs';
import { effectiveNodeState } from '../../scene/hierarchy.mjs';
import { createCommandIdAllocator } from '../command-ids.mjs';

const port = (ownerNodeId, operatorId, domain) => ({
  kind: 'port',
  ownerNodeId,
  operatorId,
  port: domain,
  domain,
});
const input = (ref) => ({
  ...structuredClone(ref),
  space: 'local-result',
  transform: [1, 0, 0, 1, 0, 0],
});
const operator = (id, type, name, inputs, params = {}) => ({
  id,
  type,
  name,
  inputs,
  params,
  enabled: true,
});

/** Publish one independent raw boundary without rewriting existing region identities. */
export function createAppendBoundaryCommand(request) {
  const action = structuredClone(request);
  return (document, { idFactory }) => {
    const ref = action.pathRef;
    const sketch = document.sketches[ref?.sketchId];
    const path = ref?.kind === 'path' && sketch?.paths[ref.id];
    if (action.kind !== 'append-boundary' || !path?.edges.length)
      throw Error('追加轮廓需要现有闭合源路径');
    const ownerNodeId = sketch.ownerNodeId;
    if (effectiveNodeState(document, ownerNodeId).locked)
      throw Error('部件已锁定');
    const program = document.programs[document.nodes[ownerNodeId]?.programId];
    if (!program) throw Error('轮廓必须属于现有部件');
    const first = path.edges[0],
      last = path.edges.at(-1);
    if (
      sketch.edges[first.edgeId][
        first.reversed ? 'endVertexId' : 'startVertexId'
      ] !==
      sketch.edges[last.edgeId][last.reversed ? 'startVertexId' : 'endVertexId']
    )
      throw Error('追加轮廓必须闭合');
    for (const candidate of Object.values(document.programs))
      for (const op of Object.values(candidate.operators))
        for (const refs of Object.values(op.inputs))
          if (
            refs.some(
              (value) =>
                value.kind === 'sketch' &&
                value.sketchId === sketch.id &&
                (!value.pathIds || value.pathIds.includes(path.id)),
            )
          )
            throw Error('此源路径已接入构造，不能重复追加');

    const before = evaluateProgram(document, ownerNodeId);
    if (
      !['ready', 'empty', 'absent'].includes(before.regions.status) ||
      !['ready', 'empty', 'absent'].includes(before.curves.status)
    )
      throw Error('请先修复当前部件的已发布输出');
    const oldRegions = program.outputs.regions;
    const oldCurves = program.outputs.curves;
    const allocateId = createCommandIdAllocator(document, idFactory);
    const sourceId = allocateId(),
      fillId = allocateId();
    program.operators[sourceId] = operator(sourceId, 'source', '追加轮廓', {
      paths: [{ kind: 'sketch', sketchId: sketch.id, pathIds: [path.id] }],
    });
    program.operators[fillId] = operator(
      fillId,
      'fill',
      '轮廓构面',
      {
        input: [input(port(ownerNodeId, sourceId, 'curves'))],
      },
      { rule: 'even-odd' },
    );
    let regionOutput = port(ownerNodeId, fillId, 'regions');
    if (oldRegions) {
      const collectId = allocateId();
      program.operators[collectId] = operator(
        collectId,
        'region-collect',
        '汇总区域',
        {
          input: [input(oldRegions), input(regionOutput)],
        },
      );
      regionOutput = port(ownerNodeId, collectId, 'regions');
    }
    let curveOutput = port(ownerNodeId, sourceId, 'curves');
    if (oldCurves) {
      const collectId = allocateId();
      program.operators[collectId] = operator(
        collectId,
        'curve-collect',
        '汇总曲线',
        {
          input: [input(oldCurves), input(curveOutput)],
        },
      );
      curveOutput = port(ownerNodeId, collectId, 'curves');
    }
    program.outputs.regions = regionOutput;
    program.outputs.curves = curveOutput;
    const after = evaluateProgram(document, ownerNodeId);
    if (
      after.regions.status !== 'ready' ||
      after.curves.status !== 'ready' ||
      after.regions.value.regions.length <=
        (before.regions.value?.regions.length ?? 0)
    )
      throw Error('新轮廓无法生成独立区域，未追加');
    return { document, changedRefs: [{ kind: 'node', id: ownerNodeId }, ref] };
  };
}
