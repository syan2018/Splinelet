import assert from 'node:assert/strict';
import { decodeDocument } from '../../../src/lib/document/codec.mjs';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createStudioSession } from '../../../src/lib/editor/studio-session.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

let serial = 0;
const idFactory = () => `studio-session-${++serial}`;
const presentation = (fileName = 'a.spl') => ({
  reference: null,
  frame: { width: 800, height: 600, widthMM: 100 },
  newReliefDepthMM: 2,
  fileName,
});
const command = (action) => createAuthoringCommand(action);
const draw = () =>
  command({
    kind: 'draw-path',
    closed: false,
    points: [
      [0, 0],
      [10, 0],
    ],
  });
const documentWithPath = () => {
  const editor = createEditorSession(createDocument({ idFactory }), {
    idFactory,
  });
  editor.dispatch(draw(), { expectedRevision: editor.state.revision });
  return editor.state.document;
};
const opened = (document, target = 'a.spl', assets = {}) => ({
  kind: 'v4',
  document,
  assets,
  target,
});
const makeSession = ({
  document = documentWithPath(),
  target = 'a.spl',
  assets = {},
  writeFile = async () => {},
  drafts = { write: async () => {}, read: async () => null },
} = {}) =>
  createStudioSession({
    opened: opened(document, target, assets),
    presentation: presentation(),
    persistence: { writeFile, drafts },
    idFactory,
  });

const writes = [];
const draftWrites = [];
const session = makeSession({
  writeFile: async (target, bytes) => writes.push({ target, bytes }),
  drafts: {
    write: async (key, draft) => draftWrites.push({ key, draft }),
    read: async () => null,
  },
});
const initial = session.getSnapshot();
assert.equal(initial.storage.dirty, false);
assert.equal(initial.storage.target, 'a.spl');
assert.equal(initial.editorState.revision, 0);
assert.ok(Object.isFrozen(initial.project));
assert.equal(initial.runtime.project(), initial.project);
let notifications = 0;
const unsubscribe = session.subscribe(function listener() {
  assert.equal(
    arguments.length,
    0,
    'session listeners receive no mutable state',
  );
  notifications++;
});

session.dispatch(draw());
let changed = session.getSnapshot();
assert.equal(changed.storage.dirty, true);
assert.equal(changed.editorState.revision, 1);
assert.notEqual(changed.project, initial.project);
assert.equal(changed.project.paths.length, 2);
assert.equal(
  notifications,
  1,
  'authoring commands publish through the session',
);
await session.save();
assert.equal(session.getSnapshot().storage.dirty, false);
assert.equal(writes.length, 1);
assert.deepEqual(
  decodeDocument(writes[0].bytes).document,
  session.getSnapshot().editorState.document,
  'save encodes the current V4 document, not a display projection',
);

const beforeGesture = session.getSnapshot();
const source = beforeGesture.runtime.readSourceView(beforeGesture.project);
const path = source.source.paths[0];
const gesture = beforeGesture.runtime.beginSourceGesture(beforeGesture.project);
const preview = gesture.update({
  kind: 'move-anchor',
  identityId: path.identity.anchorIds[0],
  pixelPoint: { x: 424, y: 284 },
});
const duringGesture = session.getSnapshot();
assert.equal(duringGesture.project, preview);
assert.equal(duringGesture.storage.dirty, false);
assert.equal(duringGesture.storage.revision, beforeGesture.storage.revision);
assert.equal(duringGesture.editorState.previewId !== null, true);
assert.notDeepEqual(
  duringGesture.project.paths[0].start,
  beforeGesture.project.paths[0].start,
  'source gesture samples republish display data',
);
await assert.rejects(session.save(), /preview/);
await assert.rejects(session.autosave(), /preview/);
gesture.cancel();
assert.equal(session.getSnapshot().storage.dirty, false);
assert.equal(session.getSnapshot().editorState.previewId, null);

const committedGesture = session
  .getSnapshot()
  .runtime.beginSourceGesture(session.getSnapshot().project);
committedGesture.update({
  kind: 'move-anchor',
  identityId: path.identity.anchorIds[0],
  pixelPoint: { x: 432, y: 276 },
});
committedGesture.commit();
changed = session.getSnapshot();
assert.equal(changed.storage.dirty, true);
const committedDocument = changed.editorState.document;
session.undo();
assert.notDeepEqual(
  session.getSnapshot().editorState.document,
  committedDocument,
);
assert.equal(session.getSnapshot().storage.dirty, true);
await session.autosave();
assert.equal(draftWrites.length, 1);

const oldRuntime = session.getSnapshot().runtime;
let openNotifications = 0;
const removeOpenCounter = session.subscribe(() => openNotifications++);
const replacement = documentWithPath();
session.open(
  opened(replacement, 'replacement.spl', { thumbnail: new Uint8Array([7]) }),
  presentation('replacement.spl'),
);
const afterOpen = session.getSnapshot();
assert.equal(
  openNotifications,
  1,
  'open emits one complete replacement snapshot',
);
assert.notEqual(afterOpen.runtime, oldRuntime);
assert.throws(() => oldRuntime.project(), /关闭/);
assert.equal(afterOpen.storage.revision, afterOpen.editorState.revision);
assert.ok(afterOpen.storage.revision > 0);
assert.equal(afterOpen.storage.dirty, false);
assert.equal(afterOpen.storage.target, 'replacement.spl');
assert.deepEqual([...afterOpen.storage.assets.thumbnail], [7]);
assert.equal(afterOpen.project.paths.length, 1);
const liveRuntime = afterOpen.runtime;
removeOpenCounter();

const stableSnapshot = session.getSnapshot();
assert.throws(
  () => session.open(opened({ version: 4 }), presentation()),
  /文档无效/,
);
assert.strictEqual(session.getSnapshot(), stableSnapshot);
assert.throws(() => session.open(opened(documentWithPath()), null));
assert.strictEqual(session.getSnapshot(), stableSnapshot);
unsubscribe();
session.dispose();
assert.throws(() => session.getSnapshot(), /关闭/);
assert.throws(() => liveRuntime.project(), /关闭/);

const saveGate = deferred();
const staleWrites = [];
const stale = makeSession({
  document: documentWithPath(),
  target: 'old.spl',
  writeFile: (target, bytes) => {
    staleWrites.push({ target, bytes });
    return saveGate.promise;
  },
});
stale.dispatch(draw());
const lateSave = stale.save();
await flush();
assert.equal(staleWrites[0].target, 'old.spl');
stale.open(opened(documentWithPath(), 'new.spl'), presentation('new.spl'));
saveGate.resolve();
await lateSave;
assert.equal(stale.getSnapshot().storage.target, 'new.spl');
assert.equal(stale.getSnapshot().storage.dirty, false);
stale.dispose();

const legacy = createStudioSession({
  opened: {
    kind: 'legacy',
    document: documentWithPath(),
    assets: {},
    target: 'old.spl',
  },
  presentation: presentation('old.spl'),
  persistence: { writeFile: async () => {}, drafts: {} },
  idFactory,
});
assert.equal(legacy.getSnapshot().storage.target, null);
assert.equal(legacy.getSnapshot().storage.dirty, true);
await assert.rejects(legacy.save(), /首次保存/);
await legacy.save('converted.spl');
assert.equal(legacy.getSnapshot().storage.target, 'converted.spl');
legacy.dispose();

const restoreGate = deferred();
const restoring = makeSession({
  document: documentWithPath(),
  drafts: {
    write: async () => {},
    read: () => restoreGate.promise,
  },
});
restoring.dispatch(draw());
const recovery = restoring.restore(async () => presentation('draft.spl'));
restoring.dispatch(draw());
restoreGate.resolve({ document: documentWithPath(), assets: {} });
await assert.rejects(recovery, /过期/);
assert.equal(restoring.getSnapshot().storage.dirty, true);
restoring.dispose();

const recoveredDocument = documentWithPath();
const recovered = makeSession({
  drafts: {
    write: async () => {},
    read: async () => ({ document: recoveredDocument, assets: {} }),
  },
});
const recoveredSnapshot = await recovered.restore(() =>
  presentation('draft.spl'),
);
assert.deepEqual(recoveredSnapshot.editorState.document, recoveredDocument);
assert.equal(recoveredSnapshot.storage.dirty, true);
assert.equal(recoveredSnapshot.storage.target, null);
assert.equal(
  recoveredSnapshot.storage.revision,
  recoveredSnapshot.editorState.revision,
);
await assert.rejects(recovered.save(), /首次保存/);
recovered.dispose();

const choosingFrame = deferred();
const previewRecovery = makeSession({
  drafts: {
    write: async () => {},
    read: async () => ({ document: recoveredDocument, assets: {} }),
  },
});
const shown = previewRecovery.getSnapshot();
const shownPath = shown.project.paths[0];
const pendingGesture = shown.runtime.beginSourceGesture(shown.project);
const pendingRecovery = previewRecovery.restore(() => choosingFrame.promise);
await flush();
pendingGesture.update({
  kind: 'move-anchor',
  identityId: shownPath.identity.anchorIds[0],
  pixelPoint: { x: 470, y: 320 },
});
const currentPreview = previewRecovery.getSnapshot();
choosingFrame.resolve(presentation('draft.spl'));
await assert.rejects(pendingRecovery, /过期/);
assert.equal(previewRecovery.getSnapshot(), currentPreview);
pendingGesture.cancel();
previewRecovery.dispose();

console.log(
  'PASS: Studio session owns real V4 editor/runtime snapshots, storage lifecycle, replacement and persistence races.',
);
