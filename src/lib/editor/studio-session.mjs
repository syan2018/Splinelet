import {
  createReferenceCommand,
  orderedReferences,
} from '../editing/commands/references.mjs';
import { validateDocument } from '../document/schema.mjs';
import { createEditorSession } from '../editing/dispatcher.mjs';
import { createV4PersistenceSession } from '../persistence/v4-session.mjs';
import { createV4CreationRuntime } from './creation-runtime.mjs';
import { projectCreationView } from './creation-view.mjs';
import { projectSourceView } from './source-view.mjs';
import { projectStudioDisplay } from './studio-display.mjs';
import { createSourceScaleCommand } from '../editing/commands/source-scale.mjs';
import { createV4AgentAPI } from '../agent/v4-api.mjs';
import {
  createDocumentEvaluationSession,
  documentEvaluationDomains,
} from '../evaluation/document-session.mjs';

const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const documentOf = (state) =>
  state.previewId ? state.preview.document : state.document;

/** Owns the authority behind the original Studio shell. Render handles never
 * enter file storage or history; React subscribes to getSnapshot(). Reference
 * asset URLs are provided/owned by the host, not serialized into the document.
 */
export function createStudioSession({
  opened,
  presentation,
  persistence,
  idFactory,
  evaluate,
  onListenerError = () => {},
}) {
  const files = createV4PersistenceSession(persistence);
  const listeners = new Set();
  let disposed = false;
  let replacing = false;
  let snapshot;
  let runtime;
  let layout;
  let openedLayout;
  let storage;
  let selectionReader = () => null;
  const alive = () => {
    if (disposed) throw Error('Studio 会话已关闭');
  };
  const project = (state, creation, nextLayout) =>
    projectStudioDisplay(
      {
        epoch: state.epoch,
        revision: state.revision,
        source: projectSourceView(documentOf(state), nextLayout.frame),
        creation,
        canUndo: state.canUndo,
        canRedo: state.canRedo,
      },
      {
        reference: nextLayout.reference,
        frame: nextLayout.frame,
        session: {
          blenderExtrusionMM: nextLayout.blenderExtrusionMM,
          fileName: nextLayout.fileName,
          storageStatus: '',
          dirty: storage?.dirty ?? false,
        },
      },
    ).project;
  const prepareOpen = (input, nextPresentation) => {
    // All fallible input validation happens before replacing editor authority.
    const next = structuredClone(input);
    if (!['v4', 'legacy'].includes(next?.kind)) throw Error('未知工程格式');
    if (next.dirty !== undefined && typeof next.dirty !== 'boolean')
      throw Error('dirty 必须为布尔值');
    validateDocument(next.document);
    const nextLayout = freeze(
      structuredClone({
        ...nextPresentation,
        frame: next.document.sourceFrame || nextPresentation.frame,
      }),
    );
    project(
      {
        epoch: 'validate-open',
        revision: 0,
        document: next.document,
        previewId: null,
        canUndo: false,
        canRedo: false,
      },
      projectCreationView(next.document, {}),
      nextLayout,
    );
    return { next, nextLayout };
  };
  const initial = prepareOpen(opened, presentation);
  layout = initial.nextLayout;
  openedLayout = layout;
  const editor = createEditorSession(initial.next.document, { idFactory });
  const evaluation = createDocumentEvaluationSession({
    editorSession: editor,
    evaluate,
  });
  const agent = createV4AgentAPI({
    editorSession: editor,
    evaluationSession: evaluation.session,
    evaluationCapabilities: documentEvaluationDomains,
    getSelection: () => selectionReader(),
  });
  const openStorage = (input, state) =>
    files.open({
      ...input,
      epoch: state.epoch,
      revision: state.revision,
    });
  storage = openStorage(initial.next, editor.state);
  const makeRuntime = () =>
    createV4CreationRuntime({
      editorSession: editor,
      sourceFrame: layout.frame,
      evaluationService: evaluation,
      toDisplayProject: (state, creation) => project(state, creation, layout),
    });
  runtime = makeRuntime();
  const publish = (state) => {
    snapshot = Object.freeze({
      project: runtime.project(),
      runtime,
      editorState: state,
      storage,
      presentation: layout,
    });
    const currentListeners = [...listeners];
    for (const listener of currentListeners) {
      try {
        listener();
      } catch (error) {
        try {
          onListenerError(error);
        } catch {
          /* Observers cannot interrupt authority updates. */
        }
      }
    }
    return snapshot;
  };
  // Preview notifications publish display state only. A cancellation or no-op
  // undo retains the same committed identity and must preserve a clean file.
  const detach = editor.subscribe((state) => {
    if (replacing || disposed) return;
    const document = documentOf(state);
    const reference =
      layout.reference && document.references[layout.reference.id];
    const frame =
      document.sourceFrame ||
      (reference
        ? {
            width: reference.pixelWidth,
            height: reference.pixelHeight,
            widthMM: reference.pixelWidth * reference.pixelToWorld[0],
          }
        : openedLayout.frame);
    if (JSON.stringify(frame) !== JSON.stringify(layout.frame)) {
      layout = freeze({
        ...layout,
        frame: structuredClone(frame),
        reference: reference
          ? { ...structuredClone(reference), url: layout.reference.url }
          : layout.reference,
      });
      runtime.dispose();
      runtime = makeRuntime();
    }
    layout = freeze({
      ...layout,
      reference: reference
        ? { ...structuredClone(reference), url: layout.reference.url }
        : null,
      references: orderedReferences(document).map((item) => ({
        ...structuredClone(item),
        url:
          layout.assetUrls?.[item.assetId] ||
          (layout.reference?.assetId === item.assetId
            ? layout.reference.url
            : ''),
      })),
    });
    if (!state.previewId && state.revision !== storage.revision)
      storage = files.update(state);
    publish(state);
  });
  publish(editor.state);
  const open = (input, nextPresentation) => {
    alive();
    const prepared = prepareOpen(input, nextPresentation);
    replacing = true;
    let state;
    try {
      state = editor.replaceDocument(prepared.next.document, {
        expectedRevision: editor.state.revision,
      });
      storage = openStorage(prepared.next, state);
      layout = prepared.nextLayout;
      openedLayout = layout;
      runtime.dispose();
      runtime = makeRuntime();
    } finally {
      replacing = false;
    }
    return publish(state);
  };
  const capture = () => {
    alive();
    const state = editor.state;
    return {
      expectedEpoch: state.epoch,
      expectedRevision: state.revision,
      previewId: state.previewId,
      previewVersion: state.preview?.version ?? null,
    };
  };
  const persist = async (operation) => {
    const result = await operation();
    if (!disposed) {
      storage = files.state;
      publish(editor.state);
    }
    return result;
  };
  return Object.freeze({
    getSnapshot() {
      alive();
      return snapshot;
    },
    agentCall(action, args) {
      alive();
      return agent.call(action, args);
    },
    setSelectionReader(read) {
      alive();
      selectionReader = read || (() => null);
    },
    subscribe(listener) {
      alive();
      if (typeof listener !== 'function') throw Error('订阅者必须是函数');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    open,
    setSourceWidth(widthMM) {
      alive();
      if (!Number.isFinite(widthMM) || widthMM < 0.1 || widthMM > 10000)
        throw Error('底图对应宽度必须为 0.1–10000 mm');
      if (editor.state.previewId) throw Error('请先完成当前拖动');
      if (widthMM === layout.frame.widthMM) return snapshot;
      const frame = structuredClone(layout.frame);
      editor.dispatch(
        (document) => {
          const initialized = structuredClone(document);
          initialized.sourceFrame ||= frame;
          const result = createSourceScaleCommand({
            kind: 'calibrate-source-scale',
            factor: widthMM / frame.widthMM,
          })(initialized);
          // Reject an invalid display before committing geometry/history/storage.
          project(
            { ...editor.state, document: result.document },
            projectCreationView(result.document, {}),
            {
              ...layout,
              frame: result.document.sourceFrame,
              reference: layout.reference
                ? {
                    ...result.document.references[layout.reference.id],
                    url: layout.reference.url,
                  }
                : null,
            },
          );
          return result;
        },
        { expectedRevision: editor.state.revision },
      );
      return snapshot;
    },
    setBlenderExtrusion(depthMM) {
      alive();
      if (!Number.isFinite(depthMM) || depthMM < 0 || depthMM > 1000)
        throw Error('Blender 挤出厚度必须为 0–1000 mm');
      if (editor.state.previewId) throw Error('请先完成当前拖动');
      if (layout.blenderExtrusionMM === depthMM) return snapshot;
      // An export preference is not document geometry, relief or history.
      layout = freeze({ ...layout, blenderExtrusionMM: depthMM });
      runtime.refreshDisplay();
      return publish(editor.state);
    },
    addReferences(bundle, assetUrls) {
      alive();
      if (editor.state.previewId) throw Error('请先完成当前拖动');
      const previous = layout;
      const rollback = files.registerAssets(bundle.bytes);
      layout = freeze({ ...layout, assetUrls: { ...assetUrls } });
      try {
        editor.dispatch(
          createReferenceCommand({
            kind: 'reference-add',
            references: bundle.references,
            assets: bundle.assets,
          }),
          { expectedRevision: editor.state.revision },
        );
      } catch (error) {
        layout = previous;
        rollback();
        throw error;
      }
      return snapshot;
    },
    dispatch(command) {
      alive();
      return editor.dispatch(command, {
        expectedRevision: editor.state.revision,
      });
    },
    undo() {
      alive();
      return editor.undo({ expectedRevision: editor.state.revision });
    },
    redo() {
      alive();
      return editor.redo({ expectedRevision: editor.state.revision });
    },
    save(saveAsTarget) {
      const identity = capture();
      return persist(() => files.save({ ...identity, saveAsTarget }));
    },
    exportBytes() {
      return files.exportBytes(capture());
    },
    autosave() {
      const identity = capture();
      return persist(() => files.autosave(identity));
    },
    async restore(presentationForDraft) {
      const identity = capture();
      const draft = await files.restore(identity);
      if (!draft) return null;
      const nextPresentation = await presentationForDraft(draft);
      alive();
      // Editing while choosing a reference frame also invalidates recovery.
      const now = editor.state;
      if (
        now.epoch !== identity.expectedEpoch ||
        now.revision !== identity.expectedRevision ||
        now.previewId !== identity.previewId ||
        (now.preview?.version ?? null) !== identity.previewVersion
      )
        throw Error('恢复结果已过期');
      return open(
        { kind: 'v4', ...draft, target: null, dirty: true },
        nextPresentation,
      );
    },
    dispose() {
      evaluation.dispose();
      if (disposed) return;
      detach();
      runtime.dispose();
      listeners.clear();
      disposed = true;
    },
  });
}
