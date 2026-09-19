import { projectSourceView } from './source-view.mjs';
import { projectCreationView } from './creation-view.mjs';

const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};

/**
 * The read boundary for the established Studio UI. Evaluated must be an
 * identity-bearing EvaluationSession result/capture, not an unversioned DTO.
 * This view is never passed to persistence or used as a mutable Project.
 */
export function projectWorkspaceView(editorState, evaluated, frame) {
  const identity = {
    epoch: editorState?.epoch,
    revision: editorState?.revision,
    previewId: editorState?.previewId ?? null,
  };
  if (
    typeof identity.epoch !== 'string' ||
    !identity.epoch ||
    !Number.isInteger(identity.revision) ||
    identity.revision < 0
  )
    throw Error('工作区视图需要有效的编辑会话身份');
  if (
    !evaluated?.snapshot ||
    ['epoch', 'revision', 'previewId'].some(
      (key) => evaluated[key] !== identity[key],
    )
  )
    throw Error('求值快照不属于当前工作区');
  const document =
    identity.previewId === null
      ? editorState.document
      : editorState.preview?.document;
  if (!document || document.version !== 4)
    throw Error('工作区缺少当前 V4 文档');
  const source = projectSourceView(document, frame);
  const creation = projectCreationView(document, evaluated.snapshot);
  return freeze({
    ...identity,
    source,
    creation: { ...identity, ...creation },
    canUndo: Boolean(editorState.canUndo),
    canRedo: Boolean(editorState.canRedo),
  });
}
