import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import {
  encodeDocument,
  decodeDocument,
} from '../../../src/lib/document/codec.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createVectorImportCommand } from '../../../src/lib/editing/commands/vector-import.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createV4CreationRuntime } from '../../../src/lib/editor/creation-runtime.mjs';
import { projectModifierControls } from '../../../src/lib/editor/modifier-view.mjs';
import { compileModifierUpdate } from '../../../src/lib/editor/modifier-intents.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';

let serial = 0;
const idFactory = () => `stroke-control-${++serial}`;
const editor = createEditorSession(createDocument({ version: 4, idFactory }), {
  idFactory,
});
editor.dispatch(
  createVectorImportCommand({
    name: 'Imported ink',
    splines: [
      {
        name: 'Ink',
        nodes: [{ co: { x: 0, y: 0 } }, { co: { x: 100, y: 0 } }],
        closed: false,
        role: 'guide',
        fillGroup: 'ink',
        elementId: 'ink',
        fill: null,
        stroke: '#aabbcc',
        strokeWidth: 4,
      },
    ],
    bounds: { minX: 0, minY: -2, maxX: 100, maxY: 2 },
    widthMM: 50,
    centerMM: [0, 0],
    thicknessMM: 0.8,
  }),
  { expectedRevision: editor.state.revision },
);
const shape = Object.values(editor.state.document.nodes).find(
  (n) => n.kind === 'shape',
);
const stroke = Object.values(
  editor.state.document.programs[shape.programId].operators,
).find((op) => op.type === 'stroke');
const controls = (doc = editor.state.document) =>
  projectModifierControls(doc, shape.id, stroke.id);
assert.equal(controls().values.widthMM, 2);
assert.ok(controls().editableFields.includes('widthMM'));
const runtime = createV4CreationRuntime({
  editorSession: editor,
  toDisplayProject: (_state, view) => ({ version: 4, creation: view.creation }),
});
const before = structuredClone(editor.state.document);
const project = runtime.project();
const scene = await runtime.evaluate('creation', {}, project);
const status = scene.modifierStatus.find(
  (item) => item.modifierId === stroke.id,
);
assert.equal(status.controls.values.widthMM, 2);
assert.equal(
  status.note,
  undefined,
  'an open stroke is valid, not a modifier warning',
);
const region = () =>
  evaluateProgram(editor.state.document, shape.id).regions.value.regions[0];
const width = () => {
  const ys = region()
    .geometry.coordinates.flat(2)
    .filter((_, index) => index % 2 === 1);
  return Math.max(...ys) - Math.min(...ys);
};
assert.equal(width(), 2);
const outputRef = structuredClone(region().ref);
runtime
  .command(
    'modifier_update',
    {
      objectId: shape.id,
      modifierId: stroke.id,
      changes: { widthMM: 3.5 },
    },
    { project, scene },
  )
  .commit();
assert.equal(
  width(),
  3.5,
  'width edits change the evaluated region, not just UI state',
);
assert.deepEqual(
  region().ref,
  outputRef,
  'width changes preserve output identity',
);
assert.deepEqual(editor.state.document.sketches, before.sketches);
assert.deepEqual(
  editor.state.document.reliefDefinitions,
  before.reliefDefinitions,
);
assert.deepEqual(editor.state.document.appearances, before.appearances);
const edited = structuredClone(editor.state.document);
assert.deepEqual(
  decodeDocument(encodeDocument(edited)).document,
  edited,
  'saved stroke width survives .spl reopen',
);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, before);
editor.redo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, edited);
assert.equal(width(), 3.5);
for (const widthMM of [0, -1, NaN, Infinity, '2']) {
  assert.throws(() =>
    runtime
      .command(
        'modifier_update',
        {
          objectId: shape.id,
          modifierId: stroke.id,
          changes: { widthMM },
        },
        { project: runtime.project() },
      )
      .commit(),
  );
  assert.deepEqual(editor.state.document, edited, 'invalid widths are atomic');
}
// A Stroke also sizes all curve instances produced upstream, using the same
// width without baking or altering their source sketch.
const instanced = structuredClone(edited);
const instancedProgram = instanced.programs[shape.programId];
const strokeInput = structuredClone(
  instancedProgram.operators[stroke.id].inputs.input[0],
);
instancedProgram.operators.inkCopies = {
  id: 'inkCopies',
  name: 'Ink copies',
  type: 'curve-array',
  enabled: true,
  params: { count: 2, angleRad: Math.PI, center: [0, 10] },
  inputs: { input: [strokeInput] },
};
instancedProgram.operators[stroke.id].inputs.input[0].operatorId = 'inkCopies';
const copies = createEditorSession(instanced, { idFactory });
copies.dispatch(
  createAuthoringCommand(
    compileModifierUpdate(instanced, {
      objectId: shape.id,
      modifierId: stroke.id,
      changes: { widthMM: 0.75 },
    }),
  ),
  { expectedRevision: copies.state.revision },
);
const copyRegions = evaluateProgram(copies.state.document, shape.id).regions;
assert.equal(copyRegions.status, 'ready');
assert.equal(copyRegions.value.regions.length, 2);
for (const item of copyRegions.value.regions) {
  const ys = item.geometry.coordinates
    .flat(2)
    .filter((_, index) => index % 2 === 1);
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 0.75) < 1e-9);
}
assert.deepEqual(copies.state.document.sketches, instanced.sketches);
copies.undo({ expectedRevision: copies.state.revision });
assert.deepEqual(copies.state.document, instanced);

const driven = structuredClone(edited);
driven.parameters.inkWidth = {
  id: 'inkWidth',
  name: 'Ink width',
  ownerNodeId: shape.id,
  unit: 'mm',
  value: 1.25,
};
driven.programs[shape.programId].operators[stroke.id].params.widthMM = {
  kind: 'parameter',
  id: 'inkWidth',
};
assert.equal(controls(driven).values.widthMM, 1.25);
assert.ok(controls(driven).drivenFields.includes('widthMM'));
assert.ok(!controls(driven).editableFields.includes('widthMM'));
assert.throws(
  () =>
    compileModifierUpdate(driven, {
      objectId: shape.id,
      modifierId: stroke.id,
      changes: { widthMM: 2 },
    }),
  /驱动/,
);
delete driven.parameters.inkWidth;
assert.equal(controls(driven).values.widthMM, undefined);
assert.ok(
  controls(driven).diagnostics.some((item) => item.field === 'widthMM'),
);
const locked = structuredClone(edited);
locked.nodes[shape.parentId].locked = true;
assert.deepEqual(controls(locked).editableFields, []);
assert.throws(
  () =>
    compileModifierUpdate(locked, {
      objectId: shape.id,
      modifierId: stroke.id,
      changes: { widthMM: 2 },
    }),
  /锁定/,
);
console.log(
  'PASS imported stroke width: geometry, identity, undo/redo, validation, parameter binding and inherited lock',
);
