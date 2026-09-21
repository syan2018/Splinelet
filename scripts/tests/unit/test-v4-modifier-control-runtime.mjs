import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createV4CreationRuntime } from '../../../src/lib/editor/creation-runtime.mjs';
import { projectModifierControls } from '../../../src/lib/editor/modifier-view.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';

let serial = 0;
const idFactory = () => `control-${++serial}`;
const editor = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
const dispatch = (command) =>
  editor.dispatch(command, { expectedRevision: editor.state.revision });
dispatch(
  createAuthoringCommand({
    kind: 'draw-path',
    points: [
      [0, 0],
      [4, 3],
    ],
    closed: false,
  }),
);
const owner = Object.values(editor.state.document.nodes)[0];
dispatch(
  createAuthoringCommand({
    kind: 'mirror-curves',
    ownerNodeId: owner.id,
    center: [2, 3],
    angleRad: Math.PI / 4,
  }),
);
const mirror = Object.values(
  editor.state.document.programs[owner.programId].operators,
).find((operator) => operator.type === 'curve-mirror');
dispatch((document) => {
  document.nodes[owner.id].pose = {
    translationMM: [20, 30],
    rotationRad: Math.PI / 2,
  };
  return { document };
});
const read = () =>
  projectModifierControls(editor.state.document, owner.id, mirror.id);
assert.ok(Math.abs(read().values.angleDeg - 135) < 1e-10);
assert.deepEqual(read().values.centerMM, { x: 17, y: 32 });
assert.ok(Object.isFrozen(read().values.centerMM));
const runtime = createV4CreationRuntime({
  editorSession: editor,
  toDisplayProject: (_state, view) => ({ version: 4, creation: view.creation }),
});
const project = runtime.project();
const scene = await runtime.evaluate('creation', {}, project);
assert.deepEqual(
  scene.modifierStatus.find((item) => item.modifierId === mirror.id).controls,
  read(),
);
const before = editor.state.document;
const beforeCurves = evaluateProgram(before, owner.id).curves.value;
const nextProject = runtime
  .command(
    'modifier_update',
    {
      objectId: owner.id,
      modifierId: mirror.id,
      changes: {
        name: '世界坐标镜像',
        angleDeg: 120,
        centerMM: { x: 18, y: 34 },
      },
    },
    { project, scene },
  )
  .commit();
assert.equal(read().values.name, '世界坐标镜像');
assert.ok(Math.abs(read().values.angleDeg - 120) < 1e-10);
assert.deepEqual(read().values.centerMM, { x: 18, y: 34 });
assert.deepEqual(editor.state.document.sketches, before.sketches);
assert.notDeepEqual(
  evaluateProgram(editor.state.document, owner.id).curves.value,
  beforeCurves,
);
assert.notEqual(nextProject, project);
assert.throws(
  () =>
    runtime.command(
      'modifier_update',
      {
        objectId: owner.id,
        modifierId: mirror.id,
        changes: { enabled: false },
      },
      { project, scene },
    ),
  /过期/,
);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(
  editor.state.document,
  before,
  'name and parameter changes form one undo',
);

dispatch((document) => {
  document.parameters.angle = {
    id: 'angle',
    name: '角度',
    ownerNodeId: owner.id,
    unit: 'rad',
    value: Math.PI / 3,
  };
  document.programs[owner.programId].operators[mirror.id].params.angleRad = {
    kind: 'parameter',
    id: 'angle',
  };
  return { document };
});
assert.ok(
  Math.abs(read().values.angleDeg - 150) < 1e-10,
  'driven controls display resolved values',
);
assert.ok(read().drivenFields.includes('angleDeg'));
assert.ok(!read().editableFields.includes('angleDeg'));
const drivenProject = runtime.project();
const drivenBefore = editor.state;
assert.throws(() =>
  runtime
    .command(
      'modifier_update',
      { objectId: owner.id, modifierId: mirror.id, changes: { angleDeg: 90 } },
      { project: drivenProject },
    )
    .commit(),
);
assert.deepEqual(
  editor.state,
  drivenBefore,
  'ordinary input cannot detach a parameter',
);
dispatch((document) => {
  delete document.parameters.angle;
  return { document };
});
assert.equal(Object.hasOwn(read().values, 'angleDeg'), false);
assert.ok(
  read().diagnostics.length,
  'unresolved parameters do not display a fake zero',
);
console.log(
  'PASS original modifier controls roundtrip world values through V4 runtime, preserve source geometry, undo once and protect parameter bindings',
);
