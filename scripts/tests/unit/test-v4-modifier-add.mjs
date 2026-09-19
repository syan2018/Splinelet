import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createV4CreationRuntime } from '../../../src/lib/editor/creation-runtime.mjs';
import { compileModifierAdd } from '../../../src/lib/editor/modifier-intents.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { projectCreationView } from '../../../src/lib/editor/creation-view.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';

let serial = 0;
const idFactory = () => `add-${++serial}`;
const editor = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
const dispatch = (command) =>
  editor.dispatch(command, { expectedRevision: editor.state.revision });
dispatch(
  createAuthoringCommand({
    kind: 'draw-path',
    points: [
      [1, 2],
      [4, 3],
    ],
    closed: false,
  }),
);
const owner = Object.values(editor.state.document.nodes)[0];
dispatch((document) => {
  document.nodes[owner.id].pose = {
    translationMM: [20, 30],
    rotationRad: Math.PI / 2,
  };
  return { document };
});
const runtime = createV4CreationRuntime({
  editorSession: editor,
  toDisplayProject: (_state, view) => ({ version: 4, creation: view.creation }),
});
const request = {
  objectId: owner.id,
  type: 'curve_mirror',
  name: '镜像',
  targets: { kind: 'all' },
  angleDeg: 120,
  centerMM: { x: 18, y: 34 },
};
const before = editor.state.document;
const pristineRequest = structuredClone(request);
const action = compileModifierAdd(before, request);
assert.deepEqual(action.center, [4, 2]);
assert.ok(Math.abs(action.angleRad - Math.PI / 6) < 1e-10);
assert.deepEqual(request, pristineRequest);
const initialPort = before.programs[owner.programId].outputs.curves;
const project = runtime.project();
const scene = await runtime.evaluate('creation', {}, project);
assert.deepEqual(
  scene.creation.objects.find((item) => item.id === owner.id).modifierAdd,
  {
    types: ['curve_mirror', 'curve_array'],
    reason: null,
  },
);
runtime.command('modifier_add', request, { project, scene }).commit();
let program = editor.state.document.programs[owner.programId];
const mirror = program.operators[program.outputs.curves.operatorId];
assert.equal(mirror.type, 'curve-mirror');
assert.equal(mirror.inputs.input[0].operatorId, initialPort.operatorId);
assert.equal(mirror.inputs.input[0].ownerNodeId, owner.id);
assert.deepEqual(editor.state.document.sketches, before.sketches);
assert.notDeepEqual(
  evaluateProgram(editor.state.document, owner.id).curves.value,
  evaluateProgram(before, owner.id).curves.value,
);
const afterMirror = editor.state.document;
const arrayRequest = {
  ...request,
  type: 'curve_array',
  name: '阵列',
  count: 3,
  angleDeg: 45,
};
runtime
  .command('modifier_add', arrayRequest, { project: runtime.project() })
  .commit();
program = editor.state.document.programs[owner.programId];
const array = program.operators[program.outputs.curves.operatorId];
assert.equal(array.type, 'curve-array');
assert.equal(array.inputs.input[0].operatorId, mirror.id);
assert.equal(array.params.count, 3);
assert.equal(
  array.params.angleRad,
  Math.PI / 4,
  'array step is relative, independent of owner pose',
);
assert.deepEqual(editor.state.document.sketches, before.sketches);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, afterMirror);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, before, 'each add is exactly one undo');

const reject = (args, pattern) => {
  const state = editor.state;
  const copy = structuredClone(args);
  assert.throws(
    () =>
      runtime
        .command('modifier_add', args, { project: runtime.project() })
        .commit(),
    pattern,
  );
  assert.deepEqual(editor.state, state, 'failed add is atomic');
  assert.deepEqual(args, copy, 'failed add never mutates input');
};
/** @type {Array<[Record<string, unknown>, RegExp]>} */
const invalidRequests = [
  [{ targets: { kind: 'selected', refs: [] } }, /targets/],
  [{ targets: { kind: 'all', refs: [] } }, /未知字段/],
  [{ angleDeg: 361 }, /angleDeg/],
  [{ angleDeg: null }, /有限数/],
  [{ centerMM: { x: Infinity, y: 0 } }, /有限数/],
  [{ centerMM: { x: 0, y: 0, z: 0 } }, /未知字段/],
  [{ name: ' ' }, /非空字符串/],
  [{ operation: 'union' }, /未知字段/],
  [{ sourceFeatureId: 'other' }, /未知字段/],
  [{ count: 3 }, /未知字段/],
  [{ type: 'fill', joinMM: 0 }, /尚不支持类型/],
  [{ type: 'offset' }, /尚不支持类型/],
  [{ objectId: 'missing' }, /不存在/],
  [{ type: 'curve_array', count: 1.5 }, /整数/],
  [{ type: 'curve_array', count: 65 }, /count/],
];
for (const [changes, pattern] of invalidRequests)
  reject({ ...request, ...changes }, pattern);

dispatch(createAuthoringCommand({ kind: 'create-shape', name: '无来源' }));
const emptyOwner = Object.values(editor.state.document.nodes).find(
  (node) => node.id !== owner.id,
);
reject({ ...request, objectId: emptyOwner.id }, /没有已发布 curves/);
dispatch((document) => {
  document.nodes[owner.id].locked = true;
  return { document };
});
reject(request, /锁定/);
editor.undo({ expectedRevision: editor.state.revision });
const invalidOwner = structuredClone(editor.state.document);
invalidOwner.programs[owner.programId].ownerNodeId = emptyOwner.id;
assert.throws(() => compileModifierAdd(invalidOwner, request), /所有权无效/);
const inheritedLock = structuredClone(editor.state.document);
inheritedLock.nodes.parent = {
  id: 'parent',
  kind: 'group',
  name: '锁定父组',
  parentId: null,
  order: 0,
  pose: { translationMM: [0, 0], rotationRad: 0 },
  visible: true,
  locked: true,
};
inheritedLock.nodes[owner.id].parentId = 'parent';
const lockedView = projectCreationView(
  inheritedLock,
  await evaluateDocument(inheritedLock, {
    requestedDomains: ['curves', 'regions'],
  }),
);
const lockedCapability = lockedView.creation.objects.find(
  (item) => item.id === owner.id,
).modifierAdd;
assert.deepEqual(lockedCapability.types, []);
assert.match(lockedCapability.reason, /锁定/);
assert.throws(() => compileModifierAdd(inheritedLock, request), /锁定/);
assert.throws(
  () => compileModifierAdd(inheritedLock, { ...request, objectId: 'parent' }),
  /Shape/,
);

dispatch((document) => {
  document.programs[owner.programId].operators[
    initialPort.operatorId
  ].inputs.paths[0].sketchId = 'missing';
  return { document };
});
reject(request, /当前 curves 输出不可用/);
editor.undo({ expectedRevision: editor.state.revision });
dispatch(
  createAuthoringCommand({ kind: 'fill-curves', ownerNodeId: owner.id }),
);
reject(request, /已发布区域/);
const regionsView = await runtime.evaluate('creation', {}, runtime.project());
const regionsCapability = regionsView.creation.objects.find(
  (item) => item.id === owner.id,
).modifierAdd;
assert.deepEqual(regionsCapability.types, []);
assert.match(regionsCapability.reason, /已有区域/);
console.log(
  'PASS modifier_add appends explicit curve stages with world/local conversion, preserves raw sources, undoes once, and rejects unsupported or unsafe requests atomically',
);
