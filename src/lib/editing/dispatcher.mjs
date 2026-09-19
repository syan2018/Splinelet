import { validateDocument } from '../document/schema.mjs';
import { createHistory } from './history.mjs';
import { executeTransaction, prepareTransaction } from './transaction.mjs';

const clone = (value) => structuredClone(value);
const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
};
const readonly = (value) => freeze(clone(value));
const defaultIdFactory = () =>
  globalThis.crypto?.randomUUID?.() ||
  `editor-${Math.random().toString(36).slice(2)}`;

export function createEditorSession(document, options = {}) {
  const validator = options.validator || validateDocument;
  const idFactory = options.idFactory || defaultIdFactory;
  const onListenerError = options.onListenerError || (() => {});
  if (typeof validator !== 'function') throw Error('validator 必须是函数');
  if (typeof idFactory !== 'function') throw Error('idFactory 必须是函数');
  if (typeof onListenerError !== 'function')
    throw Error('onListenerError 必须是函数');
  validator(document);

  let history = createHistory(document);
  let epochSequence = 0;
  let previewSequence = 0;
  let epoch = options.epoch || `epoch-${++epochSequence}-${idFactory()}`;
  let revision = 0;
  let preview = null;
  let executing = false;
  let lastChange = null;
  const listeners = new Set();
  const preparedTokens = new WeakSet();
  const consumedPreparedTokens = new WeakSet();
  let notifying = false;
  let notificationPending = false;

  const snapshot = () =>
    readonly({
      epoch,
      revision,
      previewId: preview?.id || null,
      document: history.current(),
      preview: preview && {
        id: preview.id,
        baseRevision: preview.baseRevision,
        document: clone(preview.document),
      },
      canUndo: history.canUndo(),
      canRedo: history.canRedo(),
      lastChange,
    });
  const notify = () => {
    if (notifying) {
      notificationPending = true;
      return;
    }
    do {
      notificationPending = false;
      const next = snapshot();
      notifying = true;
      // Subscriptions may change inside a callback; notify the captured set once.
      const currentListeners = [...listeners];
      for (const listener of currentListeners)
        try {
          listener(next);
        } catch (error) {
          try {
            onListenerError(error, next);
          } catch {}
        }
      notifying = false;
    } while (notificationPending);
  };
  const requireRevision = (expectedRevision) => {
    if (executing) throw Error('编辑命令执行期间不能重入会话');
    if (!Number.isInteger(expectedRevision))
      throw Error('expectedRevision 必须是当前整数 revision');
    if (expectedRevision !== revision)
      throw Error(`陈旧 revision：期望 ${revision}，收到 ${expectedRevision}`);
  };
  const requirePreview = (previewId) => {
    if (!preview || !previewId || preview.id !== previewId)
      throw Error('previewId 已失效或不匹配');
    return preview;
  };
  const requireNoPreview = () => {
    if (preview) throw Error('存在进行中的 preview；请先提交或取消 preview');
  };
  const commandContext = () => ({ epoch, revision, idFactory });
  const execute = (document, command, context) => {
    executing = true;
    try {
      return executeTransaction(document, command, { validator, context });
    } finally {
      executing = false;
    }
  };
  const commit = (result) => {
    const changed = history.commit(result.document);
    if (changed) {
      revision += 1;
      lastChange = {
        kind: 'commit',
        changedRefs: result.changedRefs || [],
        selectionIntent: result.selectionIntent,
      };
    }
    return changed;
  };
  const commitPrepared = (prepared, expectedRevision) => {
    requireRevision(expectedRevision);
    if (!prepared || prepared.kind !== 'editor-prepared-command')
      throw Error('prepared command 无效');
    if (!preparedTokens.has(prepared))
      throw Error('prepared command 不属于当前会话的 prepare');
    if (consumedPreparedTokens.has(prepared))
      throw Error('prepared command 不能重复提交');
    requireNoPreview();
    if (prepared.epoch !== epoch || prepared.revision !== revision)
      throw Error('prepared command 的基准 epoch 或 revision 已过期');
    validator(prepared.result.document);
    const changed = commit(prepared.result);
    consumedPreparedTokens.add(prepared);
    if (changed) notify();
    return snapshot();
  };

  return Object.freeze({
    get state() {
      return snapshot();
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw Error('订阅者必须是函数');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch(command, { expectedRevision } = {}) {
      if (command?.kind === 'editor-prepared-command')
        return commitPrepared(command, expectedRevision);
      requireRevision(expectedRevision);
      requireNoPreview();
      const result = execute(history.current(), command, commandContext());
      const changed = commit(result);
      if (changed) notify();
      return snapshot();
    },
    async prepare(command, { expectedRevision } = {}) {
      requireRevision(expectedRevision);
      const baseEpoch = epoch;
      const baseRevision = revision;
      const result = await prepareTransaction(history.current(), command, {
        validator,
        context: commandContext(),
      });
      const prepared = readonly({
        kind: 'editor-prepared-command',
        epoch: baseEpoch,
        revision: baseRevision,
        result,
      });
      preparedTokens.add(prepared);
      return prepared;
    },
    beginPreview({ expectedRevision } = {}) {
      requireRevision(expectedRevision);
      if (preview) throw Error('已有进行中的 preview');
      preview = {
        id: `preview-${++previewSequence}-${idFactory()}`,
        baseRevision: revision,
        baseDocument: history.current(),
        document: history.current(),
      };
      notify();
      return snapshot();
    },
    updatePreview(command, { expectedRevision, previewId } = {}) {
      requireRevision(expectedRevision);
      const active = requirePreview(previewId);
      const result = execute(active.baseDocument, command, {
        ...commandContext(),
        previewId: active.id,
        baseRevision: active.baseRevision,
      });
      active.document = clone(result.document);
      active.changedRefs = clone(result.changedRefs);
      active.selectionIntent = clone(result.selectionIntent);
      notify();
      return snapshot();
    },
    commitPreview({ expectedRevision, previewId } = {}) {
      requireRevision(expectedRevision);
      const active = requirePreview(previewId);
      preview = null;
      commit(active);
      notify();
      return snapshot();
    },
    cancelPreview({ expectedRevision, previewId } = {}) {
      requireRevision(expectedRevision);
      requirePreview(previewId);
      preview = null;
      notify();
      return snapshot();
    },
    undo({ expectedRevision } = {}) {
      requireRevision(expectedRevision);
      preview = null;
      if (history.undo()) {
        revision += 1;
        lastChange = { kind: 'undo', changedRefs: [] };
      }
      notify();
      return snapshot();
    },
    redo({ expectedRevision } = {}) {
      requireRevision(expectedRevision);
      preview = null;
      if (history.redo()) {
        revision += 1;
        lastChange = { kind: 'redo', changedRefs: [] };
      }
      notify();
      return snapshot();
    },
    replaceDocument(nextDocument, { expectedRevision } = {}) {
      requireRevision(expectedRevision);
      validator(nextDocument);
      history = createHistory(nextDocument);
      epoch = `epoch-${++epochSequence}-${idFactory()}`;
      revision += 1;
      preview = null;
      lastChange = { kind: 'replace', changedRefs: [] };
      notify();
      return snapshot();
    },
  });
}
