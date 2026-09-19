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

const requirePath = (document, ref, closed = false) => {
  const sketch = document.sketches[ref?.sketchId];
  const path = ref?.kind === 'path' && sketch?.paths[ref.id];
  if (!path) throw Error('追加轮廓需要现有源路径');
  const ownerNodeId = sketch.ownerNodeId;
  if (effectiveNodeState(document, ownerNodeId).locked)
    throw Error('部件已锁定');
  const program = document.programs[document.nodes[ownerNodeId]?.programId];
  if (!program) throw Error('轮廓必须属于现有部件');
  if (closed) {
    const first = path.edges[0],
      last = path.edges.at(-1);
    if (
      !first ||
      !last ||
      sketch.edges[first.edgeId][
        first.reversed ? 'endVertexId' : 'startVertexId'
      ] !==
        sketch.edges[last.edgeId][
          last.reversed ? 'startVertexId' : 'endVertexId'
        ]
    )
      throw Error('追加轮廓必须闭合');
  }
  return { sketch, path, program, ownerNodeId };
};

/** Keep the new raw boundary and its unpublished Fill independently resumable. */
export function prepareBoundaryBranch(document, ref, { idFactory }) {
  const { sketch, path, program, ownerNodeId } = requirePath(document, ref);
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
  program.operators[fillId].enabled = false;
  program.operators[fillId].authoring = { phase: 'drawing' };
  return { ownerNodeId, operatorId: fillId };
}

export function finishBoundaryBranch(
  document,
  ref,
  { operatorId },
  { idFactory },
) {
  const { sketch, path, program, ownerNodeId } = requirePath(
    document,
    ref,
    true,
  );
  const fill = program.operators[operatorId];
  const sourceRef = fill?.inputs.input?.[0];
  const source =
    sourceRef?.ownerNodeId === ownerNodeId &&
    program.operators[sourceRef.operatorId];
  const paths = source?.inputs.paths;
  if (
    fill?.type !== 'fill' ||
    fill.authoring?.phase !== 'drawing' ||
    fill.enabled ||
    fill.inputs.input.length !== 1 ||
    source?.type !== 'source' ||
    paths?.length !== 1 ||
    paths[0].kind !== 'sketch' ||
    paths[0].sketchId !== sketch.id ||
    paths[0].pathIds?.length !== 1 ||
    paths[0].pathIds[0] !== path.id
  )
    throw Error('待完成的轮廓构造已变化，请先修复');
  const before = evaluateProgram(document, ownerNodeId);
  if (
    !['ready', 'empty', 'absent'].includes(before.regions.status) ||
    !['ready', 'empty', 'absent'].includes(before.curves.status)
  )
    throw Error('请先修复当前部件的已发布输出');
  const oldRegions = program.outputs.regions,
    oldCurves = program.outputs.curves;
  const sourceId = source.id,
    fillId = fill.id;
  const allocateId = createCommandIdAllocator(document, idFactory);
  delete fill.authoring;
  fill.enabled = true;
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
}

/** Publish one independent raw boundary without rewriting existing region identities. */
export function createAppendBoundaryCommand(request) {
  const action = structuredClone(request);
  return (document, context) => {
    if (action.kind !== 'append-boundary') throw Error('未知的追加轮廓动作');
    requirePath(document, action.pathRef, true);
    const branch = prepareBoundaryBranch(document, action.pathRef, context);
    return finishBoundaryBranch(document, action.pathRef, branch, context);
  };
}
