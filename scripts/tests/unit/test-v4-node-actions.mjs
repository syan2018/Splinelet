import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createV4CreationRuntime } from '../../../src/lib/editor/creation-runtime.mjs';
import {
  createLegacyNodeActions,
  createV4NodeActions,
} from '../../../src/lib/source-editor/node-actions.mjs';

let serial = 0;
const idFactory = () => `node-actions-${++serial}`;

const fixture = ({ single = false } = {}) => {
  const editor = createEditorSession(createDocument({ idFactory }), {
    idFactory,
  });
  const dispatch = (action) =>
    editor.dispatch(createAuthoringCommand(action), {
      expectedRevision: editor.state.revision,
    });
  dispatch(
    single
      ? { kind: 'start-path', point: [3, -2] }
      : {
          kind: 'draw-path',
          points: [
            [0, 0],
            [8, 5],
            [13, 2],
          ],
          cubics: [
            [
              [0, 0],
              [1, 4],
              [5, 8],
              [8, 5],
            ],
            [
              [8, 5],
              [10, 2],
              [12, 5],
              [13, 2],
            ],
          ],
          closed: false,
        },
  );
  const ownerId = Object.keys(editor.state.document.nodes)[0];
  editor.dispatch(
    (document) => {
      document.nodes[ownerId].pose = {
        translationMM: [6.4, -3.7],
        rotationRad: 0.523,
      };
      return { document };
    },
    { expectedRevision: editor.state.revision },
  );
  const runtime = createV4CreationRuntime({
    editorSession: editor,
    sourceFrame: { width: 913, height: 641, widthMM: 127.5 },
    toDisplayProject: (_state, view) => ({
      version: 4,
      creation: view.creation,
    }),
  });
  let project = runtime.project();
  let commits = 0;
  const actions = () =>
    createV4NodeActions({
      runtime,
      project,
      onCommit(nextProject) {
        project = nextProject;
        commits += 1;
      },
    });
  let legacyProject = {
    paths: structuredClone(runtime.readSourceView(project).source.paths),
  };
  let legacyCommits = 0;
  const legacy = createLegacyNodeActions({
    getProject: () => legacyProject,
    transact(change) {
      const next = structuredClone(legacyProject);
      change(next);
      legacyProject = next;
      legacyCommits += 1;
    },
  });
  return {
    actions,
    editor,
    legacy,
    legacyPath: () => legacyProject.paths[0],
    legacyCommits: () => legacyCommits,
    path: () => runtime.readSourceView(project).source.paths[0],
    project: () => project,
    commits: () => commits,
    runtime,
  };
};

const comparablePath = (path) => ({
  curves: path.curves,
  nodeModes: path.nodeModes,
});

const assertSamePath = (actual, expected, label) => {
  assert.deepEqual(actual.nodeModes, expected.nodeModes, label);
  assert.equal(actual.curves.length, expected.curves.length, label);
  actual.curves.forEach((curve, curveIndex) =>
    curve.forEach((point, pointIndex) => {
      const other = expected.curves[curveIndex][pointIndex];
      assert.ok(Math.abs(point.x - other.x) < 1e-8, label);
      assert.ok(Math.abs(point.y - other.y) < 1e-8, label);
    }),
  );
};

for (const [label, run] of [
  ['splitSpan', (actions, path) => actions.splitSpan(path.id, 0, 0.37)],
  ['setModes', (actions, path) => actions.setModes(path.id, [1], 'symmetric')],
  ['straighten', (actions, path) => actions.straighten(path.id, 0)],
  ['deleteNodes', (actions, path) => actions.deleteNodes(path.id, [1], 1.5)],
  [
    'moveHandle',
    (actions, path) => actions.moveHandle(path.id, 0, 2, { x: 450, y: 275 }),
  ],
]) {
  const current = fixture();
  const before = current.editor.state.document;
  const path = current.path();
  run(current.legacy, path);
  run(current.actions(), path);
  assertSamePath(
    comparablePath(current.path()),
    comparablePath(current.legacyPath()),
    `${String(label)} preserves original source cubic and handle-mode behavior`,
  );
  assert.equal(current.commits(), 1);
  assert.equal(current.legacyCommits(), 1);
  current.editor.undo({ expectedRevision: current.editor.state.revision });
  assert.deepEqual(
    current.editor.state.document,
    before,
    `${String(label)} is one V4 history entry`,
  );
}

const stale = fixture();
const stalePath = stale.path();
const staleActions = stale.actions();
staleActions.setModes(stalePath.id, [1], 'smooth');
assert.throws(() => staleActions.straighten(stalePath.id, 0), /过期|失效/);
assert.equal(stale.commits(), 1, 'a stale controller cannot commit again');
assert.throws(() => staleActions.splitSpan(stalePath.id, 0, 0.4), /过期|失效/);
assert.throws(
  () => staleActions.moveHandle(stalePath.id, 0, 1, { x: 10, y: 20 }),
  /过期|失效/,
);

for (const mode of ['smooth', 'symmetric']) {
  const current = fixture();
  const path = current.path();
  current.legacy.setModes(path.id, [1], mode);
  current.actions().setModes(path.id, [1], mode);
  current.legacy.moveHandle(path.id, 0, 2, { x: 452, y: 281 });
  current.actions().moveHandle(path.id, 0, 2, { x: 452, y: 281 });
  assertSamePath(
    current.path(),
    current.legacyPath(),
    `${mode} opposite handle follows original semantics`,
  );
  current.legacy.splitSpan(path.id, 0, 0.37);
  current.actions().splitSpan(path.id, 0, 0.37);
  assertSamePath(
    current.path(),
    current.legacyPath(),
    `${mode} split preserves curves and downgrades symmetry`,
  );
}

const atomic = fixture();
const atomicPath = atomic.path();
const atomicBefore = atomic.editor.state.document;
for (const t of [0, 1, -1, NaN])
  assert.throws(() => atomic.actions().splitSpan(atomicPath.id, 0, t));
for (const args of [
  [-1, 1, { x: 0, y: 0 }],
  [0, 3, { x: 0, y: 0 }],
  [0, 1, { x: NaN, y: 0 }],
])
  assert.throws(() => atomic.actions().moveHandle(atomicPath.id, ...args));
atomic.legacyPath().fitError = 0.9;
atomic.legacy.setModes(atomicPath.id, [1], 'smooth');
assert.equal(
  atomic.legacyPath().fitError,
  undefined,
  'manual mode changes clear obsolete fit quality',
);
const legacyBefore = structuredClone(atomic.legacyPath());
assert.throws(() => atomic.legacy.setModes(atomicPath.id, [1, 0], 'symmetric'));
assert.deepEqual(atomic.legacyPath(), legacyBefore);
assert.equal(
  atomic.legacyCommits(),
  1,
  'an invalid endpoint in a batch cannot partially commit',
);
assert.throws(
  () => atomic.actions().deleteNodes(atomicPath.id, [99], 1.5),
  /索引/,
);
assert.equal(atomic.commits(), 0);
assert.deepEqual(atomic.editor.state.document, atomicBefore);

const last = fixture({ single: true });
const lastPath = last.path();
const lastBefore = last.editor.state.document;
assert.deepEqual(last.actions().deleteNodes(lastPath.id, [0], 1.5), {
  removed: true,
});
assert.equal(
  last.path(),
  undefined,
  'deleting the final point removes its Path',
);
last.editor.undo({ expectedRevision: last.editor.state.revision });
assert.deepEqual(last.editor.state.document, lastBefore);

console.log(
  'PASS node actions share original source behavior, V4 identity commands, atomic guards, and single-step undo',
);
