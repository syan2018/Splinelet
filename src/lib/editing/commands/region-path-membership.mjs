import { regionPathMemberships } from '../region-drawing.mjs';
import { effectiveNodeState } from '../../scene/hierarchy.mjs';
import { createCommandIdAllocator } from '../command-ids.mjs';

const identity = [1, 0, 0, 1, 0, 0];
const local = (ref, ownerNodeId) =>
  ref?.kind === 'port' &&
  ref.ownerNodeId === ownerNodeId &&
  ref.domain === 'curves' &&
  ref.port === 'curves' &&
  ref.space === 'local-result' &&
  Array.isArray(ref.transform) &&
  ref.transform.length === 6 &&
  ref.transform.every((value, i) => value === identity[i]);

/** Toggle exactly one use of a source path. No source edits, role table,
 * downstream reconstruction or derived geometry writes. */
export function createRegionPathMembershipCommand(request) {
  const action = structuredClone(request);
  return (document, { idFactory }) => {
    if (
      action.kind !== 'set-region-path-membership' ||
      Object.keys(action).some(
        (key) => !['kind', 'pathRef', 'operatorId', 'included'].includes(key),
      ) ||
      typeof action.included !== 'boolean'
    )
      throw Error('区域线条参与命令无效');
    const uses = regionPathMemberships(document, action.pathRef).filter(
      (use) => use.operatorId === action.operatorId,
    );
    if (uses.length !== 1) throw Error('请指定唯一的区域线条参与关系');
    const use = uses[0];
    if (use.drawing) throw Error('请先完成线条绘制');
    if (
      regionPathMemberships(document, action.pathRef).filter(
        (candidate) => candidate.inputOperatorId === use.inputOperatorId,
      ).length !== 1
    )
      throw Error('同一构面输入有多个区域用途，请先明确拆分构造');
    if (effectiveNodeState(document, use.ownerNodeId).locked)
      throw Error('部件已锁定');
    const program =
      document.programs[document.nodes[use.ownerNodeId].programId];
    const consumer = program.operators[use.inputOperatorId];
    if (
      !consumer.enabled ||
      !program.operators[use.operatorId].enabled ||
      !program.operators[use.sourceId].enabled
    )
      throw Error('请先启用对应构造和来源');
    const oldInput = consumer.inputs[use.inputPort][0];
    const oldFilter = program.operators[use.filterId];
    if (
      !local(oldInput, use.ownerNodeId) ||
      (oldFilter &&
        (!oldFilter.enabled ||
          !local(oldFilter.inputs.input[0], use.ownerNodeId)))
    )
      throw Error('此参与关系包含变换或停用的筛选，请通过对应构造编辑');
    if (use.included === action.included) return { document, changedRefs: [] };

    const next = structuredClone(document);
    const nextProgram = next.programs[program.id];
    const allocate = createCommandIdAllocator(next, idFactory);
    // A filter may be shared by other graph consumers. Copy it before changing
    // this particular input so toggling one use cannot affect another branch.
    const references = Object.values(document.programs)
      .flatMap((item) => [
        ...Object.values(item.outputs),
        ...Object.values(item.operators).flatMap((op) =>
          Object.values(op.inputs).flat(),
        ),
      ])
      .filter(
        (ref) =>
          ref?.kind === 'port' &&
          ref.ownerNodeId === use.ownerNodeId &&
          ref.operatorId === use.filterId,
      );
    const filterId =
      oldFilter && references.length === 1 ? oldFilter.id : allocate();
    const filter = oldFilter
      ? structuredClone(oldFilter)
      : {
          type: 'curve-filter',
          name: '线条参与',
          enabled: true,
          inputs: { input: [structuredClone(oldInput)] },
          params: { excludedPaths: [] },
        };
    filter.id = filterId;
    const same = (ref) =>
      ref.sketchId === action.pathRef.sketchId && ref.id === action.pathRef.id;
    filter.params.excludedPaths = filter.params.excludedPaths.filter(
      (ref) => !same(ref),
    );
    if (!action.included)
      filter.params.excludedPaths.push({
        kind: 'path',
        sketchId: action.pathRef.sketchId,
        id: action.pathRef.id,
      });
    nextProgram.operators[filterId] = filter;
    nextProgram.operators[use.inputOperatorId].inputs[use.inputPort] = [
      {
        kind: 'port',
        ownerNodeId: use.ownerNodeId,
        operatorId: filterId,
        domain: 'curves',
        port: 'curves',
        space: 'local-result',
        transform: [...identity],
      },
    ];
    return {
      document: next,
      changedRefs: [{ kind: 'node', id: use.ownerNodeId }, action.pathRef],
    };
  };
}
