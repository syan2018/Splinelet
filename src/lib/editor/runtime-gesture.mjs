/** One captured revision, one preview authority and at most one history entry.
 * Callers validate their domain selection before opening the preview.
 */
export function beginRuntimeGesture({
  editorSession,
  project,
  getEntry,
  issueProject,
  captured,
  compile,
}) {
  const active = editorSession.beginPreview({
    expectedRevision: captured.revision,
  });
  const options = {
    expectedRevision: captured.revision,
    previewId: active.previewId,
  };
  let finished = false;
  const assertActive = () => {
    getEntry(project);
    const state = editorSession.state;
    if (
      finished ||
      state.epoch !== captured.epoch ||
      state.revision !== captured.revision ||
      state.previewId !== active.previewId
    )
      throw Error('编辑手势已结束或失效');
  };
  return Object.freeze({
    update(request) {
      assertActive();
      return issueProject(
        editorSession.updatePreview(compile(request), options),
      );
    },
    commit() {
      assertActive();
      const state = editorSession.commitPreview(options);
      finished = true;
      return issueProject(state);
    },
    cancel() {
      assertActive();
      const state = editorSession.cancelPreview(options);
      finished = true;
      return issueProject(state);
    },
  });
}
