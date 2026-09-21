import { effectiveNodeState } from '../../scene/hierarchy.mjs';
import {
  regionPathMemberships,
  regionSourcePaths,
} from '../region-drawing.mjs';
import { createRegionPathMembershipCommand } from './region-path-membership.mjs';
import { createRegionCommand } from './regions.mjs';
import { evaluateProgram } from '../../construction/document-evaluation.mjs';
import { createCommandIdAllocator } from '../command-ids.mjs';

const clone = (value) => structuredClone(value);
const identity = [1, 0, 0, 1, 0, 0];
const port = (ownerNodeId, operatorId, domain) => ({
  kind: 'port',
  ownerNodeId,
  operatorId,
  domain,
  port: domain,
});
const input = (ref) => ({
  ...clone(ref),
  space: 'local-result',
  transform: [...identity],
});
const op = (id, type, name, inputs, params = {}) => ({
  id,
  type,
  name,
  enabled: true,
  inputs,
  params,
});
const local = (ref, owner) =>
  ref?.kind === 'port' &&
  ref.ownerNodeId === owner &&
  ref.domain === 'curves' &&
  ref.port === 'curves' &&
  ref.space === 'local-result' &&
  Array.isArray(ref.transform) &&
  ref.transform.length === 6 &&
  ref.transform.every((v, i) => v === identity[i]);
const pathState = (document, ref) => {
  const sketch = document.sketches[ref?.sketchId];
  const path = ref?.kind === 'path' && sketch?.paths[ref.id];
  if (!path) throw Error('线条不存在');
  if (effectiveNodeState(document, sketch.ownerNodeId).locked)
    throw Error('部件已锁定');
  const first = path.edges[0],
    last = path.edges.at(-1);
  const closed =
    first &&
    last &&
    sketch.edges[first.edgeId] &&
    sketch.edges[last.edgeId] &&
    sketch.edges[first.edgeId]?.[
      first.reversed ? 'endVertexId' : 'startVertexId'
    ] ===
      sketch.edges[last.edgeId]?.[
        last.reversed ? 'startVertexId' : 'endVertexId'
      ];
  return { sketch, path, owner: sketch.ownerNodeId, closed };
};

function addBoundary(document, ref, context) {
  const { owner } = pathState(document, ref);
  const program = document.programs[document.nodes[owner].programId];
  const before = evaluateProgram(document, owner).regions;
  if (!['ready', 'empty', 'absent'].includes(before.status))
    throw Error('请先修复当前部件的构面输出');
  const fill = program.operators[program.outputs.regions?.operatorId];
  let sourceInput = fill?.inputs.input?.[0];
  let source = program.operators[sourceInput?.operatorId];
  const filter = source?.type === 'curve-filter' ? source : null;
  if (filter) {
    sourceInput = filter.inputs.input?.[0];
    source = program.operators[sourceInput?.operatorId];
  }
  const consumers =
    source &&
    Object.values(document.programs)
      .flatMap((p) => [
        ...Object.values(p.outputs),
        ...Object.values(p.operators).flatMap((o) =>
          Object.values(o.inputs).flat(),
        ),
      ])
      .filter(
        (r) =>
          r?.kind === 'port' &&
          r.ownerNodeId === owner &&
          r.operatorId === source.id,
      );
  if (
    fill?.type === 'fill' &&
    fill.enabled &&
    fill.inputs.input.length === 1 &&
    local(fill.inputs.input[0], owner) &&
    (!filter || (filter.enabled && filter.inputs.input.length === 1)) &&
    local(sourceInput, owner) &&
    source?.type === 'source' &&
    source.enabled &&
    consumers.length === 1 &&
    source.inputs.paths.every((r) => r.kind === 'sketch')
  ) {
    // Extend the private Fill input without renumbering any existing Source
    // instances. This joins the ordinary even-odd contour set.
    source.inputs.paths.push({
      kind: 'sketch',
      sketchId: ref.sketchId,
      pathIds: [ref.id],
    });
  } else {
    // In a composed program a new boundary is an explicit independent branch.
    // Raw path publication is already owned by its existing source graph.
    const allocate = createCommandIdAllocator(document, context.idFactory);
    const sourceId = allocate(),
      fillId = allocate();
    program.operators[sourceId] = op(sourceId, 'source', '轮廓来源', {
      paths: [{ kind: 'sketch', sketchId: ref.sketchId, pathIds: [ref.id] }],
    });
    program.operators[fillId] = op(
      fillId,
      'fill',
      '轮廓构面',
      { input: [input(port(owner, sourceId, 'curves'))] },
      { rule: 'even-odd' },
    );
    let output = port(owner, fillId, 'regions');
    if (program.outputs.regions) {
      const id = allocate();
      program.operators[id] = op(id, 'region-collect', '汇总区域', {
        input: [input(program.outputs.regions), input(output)],
      });
      output = port(owner, id, 'regions');
    }
    program.outputs.regions = output;
  }
  if (evaluateProgram(document, owner).regions.status !== 'ready')
    throw Error('该线条不能形成有效边界');
}

/** Original path-role intent expressed exclusively as graph membership and
 * construction commands. Batch failure leaves the input document untouched. */
export function createPathRolesCommand(request) {
  const action = clone(request);
  return (initial, context) => {
    if (
      action.kind !== 'set-path-roles' ||
      Object.keys(action).some(
        (key) => !['kind', 'pathRefs', 'role'].includes(key),
      ) ||
      !['guide', 'boundary', 'divider', 'hole'].includes(action.role) ||
      !Array.isArray(action.pathRefs) ||
      !action.pathRefs.length
    )
      throw Error('请选择线条和有效用途');
    const refs = [
      ...new Map(
        action.pathRefs.map((ref) => [
          JSON.stringify([ref?.sketchId, ref?.id]),
          ref,
        ]),
      ).values(),
    ];
    const states = refs.map((ref) => pathState(initial, ref));
    if (new Set(states.map((state) => state.owner)).size !== 1)
      throw Error('一次用途操作只能修改同一部件');
    if (
      ['boundary', 'hole'].includes(action.role) &&
      states.some((state) => !state.closed)
    )
      throw Error('边界和挖洞线必须闭合');
    let document = clone(initial);
    for (const ref of refs) {
      const uses = regionPathMemberships(document, ref);
      if (
        !uses.length &&
        regionSourcePaths(document, states[0].owner).some(
          (path) => path.sketchId === ref.sketchId && path.id === ref.id,
        )
      )
        throw Error('此线条通过派生构面参与结果，请编辑对应构造');
      if (uses.some((use) => use.drawing)) throw Error('请先完成线条绘制');
      const active = uses.filter((use) => use.included);
      const matches = uses.filter((use) => use.role === action.role);
      if (active.length > 1 || matches.length > 1)
        throw Error('线条存在多个构造用途，请明确编辑对应分支');
      for (const use of active) {
        if (use.role === action.role) continue;
        if (use.role !== 'boundary') {
          const program =
            document.programs[document.nodes[use.ownerNodeId].programId];
          program.operators[use.operatorId].params.emptyInput = 'passthrough';
        }
        document = createRegionPathMembershipCommand({
          kind: 'set-region-path-membership',
          pathRef: ref,
          operatorId: use.operatorId,
          included: false,
        })(document, context).document;
      }
      if (action.role === 'guide') continue;
      if (matches.length) {
        document = createRegionPathMembershipCommand({
          kind: 'set-region-path-membership',
          pathRef: ref,
          operatorId: matches[0].operatorId,
          included: true,
        })(document, context).document;
      } else if (action.role === 'boundary')
        addBoundary(document, ref, context);
      else {
        const { owner } = pathState(document, ref);
        const stage = evaluateProgram(document, owner).regions;
        if (stage.status !== 'ready' || !stage.value.regions.length)
          throw Error('请先建立可编辑区域');
        document = createRegionCommand({
          kind: action.role === 'hole' ? 'cut-hole' : 'partition-regions',
          targets: stage.value.regions.map((region) => region.ref),
          cutter: { kind: 'sketch', sketchId: ref.sketchId, pathIds: [ref.id] },
        })(document, context).document;
      }
    }
    return {
      document,
      changedRefs: [{ kind: 'node', id: states[0].owner }, ...refs],
    };
  };
}
