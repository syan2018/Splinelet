import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createSupportCommand } from '../../../src/lib/editing/commands/support.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';
import { readGeometry } from '../../../src/lib/region-engine.mjs';
import { createStudioSession } from '../../../src/lib/editor/studio-session.mjs';

let serial = 0;
const idFactory = () => `support-${++serial}`;
let document = createDocument({ version: 4, idFactory });
document.appearances.swatches.gold = {
  id: 'gold',
  name: '金色',
  color: '#b99a60',
};
const draw = (points, ownerNodeId) => {
  const result = createAuthoringCommand({
    kind: 'draw-path',
    points,
    closed: true,
    ...(ownerNodeId ? { ownerNodeId } : {}),
  })(document, { idFactory });
  document = result.document;
  return document.sketches[
    result.changedRefs.find((r) => r.kind === 'path').sketchId
  ].ownerNodeId;
};
const first = draw([
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
]);
draw(
  [
    [2, 2],
    [8, 2],
    [8, 8],
    [2, 8],
  ],
  first,
);
const second = draw([
  [35, 5],
  [40, 5],
  [40, 10],
  [35, 10],
]);
document.nodes[first].pose.translationMM = [20, 5];
for (const id of [first, second]) {
  document.appearances.defaults[id] = { swatchId: 'gold' };
  document.reliefDefinitions.defaults[id] = {
    enabled: true,
    thickness: { kind: 'mm', value: 1 },
    mode: 'add',
    placement: { kind: 'free', zMM: 7 },
  };
}
const before = structuredClone(document);
const action = {
  kind: 'create-support',
  nodeIds: [first, second],
  offsetMM: 0,
  heightMM: 2,
  swatchId: 'gold',
};
const editor = createEditorSession(document, { idFactory });
const dispatch = (request) =>
  editor.dispatch(createAuthoringCommand(request), {
    expectedRevision: editor.state.revision,
  });
dispatch(action);
const supported = editor.state.document;
const supportId = editor.state.lastChange.selectionIntent.activeRef.id;
assert.deepEqual(supported.sketches, before.sketches);
for (const id of [first, second]) {
  assert.deepEqual(supported.nodes[id], before.nodes[id]);
  assert.deepEqual(
    supported.programs[before.nodes[id].programId],
    before.programs[before.nodes[id].programId],
  );
  assert.deepEqual(
    supported.reliefDefinitions.defaults[id].thickness,
    before.reliefDefinitions.defaults[id].thickness,
  );
}
const regions = evaluateProgram(supported, supportId).regions;
assert.equal(regions.status, 'ready');
assert.equal(readGeometry(regions.value.regions[0].geometry).getArea(), 125);
assert.deepEqual(supported.reliefDefinitions.defaults[first].placement, {
  kind: 'attached',
  target: { kind: 'node', id: supportId },
  offsetMM: 0,
});
const evaluated = await evaluateDocument(supported, {
  requestedDomains: ['placed-relief'],
});
assert.equal(evaluated.placedRelief.status, 'ready');
for (const relief of evaluated.placedRelief.value.reliefs) {
  assert.equal(relief.zBase, relief.ref.ownerNodeId === supportId ? 0 : 2);
  assert.equal(relief.zTop, relief.ref.ownerNodeId === supportId ? 2 : 3);
}
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, before);

const expanded = createSupportCommand({ ...action, offsetMM: 1, stack: false })(
  before,
  { idFactory },
);
const expandedId = expanded.selectionIntent.activeRef.id;
assert.ok(
  readGeometry(
    evaluateProgram(expanded.document, expandedId).regions.value.regions[0]
      .geometry,
  ).getArea() > 125,
);
assert.deepEqual(
  expanded.document.reliefDefinitions.defaults[first],
  before.reliefDefinitions.defaults[first],
);
const resized = structuredClone(supported);
const sourceSketch = Object.values(resized.sketches).find(
  (s) => s.ownerNodeId === second,
);
for (const vertex of Object.values(sourceSketch.vertices))
  vertex.position.value[0] += 3;
assert.notDeepEqual(
  evaluateProgram(resized, supportId).regions.value,
  regions.value,
);

const layered = structuredClone(before);
layered.manufacturing.layers.old = { id: 'old', name: '原层' };
layered.manufacturing.layerOrder = ['old'];
for (const id of [first, second])
  layered.reliefDefinitions.defaults[id].placement = {
    kind: 'layer',
    layerId: 'old',
    offsetMM: 0,
  };
const layerSupport = createSupportCommand({
  kind: 'create-support',
  nodeIds: [first, second],
  heightLayers: 3,
  swatchId: 'gold',
})(layered, { idFactory });
const layerBase = layerSupport.selectionIntent.activeRef.id;
assert.equal(layerSupport.document.manufacturing.layerOrder.length, 2);
assert.equal(layerSupport.document.manufacturing.layerOrder[1], 'old');
assert.deepEqual(
  layerSupport.document.reliefDefinitions.defaults[layerBase].thickness,
  { kind: 'layers', count: 3 },
);
assert.deepEqual(
  layerSupport.document.reliefDefinitions.defaults[first],
  layered.reliefDefinitions.defaults[first],
);
assert.equal(
  (
    await evaluateDocument(layerSupport.document, {
      requestedDomains: ['placed-relief'],
    })
  ).placedRelief.status,
  'ready',
);
const stacked = await evaluateDocument(layerSupport.document, {
  requestedDomains: ['placed-relief'],
});
for (const relief of stacked.placedRelief.value.reliefs) {
  assert.ok(
    Math.abs(relief.zBase - (relief.ref.ownerNodeId === layerBase ? 0 : 0.6)) <
      1e-9,
  );
}
const reject = (source, request, pattern) => {
  const saved = structuredClone(source);
  assert.throws(
    () => createSupportCommand(request)(source, { idFactory }),
    pattern,
  );
  assert.deepEqual(source, saved);
};
reject(before, { ...action, nodeIds: [] }, /选择/);
reject(before, { ...action, nodeIds: ['missing'] }, /部件/);
reject(before, { ...action, offsetMM: -1 }, /无效/);
reject(before, { ...action, swatchId: 'missing' }, /颜色/);
reject(before, { ...action, heightLayers: 3 }, /只能/);
reject(layered, { ...action, heightMM: 0.25 }, /整数/);
const locked = structuredClone(before);
locked.nodes[first].locked = true;
reject(locked, action, /锁定/);
assert.throws(
  () => createSupportCommand(action)(before, { idFactory: () => first }),
  /重复/,
);
assert.deepEqual(before, document);
const customPart = structuredClone(before);
customPart.manufacturing.parts.custom = { id: 'custom', name: '另一个零件' };
for (const id of [first, second])
  customPart.manufacturing.assignments[`part-${id}`] = {
    id: `part-${id}`,
    target: { kind: 'node', id },
    partId: 'custom',
  };
const inheritedPart = createSupportCommand(action)(customPart, { idFactory });
const placedCustom = (
  await evaluateDocument(inheritedPart.document, {
    requestedDomains: ['placed-relief'],
  })
).placedRelief;
assert.equal(placedCustom.status, 'ready');
assert.ok(
  placedCustom.value.reliefs.every((relief) => relief.partId === 'custom'),
);
delete customPart.manufacturing.assignments[`part-${second}`];
reject(customPart, action, /同一制造零件/);
const noPalette = structuredClone(before);
noPalette.appearances = { swatches: {}, defaults: {}, overrides: {} };
const defaultColor = createSupportCommand({ ...action, swatchId: undefined })(
  noPalette,
  { idFactory },
);
const defaultBase = defaultColor.selectionIntent.activeRef.id;
const addedColor =
  defaultColor.document.appearances.defaults[defaultBase].swatchId;
assert.equal(
  defaultColor.document.appearances.swatches[addedColor].color,
  '#b99a60',
);
assert.deepEqual(noPalette.appearances.swatches, {});
const session = createStudioSession({
  opened: { kind: 'v4', document: before, assets: {}, target: null },
  presentation: {
    reference: null,
    frame: { width: 800, height: 600, widthMM: 100 },
    fileName: null,
    blenderExtrusionMM: 2,
  },
  persistence: { writeFile: async () => {} },
  idFactory,
});
const capture = session.getSnapshot();
const args = {
  objectIds: [first, second],
  offsetMM: 0,
  heightMM: 2,
  swatchId: 'gold',
};
const preview = await capture.runtime.evaluate(
  'creation_base',
  args,
  capture.project,
);
assert.deepEqual(session.getSnapshot().editorState.document, before);
assert.ok(
  preview.scene.cells.some((cell) => cell.objectId === preview.objectId),
);
assert.throws(
  () =>
    capture.runtime.commitPreparedDisplay(
      { ...preview.project },
      { project: capture.project, scene: null },
    ),
  /底板/,
);
capture.runtime.commitPreparedDisplay(preview.project, {
  project: capture.project,
  scene: null,
});
assert.equal(
  session.getSnapshot().editorState.revision,
  capture.editorState.revision + 1,
);
assert.ok(session.getSnapshot().editorState.document.nodes[preview.objectId]);
assert.throws(
  () =>
    capture.runtime.commitPreparedDisplay(preview.project, {
      project: session.getSnapshot().project,
      scene: null,
    }),
  /底板/,
);
session.undo();
assert.deepEqual(session.getSnapshot().editorState.document, before);
const again = session.getSnapshot();
const stalePreview = await again.runtime.evaluate(
  'creation_base',
  args,
  again.project,
);
session.dispatch(
  createAuthoringCommand({
    kind: 'set-node',
    nodeId: first,
    value: { name: '已变更' },
  }),
);
assert.throws(
  () =>
    again.runtime.commitPreparedDisplay(stalePreview.project, {
      project: again.project,
      scene: null,
    }),
  /过期/,
);
console.log(
  'PASS live support commands preserve sources, fill holes, offset outlines, attach or prepend a print layer, reject atomically and undo once',
);
