import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createCreationIntent } from '../../../src/lib/editor/creation-intents.mjs';
import { projectCreationView } from '../../../src/lib/editor/creation-view.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';
import { sourcePathId } from '../../../src/lib/editor/source-view.mjs';

let serial = 0;
const idFactory = () => `creation-basic-${++serial}`;
const editor = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
const dispatch = (command) =>
  editor.dispatch(command, { expectedRevision: editor.state.revision });
const view = async () => ({
  epoch: editor.state.epoch,
  revision: editor.state.revision,
  ...projectCreationView(
    editor.state.document,
    await evaluateDocument(editor.state.document, {
      requestedDomains: ['regions', 'relief', 'placed-relief'],
    }),
  ),
});
const run = async (action, args) =>
  dispatch(createCreationIntent(action, args, await view()));

for (const x of [0, 20])
  dispatch(
    createAuthoringCommand({
      kind: 'draw-path',
      name: `轮廓 ${x}`,
      closed: true,
      points: [
        [x, 0],
        [x + 10, 0],
        [x + 10, 10],
        [x, 10],
      ],
    }),
  );

let creation = (await view()).creation;
const [first, second] = creation.objects;
const firstPathId = first.pathIds[0];
await run('rename_path', { id: firstPathId, name: '  外轮廓  ' });
const firstPathRef = (await view()).identities.paths[firstPathId];
assert.equal(
  editor.state.document.sketches[firstPathRef.sketchId].paths[firstPathRef.id]
    .name,
  '外轮廓',
);

const beforeReorderRevision = editor.state.revision;
await run('reorder', { objectIds: [second.id], beforeId: first.id });
assert.equal(editor.state.revision, beforeReorderRevision + 1);
assert.deepEqual(
  (await view()).creation.objects.map((item) => item.id),
  [second.id, first.id],
);

dispatch(
  createAuthoringCommand({
    kind: 'draw-guide',
    ownerNodeId: first.id,
    name: '待转移辅助线',
    closed: false,
    points: [
      [2, 2],
      [8, 8],
    ],
  }),
);
const guideRef = editor.state.lastChange.changedRefs.find(
  (ref) => ref.kind === 'path',
);
const guideDisplayId = sourcePathId(guideRef.sketchId, guideRef.id);
const guideWorldBefore = structuredClone(
  editor.state.document.sketches[guideRef.sketchId].vertices,
);
dispatch(createAuthoringCommand({ kind: 'create-shape', name: '空目标' }));
const emptyTargetId = editor.state.lastChange.selectionIntent.activeRef.id;
assert.equal(
  Object.values(editor.state.document.sketches).some(
    (sketch) => sketch.ownerNodeId === emptyTargetId,
  ),
  false,
);
const beforeMove = editor.state.document;
await run('move_paths', {
  objectId: emptyTargetId,
  pathIds: [guideDisplayId],
});
const afterMove = editor.state.document;
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(
  editor.state.document,
  beforeMove,
  'empty target Sketch creation and source transfer undo together',
);
editor.redo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, afterMove);
const movedSketch = Object.values(editor.state.document.sketches).find(
  (sketch) =>
    sketch.ownerNodeId === emptyTargetId &&
    Object.hasOwn(sketch.paths, guideRef.id),
);
assert.ok(movedSketch, 'path ownership transfers to the target Shape');
assert.deepEqual(
  Object.keys(guideWorldBefore).map((id) => movedSketch.vertices[id].position),
  Object.values(guideWorldBefore).map((item) => item.position),
  'identity-pose transfer keeps world coordinates',
);

creation = (await view()).creation;
const cells = (await view()).cells;
await run('paint', {
  cellKeys: cells.map((cell) => cell.key),
  color: '#336699',
});
const zBefore = editor.state.revision;
await run('object', { id: second.id, changes: { zMM: 3 } });
assert.equal(editor.state.revision, zBefore + 1);
assert.equal(
  editor.state.document.reliefDefinitions.defaults[second.id].placement.zMM,
  3,
);
await run('object', { id: second.id, changes: { attachId: first.id } });
assert.deepEqual(
  editor.state.document.reliefDefinitions.defaults[second.id].placement,
  {
    kind: 'attached',
    target: { kind: 'node', id: first.id },
    offsetMM: 3,
  },
);
assert.equal(
  (await view()).creation.objects.find((item) => item.id === second.id)
    .attachId,
  first.id,
);
const beforeCycle = editor.state;
await assert.rejects(
  () => run('object', { id: first.id, changes: { attachId: second.id } }),
  /形成循环/,
);
assert.deepEqual(editor.state, beforeCycle);

const beforePrint = editor.state.document;
await run('print_enable', { confirm: true, layerHeightMM: 0.2 });
let order = editor.state.document.manufacturing.layerOrder;
assert.equal(order.length, 1);
for (const id of [first.id, second.id, emptyTargetId]) {
  const value = editor.state.document.reliefDefinitions.defaults[id];
  assert.equal(value.placement.kind, 'layer');
  assert.equal(value.placement.layerId, order[0]);
  assert.equal(value.placement.offsetMM, 0);
  assert.equal(value.thickness.kind, 'layers');
}
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(
  editor.state.document,
  beforePrint,
  'print enable and every relief conversion use one undo entry',
);
await run('print_enable', { confirm: true, layerHeightMM: 0.2 });
await run('print_layer_add', { name: '上层' });
order = editor.state.document.manufacturing.layerOrder;
await run('print_assign', { objectIds: [second.id], layerId: order[1] });
assert.equal(
  editor.state.document.reliefDefinitions.defaults[second.id].placement.layerId,
  order[1],
);
assert.ok(
  Object.values(editor.state.document.reliefDefinitions.overrides)
    .filter((item) => item.target.ownerNodeId === second.id)
    .every((item) => item.value.placement.layerId === order[1]),
);
assert.equal(
  (await view()).creation.objects.find((item) => item.id === second.id)
    .printLayerId,
  order[1],
);

const beforeCombine = editor.state;
await assert.rejects(
  () => run('combine_objects', { objectIds: [first.id, second.id] }),
  /打印分层部件/,
);
assert.deepEqual(editor.state, beforeCombine);

const combineEditor = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
const combineDispatch = (command) =>
  combineEditor.dispatch(command, {
    expectedRevision: combineEditor.state.revision,
  });
for (const x of [0, 20])
  combineDispatch(
    createAuthoringCommand({
      kind: 'draw-path',
      closed: true,
      points: [
        [x, 0],
        [x + 10, 0],
        [x + 10, 10],
        [x, 10],
      ],
    }),
  );
const combineView = async () => ({
  epoch: combineEditor.state.epoch,
  revision: combineEditor.state.revision,
  ...projectCreationView(
    combineEditor.state.document,
    await evaluateDocument(combineEditor.state.document, {
      requestedDomains: ['regions', 'relief', 'placed-relief'],
    }),
  ),
});
const simpleObjects = (await combineView()).creation.objects;
const beforeSimpleCombine = combineEditor.state.document;
combineDispatch(
  createCreationIntent(
    'combine_objects',
    { objectIds: simpleObjects.map((item) => item.id) },
    await combineView(),
  ),
);
assert.equal(
  Object.values(combineEditor.state.document.nodes).filter(
    (node) => node.kind === 'shape',
  ).length,
  1,
);
assert.equal(
  Object.values(combineEditor.state.document.sketches)
    .filter((sketch) => sketch.ownerNodeId === simpleObjects[0].id)
    .flatMap((sketch) => Object.values(sketch.paths)).length,
  2,
);
assert.equal((await combineView()).cells.length, 2);
combineEditor.undo({ expectedRevision: combineEditor.state.revision });
assert.deepEqual(
  combineEditor.state.document,
  beforeSimpleCombine,
  'plain closed Shapes combine in one undoable source/program transaction',
);

const guideEditor = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
const guideDispatch = (command) =>
  guideEditor.dispatch(command, {
    expectedRevision: guideEditor.state.revision,
  });
guideDispatch(createAuthoringCommand({ kind: 'create-shape', name: '空目标' }));
for (const x of [0, 10])
  guideDispatch(
    createAuthoringCommand({
      kind: 'draw-guide',
      closed: false,
      points: [
        [x, 0],
        [x + 5, 5],
      ],
    }),
  );
const guideView = async () => ({
  epoch: guideEditor.state.epoch,
  revision: guideEditor.state.revision,
  ...projectCreationView(
    guideEditor.state.document,
    await evaluateDocument(guideEditor.state.document, {
      requestedDomains: ['regions', 'relief', 'placed-relief'],
    }),
  ),
});
const guideObjects = (await guideView()).creation.objects;
const beforeGuideCombine = guideEditor.state.document;
guideDispatch(
  createCreationIntent(
    'combine_objects',
    { objectIds: guideObjects.map((item) => item.id) },
    await guideView(),
  ),
);
assert.equal(
  Object.values(guideEditor.state.document.nodes).filter(
    (node) => node.kind === 'shape',
  ).length,
  1,
);
assert.equal(
  Object.values(guideEditor.state.document.sketches).flatMap((sketch) =>
    Object.values(sketch.paths),
  ).length,
  2,
);
guideEditor.undo({ expectedRevision: guideEditor.state.revision });
assert.deepEqual(guideEditor.state.document, beforeGuideCombine);

console.log(
  'PASS Creation basic intents use canonical path/source/scene/manufacturing state with atomic undo and explicit unsafe combine rejection',
);
