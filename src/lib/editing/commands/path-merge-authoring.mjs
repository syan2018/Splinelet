import { createPathMergeCommand } from './path-merge.mjs';
import {
  createSourceTransferCommand,
  inspectSourceTransfer,
} from './source-transfer.mjs';

/** Ordinary drawing may create multiple Sketches inside one owner. A merge
 * composes the existing keepWorld transfer and exact source merge in one undo.
 */
export function createPathMergeAuthoringCommand(request) {
  const action = structuredClone(request);
  return (document, context) => {
    if (action.firstPathRef?.sketchId === action.secondPathRef?.sketchId)
      return createPathMergeCommand(action)(document, context);
    const first = document.sketches[action.firstPathRef?.sketchId];
    const second = document.sketches[action.secondPathRef?.sketchId];
    if (!first || !second) throw Error('合并路径来源不存在');
    if (first.ownerNodeId !== second.ownerNodeId)
      throw Error('跨部件合并需要先明确转移线条来源');
    const transfer = {
      kind: 'transfer-source',
      sourceSketchId: second.id,
      targetSketchId: first.id,
      pathIds: [action.secondPathRef.id],
      keepWorld: true,
    };
    const inspection = inspectSourceTransfer(document, transfer);
    if (
      inspection.closure.pathIds.length !== 1 ||
      inspection.closure.pathIds[0] !== action.secondPathRef.id
    )
      throw Error('合并会转移其他共享路径，请先处理共享来源');
    const moved = createSourceTransferCommand(transfer)(document, context);
    const merged = createPathMergeCommand({
      ...action,
      secondPathRef: { ...action.secondPathRef, sketchId: first.id },
    })(moved.document, context);
    return {
      ...merged,
      changedRefs: [
        ...(moved.changedRefs || []),
        ...(merged.changedRefs || []),
      ],
      removedRefs: [
        ...(moved.removedRefs || []),
        ...(merged.removedRefs || []),
      ],
    };
  };
}
