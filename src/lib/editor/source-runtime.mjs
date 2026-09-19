import { beginRuntimeGesture } from './runtime-gesture.mjs';
import { projectSourceView, sourcePathId } from './source-view.mjs';
import { createSourceIntent } from './source-intents.mjs';
import { createPathIntent } from './path-intents.mjs';
import { createGroupIntent } from './group-intents.mjs';
import { createSplineIntent } from './spline-intents.mjs';

const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

/** Source controls share the owning runtime's issued projects and EditorSession.
 * A display frame is fixed for this runtime; replace the runtime when that
 * reference frame changes. Screen zoom and pan do not change this frame.
 */
export function createSourceRuntime({
  editorSession,
  sourceFrame,
  getEntry,
  issueProject,
  sameState,
}) {
  const frame = sourceFrame && freeze(structuredClone(sourceFrame));
  const current = (project, committed = true) => {
    const entry = getEntry(project);
    if (entry.token || !sameState(entry.state, editorSession.state))
      throw Error('源展示工程已过期或尚未提交');
    if (committed && entry.state.previewId) throw Error('请先完成当前源手势');
    return entry;
  };
  const view = (entry) => {
    if (!frame) throw Error('源编辑需要明确的展示坐标系');
    if (!entry.sourceView) {
      const state = entry.state;
      const document = state.previewId
        ? state.preview.document
        : state.document;
      entry.sourceView = freeze({
        epoch: state.epoch,
        revision: state.revision,
        previewId: state.previewId ?? null,
        previewVersion: state.preview?.version ?? null,
        source: projectSourceView(document, frame),
      });
    }
    return entry.sourceView;
  };
  const plan = (compile, request, { project }) => {
    const entry = current(project);
    const command = compile(request, view(entry));
    let consumed = false;
    return Object.freeze({
      project,
      commit() {
        if (consumed) throw Error('源命令已提交');
        current(project);
        const state = editorSession.dispatch(command, {
          expectedRevision: entry.state.revision,
        });
        consumed = true;
        return issueProject(state);
      },
    });
  };
  return {
    readSourceView(project) {
      return view(current(project, false));
    },
    commandSource(request, context) {
      return plan(createSourceIntent, request, context);
    },
    commandPath(request, context) {
      return plan(createPathIntent, request, context);
    },
    commandGroup(request, context) {
      return plan(createGroupIntent, request, context);
    },
    commandSplines(request, context) {
      const entry = current(context.project);
      let pathRefs;
      const prepared = plan(
        (args, captured) => {
          const command = createSplineIntent(
            args,
            captured,
            entry.state.document,
          );
          return (document, commandContext) => {
            const result = command(document, commandContext);
            pathRefs = result.selectionIntent.entityRefs;
            return result;
          };
        },
        request,
        context,
      );
      return Object.freeze({
        project: prepared.project,
        commit() {
          const project = prepared.commit();
          return {
            project,
            pathIds: pathRefs.map((ref) => sourcePathId(ref.sketchId, ref.id)),
          };
        },
      });
    },
    beginSourceGesture(project) {
      const entry = current(project);
      const captured = view(entry);
      return beginRuntimeGesture({
        editorSession,
        project,
        getEntry,
        issueProject,
        captured,
        compile: (request) => createSourceIntent(request, captured),
      });
    },
  };
}
