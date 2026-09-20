import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createCreationIntent } from '../../../src/lib/editor/creation-intents.mjs';
import { sourcePathId } from '../../../src/lib/editor/source-view.mjs';
import { regionPathUses } from '../../../src/lib/editing/region-drawing.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { readGeometry } from '../../../src/lib/region-engine.mjs';
import { createV4CreationRuntime } from '../../../src/lib/editor/creation-runtime.mjs';
import { projectCreationView } from '../../../src/lib/editor/creation-view.mjs';
import {
  encodeDocument,
  decodeDocument,
} from '../../../src/lib/document/codec.mjs';

let serial = 0;
const idFactory = () => `role-${++serial}`;
const editor = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
const dispatch = (command) =>
  editor.dispatch(command, { expectedRevision: editor.state.revision });
const draw = (points, ownerNodeId, kind = 'draw-path', closed = true) => {
  dispatch(createAuthoringCommand({ kind, closed, points, ownerNodeId }));
  return editor.state.lastChange.changedRefs.find((ref) => ref.kind === 'path');
};
const outer = draw([
  [0, 0],
  [20, 0],
  [20, 20],
  [0, 20],
]);
const owner = editor.state.document.sketches[outer.sketchId].ownerNodeId;
const inner = draw(
  [
    [5, 5],
    [15, 5],
    [15, 15],
    [5, 15],
  ],
  owner,
);
const view = () => ({
  epoch: editor.state.epoch,
  revision: editor.state.revision,
});
const intent = (refs, role, displayed = view()) =>
  createCreationIntent(
    'roles',
    {
      objectId: owner,
      pathIds: refs.map((ref) => sourcePathId(ref.sketchId, ref.id)),
      role,
    },
    displayed,
  );
const role = (refs, role) => dispatch(intent(refs, role));
const area = () => {
  const stage = evaluateProgram(editor.state.document, owner).regions;
  assert.equal(stage.status, 'ready');
  return stage.value.regions.reduce(
    (sum, region) => sum + readGeometry(region.geometry).getArea(),
    0,
  );
};
const before = structuredClone(editor.state.document);
const stale = intent([inner], 'guide');
role([inner], 'guide');
assert.equal(area(), 400);
assert.deepEqual(editor.state.document.sketches, before.sketches);
assert.throws(() => dispatch(stale), /失效/);
role([inner], 'boundary');
assert.equal(area(), 300);
const restored = structuredClone(editor.state.document);
const revision = editor.state.revision;
role([inner], 'boundary');
assert.equal(editor.state.revision, revision, 'same role is a no-op');
editor.undo({ expectedRevision: editor.state.revision });
assert.equal(area(), 400);
editor.redo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, restored);

role([inner], 'hole');
assert.equal(area(), 300);
role([inner], 'boundary');
assert.equal(
  area(),
  300,
  'an inactive hole must not resolve stale targets against the restored Fill',
);
role([inner], 'hole');
assert.equal(area(), 300);
dispatch(() => ({ document: structuredClone(restored), changedRefs: [] }));

const guide = draw(
  [
    [1, 1],
    [3, 1],
    [3, 3],
    [1, 3],
  ],
  owner,
  'draw-guide',
);
const guideBefore = structuredClone(editor.state.document);
assert.equal(
  projectCreationView(guideBefore, {}).creation.objects[0].roles[
    sourcePathId(guide.sketchId, guide.id)
  ],
  'guide',
);
const complex = structuredClone(guideBefore);
const complexProgram = complex.programs[complex.nodes[owner].programId];
const sourceId = idFactory(),
  transformId = idFactory(),
  fillId = idFactory(),
  collectId = idFactory();
const inputRef = (id, domain = 'curves') => ({
  kind: 'port',
  ownerNodeId: owner,
  operatorId: id,
  domain,
  port: domain,
  space: 'local-result',
  transform: [1, 0, 0, 1, 0, 0],
});
complexProgram.operators[sourceId] = {
  id: sourceId,
  type: 'source',
  name: 'source',
  enabled: true,
  params: {},
  inputs: {
    paths: [{ kind: 'sketch', sketchId: guide.sketchId, pathIds: [guide.id] }],
  },
};
complexProgram.operators[transformId] = {
  id: transformId,
  type: 'curve-transform',
  name: 'transform',
  enabled: true,
  params: { transform: [1, 0, 0, 1, 30, 0] },
  inputs: { input: [inputRef(sourceId)] },
};
complexProgram.operators[fillId] = {
  id: fillId,
  type: 'fill',
  name: 'derived fill',
  enabled: true,
  params: { rule: 'even-odd' },
  inputs: { input: [inputRef(transformId)] },
};
complexProgram.operators[collectId] = {
  id: collectId,
  type: 'region-collect',
  name: 'collect',
  enabled: true,
  params: {},
  inputs: {
    input: [
      {
        ...complexProgram.outputs.regions,
        space: 'local-result',
        transform: [1, 0, 0, 1, 0, 0],
      },
      inputRef(fillId, 'regions'),
    ],
  },
};
complexProgram.outputs.regions = inputRef(collectId, 'regions');
const complexBefore = structuredClone(complex);
assert.throws(
  () =>
    createAuthoringCommand({
      kind: 'set-path-roles',
      pathRefs: [inner, guide],
      role: 'guide',
    })(complex, { idFactory }),
  /派生构面/,
);
assert.deepEqual(
  complex,
  complexBefore,
  'failure on the second path must roll back the first membership change',
);
assert.equal(
  projectCreationView(complex, {}).creation.objects[0].roles[
    sourcePathId(guide.sketchId, guide.id)
  ],
  undefined,
  'derived participation is not a guide',
);
role([guide], 'boundary');
assert.equal(
  area(),
  296,
  'new boundary joins the existing ordinary even-odd Fill',
);
assert.deepEqual(editor.state.document.sketches, guideBefore.sketches);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, guideBefore);
role([guide], 'hole');
assert.equal(area(), 296);
assert.equal(regionPathUses(editor.state.document, guide)[0].role, 'hole');
const holeDoc = structuredClone(editor.state.document);
role([guide], 'guide');
assert.equal(regionPathUses(editor.state.document, guide).length, 0);
assert.equal(area(), 300);
role([guide], 'hole');
assert.equal(area(), 296);
assert.deepEqual(
  evaluateProgram(editor.state.document, owner).regions.value,
  evaluateProgram(holeDoc, owner).regions.value,
);
// Return to the pre-hole document to test a newly constructed divider.
dispatch(() => ({
  document: structuredClone(guideBefore),
  changedRefs: [],
}));
const line = draw(
  [
    [2, 0],
    [2, 20],
  ],
  owner,
  'draw-guide',
  false,
);
const lineBefore = structuredClone(editor.state.document);
role([line], 'divider');
assert.equal(area(), 300);
assert.equal(
  evaluateProgram(editor.state.document, owner).regions.value.regions.length,
  2,
);
const divided = structuredClone(editor.state.document);
role([line], 'guide');
assert.equal(regionPathUses(editor.state.document, line).length, 0);
const reopened = decodeDocument(encodeDocument(editor.state.document)).document;
assert.deepEqual(reopened, editor.state.document);
const resumed = createAuthoringCommand({
  kind: 'set-path-roles',
  pathRefs: [line],
  role: 'divider',
})(reopened, { idFactory }).document;
assert.deepEqual(
  evaluateProgram(resumed, owner).regions.value,
  evaluateProgram(divided, owner).regions.value,
);
assert.equal(area(), 300);
role([line], 'divider');
assert.deepEqual(
  evaluateProgram(editor.state.document, owner).regions.value,
  evaluateProgram(divided, owner).regions.value,
);
assert.deepEqual(editor.state.document.sketches, lineBefore.sketches);
const unchanged = structuredClone(editor.state.document);
assert.throws(() => role([line], 'boundary'), /必须闭合/);
assert.throws(
  () =>
    role(
      [inner, { kind: 'path', sketchId: 'missing', id: 'missing' }],
      'guide',
    ),
  /失效/,
);
assert.deepEqual(editor.state.document, unchanged);
const solo = createAuthoringCommand({
  kind: 'draw-guide',
  closed: true,
  points: [
    [0, 0],
    [2, 0],
    [2, 2],
    [0, 2],
  ],
})(createDocument({ idFactory }), { idFactory });
const soloPath = solo.changedRefs.find((ref) => ref.kind === 'path');
const soloOwner = solo.document.sketches[soloPath.sketchId].ownerNodeId;
const soloBoundary = createAuthoringCommand({
  kind: 'set-path-roles',
  pathRefs: [soloPath],
  role: 'boundary',
})(solo.document, { idFactory });
assert.equal(
  evaluateProgram(soloBoundary.document, soloOwner).regions.status,
  'ready',
);
assert.deepEqual(soloBoundary.document.sketches, solo.document.sketches);

// The original workspace prepares, evaluates and commits through opaque runtime
// handles. A role preview must not change the authoritative document.
const runtime = createV4CreationRuntime({
  editorSession: editor,
  toDisplayProject: (state, creation) => ({
    version: 4,
    creation: creation.creation,
  }),
});
const project = runtime.project();
const scene = await runtime.evaluate('creation', {}, project);
const prepared = await runtime.prepare(
  'roles',
  {
    objectId: owner,
    pathIds: [sourcePathId(line.sketchId, line.id)],
    role: 'guide',
  },
  { project, scene },
);
assert.deepEqual(editor.state.document, unchanged);
await runtime.evaluate('creation', {}, prepared.project);
runtime.commitPrepared(prepared, { project, scene });
assert.equal(regionPathUses(editor.state.document, line).length, 0);
assert.throws(
  () => runtime.commitPrepared(prepared, { project, scene }),
  /失效|过期/,
);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, unchanged);
console.log(
  'PASS original roles use canonical membership, ordinary boundary insertion and new hole/divider construction with stale guards, atomic undo and prepared previews',
);
