import assert from 'node:assert/strict';
import { decodeDocument } from '../../../src/lib/document/codec.mjs';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createStudioSession } from '../../../src/lib/editor/studio-session.mjs';

let serial = 0;
const idFactory = () => `v5-studio-session-${++serial}`;
const presentation = (fileName = 'native-v5.spl') => ({
  reference: null,
  frame: { width: 800, height: 600, widthMM: 100 },
  blenderExtrusionMM: 2,
  fileName,
});
const documentWithPath = () => {
  const document = createDocument({ version: 5, idFactory });
  document.sourceFrame = { width: 800, height: 600, widthMM: 100 };
  const editor = createEditorSession(document, { idFactory });
  editor.dispatch(
    createAuthoringCommand({
      kind: 'draw-path',
      closed: true,
      points: [
        [0, 0],
        [20, 0],
        [20, 10],
        [0, 10],
      ],
    }),
    { expectedRevision: editor.state.revision },
  );
  return editor.state.document;
};
const opened = (document, target = 'native-v5.spl') => ({
  kind: 'v5',
  document,
  assets: {},
  target,
});
const writes = [];
const drafts = [];
const session = createStudioSession({
  opened: opened(documentWithPath()),
  presentation: presentation(),
  persistence: {
    writeFile: async (target, bytes) => writes.push({ target, bytes }),
    drafts: {
      write: async (_key, draft) => drafts.push(draft),
      read: async () => null,
    },
  },
  idFactory,
});

const initial = session.getSnapshot();
assert.equal((await session.agentCall('capabilities.get')).documentVersion, 5);
assert.equal(initial.editorState.document.version, 5);
assert.equal(initial.project.version, 5);
assert.equal(initial.editorState.document.units, 'mm');
assert.equal(initial.presentation.frame.widthMM, 100);
assert.equal(
  initial.project.creation.objects.length,
  1,
  'V5 has the normal construction view',
);
assert.equal(initial.storage.target, 'native-v5.spl');
assert.equal(initial.storage.dirty, false);

const source = initial.runtime.readSourceView(initial.project).source;
const path = source.paths[0];
const initialAnchor = path.anchors[0];
const gesture = initial.runtime.beginSourceGesture(initial.project);
gesture.update({
  kind: 'move-anchor',
  identityId: path.identity.anchorIds[0],
  pixelPoint: { x: initialAnchor.x + 12, y: initialAnchor.y + 8 },
});
gesture.commit();
const changed = session.getSnapshot();
assert.equal(changed.editorState.document.version, 5);
assert.equal(changed.storage.dirty, true);
assert.equal(changed.editorState.revision, initial.editorState.revision + 1);
assert.notDeepEqual(
  changed.project.paths[0].anchors[0],
  initial.project.paths[0].anchors[0],
);
await session.autosave();
assert.equal(drafts.length, 1);

const bytes = session.exportBytes();
const decoded = decodeDocument(bytes);
assert.equal(decoded.document.version, 5);
assert.deepEqual(decoded.document, changed.editorState.document);
await session.save();
assert.equal(writes.length, 1);
assert.equal(session.getSnapshot().storage.dirty, false);

session.open(
  opened(decoded.document, 'reopened-v5.spl'),
  presentation('reopened-v5.spl'),
);
const reopened = session.getSnapshot();
assert.equal(reopened.editorState.document.version, 5);
assert.equal(reopened.project.version, 5);
assert.equal(reopened.storage.target, 'reopened-v5.spl');
assert.equal(reopened.storage.dirty, false);

session.open(
  {
    kind: 'migrated',
    document: decoded.document,
    assets: {},
    target: 'must-not-overwrite-v4.spl',
    dirty: false,
    report: {
      issues: [
        { severity: 'warning', code: 'converted', message: 'converted' },
      ],
    },
  },
  presentation('migrated-v5.spl'),
);
const migrated = session.getSnapshot();
assert.equal(migrated.storage.target, null);
assert.equal(migrated.storage.dirty, true);
assert.equal(migrated.importReport.issues[0].code, 'converted');
await assert.rejects(session.save(), /首次保存/);
await session.save('new-v5.spl');
assert.equal(session.getSnapshot().storage.target, 'new-v5.spl');
assert.equal(session.getSnapshot().storage.dirty, false);
session.dispose();

const draftV4 = createDocument({ version: 4, idFactory });
draftV4.sourceFrame = { width: 800, height: 600, widthMM: 100 };
const originalDraftV4 = structuredClone(draftV4);
const restoredV4 = createStudioSession({
  opened: opened(documentWithPath(), 'current-v5.spl'),
  presentation: presentation('current-v5.spl'),
  persistence: {
    writeFile: async () => {},
    drafts: {
      write: async () => {},
      read: async () => ({ document: draftV4, assets: {} }),
    },
  },
  idFactory,
});
const restoredV4Snapshot = await restoredV4.restore(() =>
  presentation('restored-v4-draft.spl'),
);
assert.equal(restoredV4Snapshot.editorState.document.version, 5);
assert.equal(restoredV4Snapshot.storage.target, null);
assert.equal(restoredV4Snapshot.storage.dirty, true);
assert.equal(restoredV4Snapshot.importReport.kind, 'region-definitions');
assert.deepEqual(draftV4, originalDraftV4, 'restore never rewrites the draft');
await assert.rejects(restoredV4.save(), /首次保存/);
restoredV4.dispose();

const nativeDraft = documentWithPath();
const originalNativeDraft = structuredClone(nativeDraft);
const restoredNative = createStudioSession({
  opened: opened(documentWithPath(), 'other-v5.spl'),
  presentation: presentation('other-v5.spl'),
  persistence: {
    writeFile: async () => {},
    drafts: {
      write: async () => {},
      read: async () => ({ document: nativeDraft, assets: {} }),
    },
  },
  idFactory,
});
const restoredNativeSnapshot = await restoredNative.restore(() =>
  presentation('restored-native-v5.spl'),
);
assert.deepEqual(restoredNativeSnapshot.editorState.document, nativeDraft);
assert.equal(restoredNativeSnapshot.importReport, null);
assert.equal(restoredNativeSnapshot.storage.target, null);
assert.equal(restoredNativeSnapshot.storage.dirty, true);
assert.deepEqual(
  nativeDraft,
  originalNativeDraft,
  'native drafts are not remigrated',
);
restoredNative.dispose();

const migrationFailure = createStudioSession({
  opened: opened(documentWithPath(), 'stable-v5.spl'),
  presentation: presentation('stable-v5.spl'),
  persistence: {
    writeFile: async () => {},
    drafts: {
      write: async () => {},
      read: async () => ({ document: { version: 4 }, assets: {} }),
    },
  },
  idFactory,
});
const beforeFailedRestore = migrationFailure.getSnapshot();
await assert.rejects(
  migrationFailure.restore(() => presentation('broken-v4-draft.spl')),
  /文档无效/,
);
assert.strictEqual(
  migrationFailure.getSnapshot(),
  beforeFailedRestore,
  'a failed V4 migration cannot partially replace the current document',
);
migrationFailure.dispose();

console.log('V5 Studio session tests passed');
