import assert from 'node:assert/strict';
import {
  createDocument,
  validateDocument,
} from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';

let ids = 0;
const idFactory = () => `id-${++ids}`;
const original = createDocument({ idFactory });
const guarded = createEditorSession(original, { idFactory });
assert.throws(
  () =>
    guarded.dispatch(
      (draft) => {
        guarded.dispatch((inner) => ({ document: inner }), {
          expectedRevision: 0,
        });
        return { document: draft };
      },
      { expectedRevision: 0 },
    ),
  /重入/,
);
assert.equal(guarded.state.revision, 0);
guarded.dispatch(
  (draft) => {
    draft.geometrySettings.curveToleranceMM = 0.02;
    return {
      document: draft,
      changedRefs: [{ kind: 'document', id: draft.id }],
      selectionIntent: { kind: 'clear' },
    };
  },
  { expectedRevision: 0 },
);
assert.deepEqual(guarded.state.lastChange.selectionIntent, { kind: 'clear' });
assert.equal(guarded.state.lastChange.changedRefs[0].id, original.id);
const session = createEditorSession(original, { epoch: 'open-a', idFactory });
const changeTolerance = (value) => (document) => {
  const next = structuredClone(document);
  next.geometrySettings.curveToleranceMM = value;
  return { document: next, changedRefs: [{ kind: 'document', id: next.id }] };
};

assert.equal(session.state.revision, 0);
assert.equal(session.state.epoch, 'open-a');
assert.throws(
  () => session.dispatch(changeTolerance(0.02)),
  /expectedRevision/,
);
assert.throws(() => {
  session.state.document.geometrySettings.curveToleranceMM = 2;
}, /read only|Cannot assign/);

const capturedState = session.state;
assert.equal(
  session.state,
  capturedState,
  'unchanged reads reuse one immutable snapshot',
);
assert.equal(session.state.document, capturedState.document);
const notices = [];
const unsubscribe = session.subscribe((state) =>
  notices.push([state.epoch, state.revision, state.previewId]),
);
let escapedDraft;
session.dispatch(
  (draft) => {
    escapedDraft = draft;
    draft.geometrySettings.curveToleranceMM = 0.02;
    return { document: draft, changedRefs: [] };
  },
  { expectedRevision: 0 },
);
escapedDraft.geometrySettings.curveToleranceMM = 0.2;
assert.equal(original.geometrySettings.curveToleranceMM, 0.015);
assert.equal(session.state.document.geometrySettings.curveToleranceMM, 0.02);
assert.equal(session.state.revision, 1);
assert.notEqual(session.state, capturedState);
assert.equal(
  capturedState.document.geometrySettings.curveToleranceMM,
  0.015,
  'old snapshots cannot follow later edits',
);
assert.throws(
  () => session.dispatch(changeTolerance(0.03), { expectedRevision: 0 }),
  /陈旧 revision/,
);

assert.throws(
  () =>
    session.dispatch(
      (draft) => {
        draft.geometrySettings.curveToleranceMM = 0;
        return { document: draft, changedRefs: [] };
      },
      { expectedRevision: 1 },
    ),
  /geometrySettings 无效/,
);
assert.equal(session.state.revision, 1);
assert.equal(session.state.document.geometrySettings.curveToleranceMM, 0.02);

session.dispatch(
  (draft) => ({ document: structuredClone(draft), changedRefs: [] }),
  { expectedRevision: 1 },
);
assert.equal(
  session.state.revision,
  1,
  'no-op command does not add a history entry',
);

session.undo({ expectedRevision: 1 });
assert.equal(session.state.revision, 2);
assert.equal(session.state.document.geometrySettings.curveToleranceMM, 0.015);
assert.throws(() => session.redo({ expectedRevision: 1 }), /陈旧 revision/);
session.redo({ expectedRevision: 2 });
assert.equal(session.state.revision, 3);
assert.equal(session.state.document.geometrySettings.curveToleranceMM, 0.02);

const firstPreview = session.beginPreview({ expectedRevision: 3 }).previewId;
session.updatePreview(
  (draft) => {
    draft.geometrySettings.curveToleranceMM += 0.01;
    return { document: draft, changedRefs: [] };
  },
  { expectedRevision: 3, previewId: firstPreview },
);
session.updatePreview(
  (draft) => {
    draft.geometrySettings.curveToleranceMM += 0.01;
    return { document: draft, changedRefs: [] };
  },
  { expectedRevision: 3, previewId: firstPreview },
);
assert.equal(
  session.state.preview.document.geometrySettings.curveToleranceMM,
  0.03,
  'each preview frame uses the fixed baseline',
);
assert.throws(
  () => session.dispatch(changeTolerance(0.04), { expectedRevision: 3 }),
  /进行中的 preview/,
  'a normal commit cannot be overwritten later by the active preview baseline',
);
session.commitPreview({ expectedRevision: 3, previewId: firstPreview });
assert.equal(session.state.revision, 4);
assert.equal(session.state.document.geometrySettings.curveToleranceMM, 0.03);
session.undo({ expectedRevision: 4 });
assert.equal(
  session.state.document.geometrySettings.curveToleranceMM,
  0.02,
  'a gesture commits one history entry',
);

const cancelledPreview = session.beginPreview({
  expectedRevision: 5,
}).previewId;
session.updatePreview(changeTolerance(0.04), {
  expectedRevision: 5,
  previewId: cancelledPreview,
});
session.cancelPreview({ expectedRevision: 5, previewId: cancelledPreview });
assert.throws(
  () =>
    session.updatePreview(changeTolerance(0.04), {
      expectedRevision: 5,
      previewId: cancelledPreview,
    }),
  /previewId 已失效/,
);
assert.equal(session.state.revision, 5);
assert.equal(session.state.document.geometrySettings.curveToleranceMM, 0.02);

let release;
const delayed = session.prepare(
  async (draft) => {
    await new Promise((resolve) => {
      release = resolve;
    });
    draft.geometrySettings.curveToleranceMM = 0.04;
    return { document: draft, changedRefs: [] };
  },
  { expectedRevision: 5 },
);
await Promise.resolve();
session.dispatch(changeTolerance(0.025), { expectedRevision: 5 });
release();
const prepared = await delayed;
assert.throws(
  () => session.dispatch(prepared, { expectedRevision: 6 }),
  /prepared command.*过期/,
);

const replayable = await session.prepare(changeTolerance(0.04), {
  expectedRevision: 6,
});
session.dispatch(replayable, { expectedRevision: 6 });
assert.throws(
  () => session.dispatch(replayable, { expectedRevision: 7 }),
  /prepared command 不能重复提交/,
);
assert.throws(
  () =>
    session.dispatch(
      {
        kind: 'editor-prepared-command',
        epoch: session.state.epoch,
        revision: session.state.revision,
        result: { document: createDocument({ idFactory }), changedRefs: [] },
      },
      { expectedRevision: 7 },
    ),
  /不属于当前会话/,
);

const crossProjectPrepared = await session.prepare(changeTolerance(0.04), {
  expectedRevision: 7,
});
const stalePreview = session.beginPreview({ expectedRevision: 7 }).previewId;
const replacement = createDocument({ idFactory });
const priorEpoch = session.state.epoch;
session.replaceDocument(replacement, { expectedRevision: 7 });
assert.notEqual(session.state.epoch, priorEpoch);
assert.equal(session.state.previewId, null);
assert.throws(
  () =>
    session.updatePreview(changeTolerance(0.05), {
      expectedRevision: 8,
      previewId: stalePreview,
    }),
  /previewId 已失效/,
);
assert.throws(
  () => session.dispatch(crossProjectPrepared, { expectedRevision: 8 }),
  /prepared command.*epoch.*过期/,
);
assert.equal(session.state.document.id, replacement.id);
assert.ok(notices.length >= 8);
unsubscribe();

let validations = 0;
const tokenSession = createEditorSession(createDocument({ idFactory }), {
  idFactory,
  validator(document) {
    validations += 1;
    return validateDocument(document);
  },
});
const token = await tokenSession.prepare(changeTolerance(0.02), {
  expectedRevision: 0,
});
tokenSession.dispatch(token, { expectedRevision: 0 });
assert.ok(
  validations >= 3,
  'prepared command validation runs again immediately before commit',
);

const listenerErrors = [];
const observedRevisions = [];
const notificationSession = createEditorSession(createDocument({ idFactory }), {
  idFactory,
  onListenerError(error, state) {
    listenerErrors.push([error.message, state.revision]);
  },
});
notificationSession.subscribe(() => {
  throw Error('listener failure');
});
notificationSession.subscribe((state) => {
  observedRevisions.push(state.revision);
  if (state.revision === 1)
    notificationSession.dispatch(changeTolerance(0.02), {
      expectedRevision: 1,
    });
});
notificationSession.dispatch(changeTolerance(0.018), { expectedRevision: 0 });
assert.deepEqual(
  observedRevisions,
  [1, 2],
  'reentrant notification preserves snapshot order',
);
assert.deepEqual(
  listenerErrors.map(([, revision]) => revision),
  [1, 2],
  'listener failures are observable without aborting other subscribers or commits',
);

console.log(
  'PASS: V4 transactions enforce immutable atomic commits, previews, history, epochs, and prepared-command baselines',
);
