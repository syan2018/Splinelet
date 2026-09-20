import { openProject } from '../persistence/open-project.mjs';
import { createStudioSession } from './studio-session.mjs';
import { createStudioPresentation } from './studio-presentation.mjs';

/** Application-facing session owner. Reference URLs have the same lifetime as
 * their opened document; failed opens retain the previous displayed resource.
 */
export function createStudioHost({ opened, presentation, urls, ...options }) {
  let lease = createStudioPresentation(opened, presentation, urls);
  let session;
  try {
    session = createStudioSession({
      ...options,
      opened,
      presentation: lease.presentation,
    });
  } catch (error) {
    lease.dispose();
    throw error;
  }
  let disposed = false;
  let opening = false;
  const alive = () => {
    if (disposed) throw Error('Studio 宿主已关闭');
  };
  const adopt = (candidate) => {
    if (disposed) {
      candidate.dispose();
      return;
    }
    const previous = lease;
    lease = candidate;
    previous.dispose();
  };
  const open = (next, nextPresentation) => {
    alive();
    if (opening) throw Error('正在切换工程');
    const candidate = createStudioPresentation(next, nextPresentation, urls);
    opening = true;
    try {
      const result = session.open(next, candidate.presentation);
      adopt(candidate);
      return result;
    } catch (error) {
      candidate.dispose();
      throw error;
    } finally {
      opening = false;
    }
  };
  return Object.freeze({
    getSnapshot() {
      alive();
      return session.getSnapshot();
    },
    subscribe(listener) {
      alive();
      return session.subscribe(listener);
    },
    agentCall(action, args) {
      alive();
      return session.agentCall(action, args);
    },
    setSelectionReader(read) {
      alive();
      session.setSelectionReader(read);
    },
    dispatch(command) {
      alive();
      return session.dispatch(command);
    },
    setBlenderExtrusion(depthMM) {
      alive();
      return session.setBlenderExtrusion(depthMM);
    },
    setSourceWidth(widthMM) {
      alive();
      return session.setSourceWidth(widthMM);
    },
    undo() {
      alive();
      return session.undo();
    },
    redo() {
      alive();
      return session.redo();
    },
    save(target) {
      alive();
      return session.save(target);
    },
    exportBytes() {
      alive();
      return session.exportBytes();
    },
    autosave() {
      alive();
      return session.autosave();
    },
    open,
    openBytes(input, nextPresentation) {
      alive();
      return open(openProject(input), nextPresentation);
    },
    async restore(presentationForDraft) {
      alive();
      let candidate;
      try {
        const result = await session.restore(async (draft) => {
          const nextPresentation = await presentationForDraft(draft);
          alive();
          candidate = createStudioPresentation(draft, nextPresentation, urls);
          return candidate.presentation;
        });
        alive();
        if (
          result &&
          session.getSnapshot().editorState.epoch !== result.editorState.epoch
        )
          throw Error('恢复的参考图已过期');
        if (candidate) adopt(candidate);
        return result;
      } catch (error) {
        candidate?.dispose();
        throw error;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      session.dispose();
      lease.dispose();
    },
  });
}
