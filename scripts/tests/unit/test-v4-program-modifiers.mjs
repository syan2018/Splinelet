import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import {
  curveModifierAddCapability,
  linearProgramCapability,
  programModifierCapabilities,
} from '../../../src/lib/editing/commands/program-modifiers.mjs';
import {
  compileModifierAdd,
  compileModifierStructure,
} from '../../../src/lib/editor/modifier-intents.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';
import { projectCreationView } from '../../../src/lib/editor/creation-view.mjs';

let serial = 0;
const idFactory = () => `program-modifier-${++serial}`;
const editor = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
const dispatch = (command) =>
  editor.dispatch(command, { expectedRevision: editor.state.revision });
const inputPort = (reference) => ({
  ...structuredClone(reference),
  space: 'local-result',
  transform: [1, 0, 0, 1, 0, 0],
});
const outputPort = (ownerNodeId, operatorId, domain) => ({
  kind: 'port',
  ownerNodeId,
  operatorId,
  port: domain,
  domain,
});

dispatch(
  createAuthoringCommand({
    kind: 'draw-path',
    closed: true,
    points: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
  }),
);
const owner = Object.values(editor.state.document.nodes)[0];
const programId = owner.programId;
const beforeModifiers = editor.state.document;
const originalProgram = beforeModifiers.programs[programId];
const fillId = originalProgram.outputs.regions.operatorId;
const originalFillInput = structuredClone(
  originalProgram.operators[fillId].inputs.input[0],
);

const mirrorAction = compileModifierAdd(editor.state.document, {
  objectId: owner.id,
  type: 'curve_mirror',
  name: '镜像',
  targets: { kind: 'all' },
  centerMM: { x: 20, y: 0 },
  angleDeg: 90,
});
dispatch(createAuthoringCommand(mirrorAction));
let program = editor.state.document.programs[programId];
const mirror = Object.values(program.operators).find(
  (operator) => operator.type === 'curve-mirror',
);
assert.deepEqual(mirror.inputs.input[0], originalFillInput);
assert.equal(program.operators[fillId].inputs.input[0].operatorId, mirror.id);
assert.deepEqual(
  program.outputs.curves,
  originalProgram.outputs.curves,
  'insertion before Fill does not hijack the separately published curve port',
);

dispatch(
  createAuthoringCommand(
    compileModifierAdd(editor.state.document, {
      objectId: owner.id,
      type: 'curve_array',
      name: '阵列',
      targets: { kind: 'all' },
      centerMM: { x: 0, y: 0 },
      angleDeg: 180,
      count: 2,
    }),
  ),
);
program = editor.state.document.programs[programId];
const array = Object.values(program.operators).find(
  (operator) => operator.type === 'curve-array',
);
assert.equal(array.inputs.input[0].operatorId, mirror.id);
assert.equal(program.operators[fillId].inputs.input[0].operatorId, array.id);
assert.deepEqual(
  programModifierCapabilities(editor.state.document, owner.id, mirror.id),
  {
    moveUp: { enabled: false, reason: '此步骤不是可旁路的单输入同域链' },
    moveDown: { enabled: true, reason: null },
    remove: { enabled: true, reason: null },
  },
);
assert.equal(
  programModifierCapabilities(editor.state.document, owner.id, array.id)
    .moveDown.enabled,
  false,
  'a curve modifier cannot move across Fill',
);

const beforeCurveMove = editor.state.document;
dispatch(
  createAuthoringCommand(
    compileModifierStructure(editor.state.document, {
      action: 'modifier_move',
      objectId: owner.id,
      modifierId: array.id,
      direction: -1,
    }),
  ),
);
program = editor.state.document.programs[programId];
assert.equal(
  program.operators[array.id].inputs.input[0].operatorId,
  originalFillInput.operatorId,
);
assert.equal(program.operators[mirror.id].inputs.input[0].operatorId, array.id);
assert.equal(program.operators[fillId].inputs.input[0].operatorId, mirror.id);
assert.equal(
  evaluateProgram(editor.state.document, owner.id).regions.status,
  'ready',
);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, beforeCurveMove);

const beforeCurveRemove = editor.state.document;
dispatch(
  createAuthoringCommand(
    compileModifierStructure(editor.state.document, {
      action: 'modifier_remove',
      objectId: owner.id,
      modifierId: mirror.id,
    }),
  ),
);
program = editor.state.document.programs[programId];
assert.equal(
  program.operators[array.id].inputs.input[0].operatorId,
  originalFillInput.operatorId,
);
assert.equal(program.operators[fillId].inputs.input[0].operatorId, array.id);
assert.equal(
  evaluateProgram(editor.state.document, owner.id).regions.status,
  'ready',
);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, beforeCurveRemove);

dispatch((document) => {
  const mutable = document.programs[programId];
  const first = 'region-offset-first';
  const second = 'region-offset-second';
  mutable.operators[first] = {
    id: first,
    type: 'offset',
    name: '偏移一',
    enabled: true,
    inputs: { input: [inputPort(mutable.outputs.regions)] },
    params: { scope: { kind: 'all' }, distanceMM: 0.2 },
  };
  mutable.operators[second] = {
    id: second,
    type: 'offset',
    name: '偏移二',
    enabled: true,
    inputs: { input: [inputPort(outputPort(owner.id, first, 'regions'))] },
    params: { scope: { kind: 'all' }, distanceMM: 0.3 },
  };
  mutable.outputs.regions = outputPort(owner.id, second, 'regions');
  return { document, changedRefs: [{ kind: 'node', id: owner.id }] };
});
const first = 'region-offset-first';
const second = 'region-offset-second';
assert.equal(
  evaluateProgram(editor.state.document, owner.id).regions.status,
  'ready',
);
assert.equal(
  programModifierCapabilities(editor.state.document, owner.id, first).moveUp
    .enabled,
  false,
);
assert.equal(
  programModifierCapabilities(editor.state.document, owner.id, first).moveDown
    .enabled,
  true,
);
assert.equal(
  programModifierCapabilities(editor.state.document, owner.id, second).moveUp
    .enabled,
  true,
);
assert.equal(
  programModifierCapabilities(editor.state.document, owner.id, second).moveDown
    .enabled,
  false,
);

const beforeRegionMove = editor.state.document;
dispatch(
  createAuthoringCommand({
    kind: 'move-program-modifier',
    ownerNodeId: owner.id,
    operatorId: second,
    direction: -1,
  }),
);
program = editor.state.document.programs[programId];
assert.equal(program.operators[second].inputs.input[0].operatorId, fillId);
assert.equal(program.operators[first].inputs.input[0].operatorId, second);
assert.equal(program.outputs.regions.operatorId, first);
assert.equal(
  evaluateProgram(editor.state.document, owner.id).regions.status,
  'ready',
);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, beforeRegionMove, 'move is one undo');

const snapshot = await evaluateDocument(editor.state.document, {
  requestedDomains: ['curves', 'regions'],
});
const view = projectCreationView(editor.state.document, snapshot);
const visibleIds = view.modifierStatus.map((status) => status.modifierId);
assert.deepEqual(visibleIds, [mirror.id, array.id, fillId, first, second]);
assert.deepEqual(view.creation.objects[0].modifierAdd.types, [
  'curve_mirror',
  'curve_array',
  'join',
]);
assert.equal(view.creation.objects[0].modifierAdd.reason, null);
assert.equal(
  view.modifierStatus.find((status) => status.modifierId === second).structure
    .moveUp.enabled,
  true,
);

const branch = structuredClone(editor.state.document);
branch.programs[programId].operators.branch = {
  id: 'branch',
  type: 'offset',
  name: '分叉',
  enabled: true,
  inputs: { input: [inputPort(outputPort(owner.id, first, 'regions'))] },
  params: { scope: { kind: 'all' }, distanceMM: 0.1 },
};
assert.match(
  linearProgramCapability(branch, owner.id, first, 'remove').reason,
  /分叉/,
);

const selected = structuredClone(editor.state.document);
selected.programs[programId].operators[first].params.scope = {
  kind: 'selected',
  refs: [
    evaluateProgram(editor.state.document, owner.id).regions.value.regions[0]
      .ref,
  ],
};
assert.match(
  linearProgramCapability(selected, owner.id, first, 'remove').reason,
  /精确区域作用范围/,
);

const invalidAssignment = evaluateProgram(editor.state.document, owner.id)
  .regions.value.regions[0].ref;
const beforeRejectedMove = editor.state.document;
dispatch((document) => {
  document.manufacturing.excluded.push(structuredClone(invalidAssignment));
  return { document, changedRefs: [invalidAssignment] };
});
const assignedState = editor.state;
assert.throws(
  () =>
    dispatch(
      createAuthoringCommand({
        kind: 'move-program-modifier',
        ownerNodeId: owner.id,
        operatorId: second,
        direction: -1,
      }),
    ),
  /OutputRef 失效/,
);
assert.deepEqual(
  editor.state,
  assignedState,
  'invalidating an authored OutputRef is atomic',
);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, beforeRejectedMove);

const curveBranch = structuredClone(beforeModifiers);
const curveSource =
  curveBranch.programs[programId].operators[fillId].inputs.input[0];
curveBranch.programs[programId].operators['curve-branch'] = {
  id: 'curve-branch',
  type: 'curve-mirror',
  name: '曲线分叉',
  enabled: true,
  inputs: { input: [structuredClone(curveSource)] },
  params: { center: [0, 0], angleRad: 0 },
};
assert.match(curveModifierAddCapability(curveBranch, owner.id).reason, /分叉/);

console.log(
  'PASS Program modifiers insert before unique Fill, reorder and remove linear same-domain chains, expose exact capabilities, and reject unsafe topology or OutputRef changes atomically',
);
