import assert from 'node:assert/strict';
import { createReferenceProject } from '../../../src/lib/editor/new-reference-project.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createReferenceCommand } from '../../../src/lib/editing/commands/references.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createDocumentEvaluationSession } from '../../../src/lib/evaluation/document-session.mjs';

const opened = createReferenceProject({
  bytes: new Uint8Array([1]),
  mediaType: 'image/png',
  name: 'base',
  width: 100,
  height: 100,
});
const editor = createEditorSession(opened.document);
let evaluations = 0;
const service = createDocumentEvaluationSession({
  editorSession: editor,
  evaluate: async () => ({ count: ++evaluations }),
});
const ref = Object.values(opened.document.references)[0];
const original = editor.state;
assert.equal((await service.snapshot(original, ['curves'])).count, 1);
editor.dispatch(
  createReferenceCommand({
    kind: 'reference-update',
    id: ref.id,
    patch: { opacity: 0.4 },
  }),
  { expectedRevision: editor.state.revision },
);
assert.equal(
  (await service.snapshot(editor.state, ['curves'])).count,
  1,
  'opacity must not recompute geometry',
);
await assert.rejects(
  () => service.snapshot(original, ['curves']),
  /过期/,
  'reuse must not authorize stale callers',
);
editor.undo({ expectedRevision: editor.state.revision });
assert.equal(
  (await service.snapshot(editor.state, ['curves'])).count,
  1,
  'reference-only undo reuses results',
);
assert.equal(
  (await service.snapshot(editor.state, ['bodies'])).count,
  2,
  'separate requested domains',
);
editor.dispatch(
  createAuthoringCommand({
    kind: 'draw-path',
    closed: false,
    points: [
      [0, 0],
      [10, 0],
    ],
  }),
  { expectedRevision: editor.state.revision },
);
assert.equal(
  (await service.snapshot(editor.state, ['curves'])).count,
  3,
  'geometry edits invalidate results',
);
editor.replaceDocument(opened.document, {
  expectedRevision: editor.state.revision,
});
assert.equal(
  (await service.snapshot(editor.state, ['curves'])).count,
  4,
  'new epoch cannot reuse old geometry',
);
service.dispose();
console.log(
  'PASS reference-only edits reuse geometry without weakening revision or epoch guards',
);
