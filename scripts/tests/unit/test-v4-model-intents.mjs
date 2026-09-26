import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAdvancedCommand } from '../../../src/lib/editing/commands/advanced.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createV4CreationRuntime } from '../../../src/lib/editor/creation-runtime.mjs';
import { createModelIntent } from '../../../src/lib/editor/model-intents.mjs';

let serial = 0;
const idFactory = () => `model-intent-${++serial}`;
const editor = createEditorSession(createDocument({ version: 4, idFactory }), {
  idFactory,
});
const dispatch = (command) =>
  editor.dispatch(command, { expectedRevision: editor.state.revision });
for (const x of [0, 20])
  dispatch(
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
const runtime = createV4CreationRuntime({
  editorSession: editor,
  sourceFrame: { width: 100, height: 100, widthMM: 100 },
  toDisplayProject: (state) => ({ revision: state.revision }),
});
const read = async () => {
  const project = runtime.project();
  return {
    project,
    view: await runtime.evaluate('model_workspace', {}, project),
  };
};
let context = await read();
const ids = context.view.regions.map((region) => region.id);
const before = editor.state;
const plan = runtime.modelCommand(
  'relief',
  {
    regionIds: [...ids, ids[0]],
    changes: {
      mode: 'through',
      thickness: { kind: 'mm', value: 4 },
      placement: { kind: 'free', zMM: 3 },
    },
  },
  context,
);
assert.deepEqual(editor.state, before, 'planning has no writes');
plan.commit();
assert.equal(editor.state.revision, before.revision + 1);
assert.equal(
  Object.keys(editor.state.document.reliefDefinitions.overrides).length,
  2,
);
assert.deepEqual(editor.state.document.programs, before.document.programs);
assert.deepEqual(editor.state.document.sketches, before.document.sketches);
assert.throws(() => plan.commit(), /已提交/);
assert.throws(
  () =>
    runtime.modelCommand(
      'relief',
      { regionIds: ids, changes: { enabled: true } },
      context,
    ),
  /过期/,
);
context = await read();
assert.throws(
  () =>
    runtime.modelCommand(
      'relief',
      { regionIds: ids, changes: { enabled: true } },
      { ...context, view: structuredClone(context.view) },
    ),
  /不属于/,
);
for (const region of context.view.regions) {
  assert.equal(region.authoredRelief.value.enabled, false);
  assert.equal(region.authoredRelief.value.mode, 'through');
  assert.equal(region.authoredRelief.value.thickness.value, 4);
  assert.equal(region.authoredRelief.value.placement.zMM, 3);
}
const after = structuredClone(editor.state.document);
runtime
  .modelCommand('relief', { regionIds: ids, changes: { mode: 'cut' } }, context)
  .commit();
context = await read();
for (const region of context.view.regions) {
  assert.equal(region.authoredRelief.value.thickness.value, 4);
  assert.equal(region.authoredRelief.value.placement.zMM, 3);
}
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, after);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, before.document);

// Settings stay editable even when their authored placement is unresolved.
context = await read();
dispatch(
  createAuthoringCommand({
    kind: 'set-relief',
    target: context.view.regions[0].outputRef,
    value: { placement: { kind: 'layer', layerId: 'missing', offsetMM: 0 } },
  }),
);
context = await read();
runtime
  .modelCommand(
    'relief',
    { regionIds: [ids[0]], changes: { placement: { kind: 'free', zMM: 2 } } },
    context,
  )
  .commit();
context = await read();
assert.equal(
  context.view.regions[0].authoredRelief.value.placement.kind,
  'free',
);

// A late locked target cannot leave earlier targets partially edited.
const locked = structuredClone(editor.state.document);
locked.nodes[context.view.regions[1].objectId].locked = true;
dispatch(() => ({ document: locked, changedRefs: [] }));
context = await read();
const lockedState = editor.state;
for (const thickness of [
  { kind: 'mm', value: -1 },
  { kind: 'mm', value: 0 },
  { kind: 'layers', count: 1.5 },
])
  assert.throws(
    () =>
      runtime
        .modelCommand(
          'relief',
          { regionIds: [ids[0]], changes: { thickness } },
          context,
        )
        .commit(),
    /厚度/,
  );
assert.throws(
  () =>
    runtime
      .modelCommand(
        'relief',
        { regionIds: ids, changes: { mode: 'cut' } },
        context,
      )
      .commit(),
  /锁/,
);
assert.deepEqual(editor.state, lockedState);
for (const args of [
  { regionIds: [], changes: { enabled: true } },
  { regionIds: ['missing'], changes: { enabled: true } },
  { regionIds: ids, changes: {} },
  { regionIds: ids, changes: { model: {} } },
  { regionIds: ids, changes: { mode: 'add' }, model: {} },
])
  assert.throws(() => runtime.modelCommand('relief', args, context));
assert.throws(
  () =>
    createModelIntent(
      'relief',
      { regionIds: ids, changes: { mode: 'add' } },
      { ...context.view, previewId: 'gesture' },
    ),
  /已提交版本/,
);
const staleCommand = createModelIntent(
  'relief',
  { regionIds: [ids[0]], changes: { mode: 'add' } },
  context.view,
);
editor.undo({ expectedRevision: editor.state.revision });
assert.throws(() => dispatch(staleCommand), /失效/);
context = await read();
const resourcesBefore = structuredClone(editor.state.document);
runtime
  .modelCommand(
    'part',
    { kind: 'create-part', id: 'extra-part', name: '第二零件' },
    context,
  )
  .commit();
context = await read();
runtime
  .modelCommand(
    'assign-part',
    { regionIds: [ids[0]], partId: 'extra-part' },
    context,
  )
  .commit();
context = await read();
assert.equal(
  context.view.regions.find((region) => region.id === ids[0]).part.id,
  'extra-part',
);
runtime
  .modelCommand(
    'part',
    { kind: 'rename-part', id: 'extra-part', name: '修改名称' },
    context,
  )
  .commit();
assert.equal(
  editor.state.document.manufacturing.parts['extra-part'].name,
  '修改名称',
);
for (let index = 0; index < 3; index++)
  editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, resourcesBefore);
context = await read();
const diagnosticBase = context.view.regions[0];
dispatch(
  createAuthoringCommand({
    kind: 'draw-path',
    ownerNodeId: diagnosticBase.objectId,
    name: '预览接边分割线',
    closed: false,
    points: [
      [5, 0.1],
      [5, 9.9],
    ],
  }),
);
context = await read();
const diagnosticDivider = context.view.source.paths.find(
  (path) => path.name === '预览接边分割线',
);
const diagnosticPreview = runtime.prepareModelConstruction(
  {
    kind: 'split',
    baseId: context.view.regions[0].id,
    pathIds: [diagnosticDivider.id],
    joinMM: 0.15,
  },
  context,
);
assert.equal(
  diagnosticPreview.connections.length,
  2,
  'runtime projects exact partition endpoint diagnostics for the original UI',
);
assert.ok(
  diagnosticPreview.connections.every(
    (connection) =>
      connection.pathId === diagnosticDivider.id &&
      Number.isFinite(connection.gapMM),
  ),
);
const beforeConstruction = editor.state.document;
const sourceId = context.view.source.paths.find((path) => !path.locked).id;
const construction = runtime.prepareModelConstruction(
  { kind: 'stroke', pathId: sourceId, widthMM: 1 },
  context,
);
assert.deepEqual(
  editor.state.document,
  beforeConstruction,
  'construction preview is readonly',
);
assert.ok(construction.candidates.length > 0);
assert.throws(() => construction.commit([]), /至少保留/);
const created = construction.commit(
  construction.candidates.map((_, index) => index),
);
const constructedView = await runtime.evaluate(
  'model_workspace',
  {},
  created.project,
);
for (const id of created.regionIds)
  assert.ok(constructedView.regions.some((region) => region.id === id));
assert.deepEqual(editor.state.document.sketches, beforeConstruction.sketches);
assert.throws(() => construction.commit([0]), /已提交/);
const afterConstruction = editor.state.document;
context = await read();
const reboundPreview = runtime.prepareModelConstruction(
  { kind: 'stroke', pathId: sourceId, widthMM: 2 },
  context,
);
const rebound = reboundPreview.commit([0], {
  replaceId: created.regionIds[0],
  name: '重新绑定的面',
});
context = await read();
assert.equal(
  context.view.regions.find((item) => item.id === rebound.regionIds[0]).name,
  '重新绑定的面',
);
assert.deepEqual(editor.state.document.sketches, beforeConstruction.sketches);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, afterConstruction);
context = await read();
runtime
  .modelCommand('delete-regions', { regionIds: created.regionIds }, context)
  .commit();
context = await read();
assert.ok(
  created.regionIds.every(
    (id) => !context.view.regions.some((item) => item.id === id),
  ),
);
assert.deepEqual(editor.state.document.sketches, beforeConstruction.sketches);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, afterConstruction);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, beforeConstruction);
dispatch(
  createAuthoringCommand({
    kind: 'draw-path',
    closed: true,
    points: [
      [50, 0],
      [60, 0],
      [60, 10],
      [50, 10],
    ],
  }),
);
context = await read();
const unpainted = context.view.regions.find((region) => !region.reliefDefined);
assert.ok(unpainted);
const beforeRelief = editor.state.document;
runtime
  .modelCommand('color', { regionId: unpainted.id, color: '#12ab34' }, context)
  .commit();
assert.deepEqual(
  editor.state.document.reliefDefinitions,
  beforeRelief.reliefDefinitions,
  'marker color does not create or enable relief',
);
context = await read();
assert.equal(
  context.view.regions.find((region) => region.id === unpainted.id).color,
  '#12ab34',
);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, beforeRelief);
context = await read();
assert.throws(
  () =>
    runtime
      .modelCommand(
        'create-relief',
        { regionIds: [unpainted.id], heightMM: 3, partId: 'missing' },
        context,
      )
      .commit(),
  /Part/,
);
assert.deepEqual(
  editor.state.document,
  beforeRelief,
  'invalid part rolls back the relief definition',
);
runtime
  .modelCommand(
    'create-relief',
    { regionIds: [unpainted.id], heightMM: 3 },
    context,
  )
  .commit();
context = await read();
assert.equal(
  context.view.regions.find((region) => region.id === unpainted.id)
    .authoredRelief.value.thickness.value,
  3,
);
const beforeAdditional = editor.state.document;
const additional = runtime.modelCommand(
  'create-relief',
  { regionIds: [unpainted.id], heightMM: 5 },
  context,
);
additional.commit();
assert.equal(additional.regionIds.length, 1);
assert.notEqual(additional.regionIds[0], unpainted.id);
context = await read();
const contribution = context.view.regions.find(
  (region) => region.id === additional.regionIds[0],
);
assert.equal(contribution.authoredRelief.value.thickness.value, 5);
assert.equal(
  context.view.regions.find((region) => region.id === unpainted.id)
    .authoredRelief.value.thickness.value,
  3,
);
assert.deepEqual(editor.state.document.sketches, beforeAdditional.sketches);
const reference = Object.values(
  editor.state.document.programs[
    editor.state.document.nodes[contribution.objectId].programId
  ].operators,
)[0];
assert.equal(reference.type, 'region-reference');
assert.equal(reference.inputs.input[0].space, 'world-result');
assert.deepEqual(reference.params.scope.refs, [unpainted.outputRef]);
const beforeContributionCopy = structuredClone(editor.state.document);
const existingNodeIds = new Set(Object.keys(beforeContributionCopy.nodes));
dispatch(
  createAdvancedCommand({
    kind: 'copy-nodes',
    nodeIds: [unpainted.objectId, contribution.objectId],
  }),
);
const copiedContribution = Object.values(editor.state.document.nodes).find(
  (node) =>
    node.kind === 'shape' &&
    !existingNodeIds.has(node.id) &&
    Object.values(
      editor.state.document.programs[node.programId].operators,
    ).some((operator) => operator.type === 'region-reference'),
);
assert.ok(copiedContribution, 'copy creates the independent region consumer');
const copiedReference = Object.values(
  editor.state.document.programs[copiedContribution.programId].operators,
).find((operator) => operator.type === 'region-reference');
assert.notEqual(
  copiedReference.params.scope.refs[0].ownerNodeId,
  unpainted.objectId,
  'copied contribution scope follows the copied source owner',
);
assert.equal(
  copiedReference.params.scope.refs[0].ownerNodeId,
  copiedReference.inputs.input[0].ownerNodeId,
  'copied contribution scope and input target the same copied source',
);
const copiedContributionRegions = evaluateProgram(
  editor.state.document,
  copiedContribution.id,
).regions;
assert.equal(
  copiedContributionRegions.status,
  'ready',
  JSON.stringify(copiedContributionRegions.diagnostics),
);
assert.equal(copiedContributionRegions.value.regions.length, 1);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, beforeContributionCopy);
context = await read();
const reboundContribution = runtime.modelCommand(
  'feature',
  {
    id: contribution.id,
    changes: { regionId: ids[0], name: '重绑贡献', heightMM: 7 },
  },
  context,
);
reboundContribution.commit();
context = await read();
const reboundContributionRegion = context.view.regions.find(
  (region) => region.id === reboundContribution.regionIds[0],
);
assert.equal(reboundContributionRegion.reliefName, '重绑贡献');
assert.equal(reboundContributionRegion.authoredRelief.value.thickness.value, 7);
assert.deepEqual(
  editor.state.document.sketches,
  beforeContributionCopy.sketches,
);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, beforeContributionCopy);
context = await read();
runtime
  .modelCommand(
    'feature',
    {
      id: contribution.id,
      changes: { name: '独立体块', heightMM: 5.5, color: '#abcdef' },
    },
    context,
  )
  .commit();
context = await read();
runtime
  .modelCommand(
    'relief',
    {
      regionIds: [contribution.id],
      changes: { thickness: { kind: 'mm', value: 6 } },
    },
    context,
  )
  .commit();
context = await read();
assert.equal(
  context.view.regions.find((region) => region.id === contribution.id)
    .reliefName,
  '独立体块',
);
runtime
  .modelCommand('delete-relief', { regionIds: [contribution.id] }, context)
  .commit();
context = await read();
const deleted = context.view.regions.find(
  (region) => region.id === contribution.id,
);
assert.equal(deleted.reliefDefined, false);
assert.equal(deleted.authoredRelief.value.enabled, false);
assert.deepEqual(editor.state.document.sketches, beforeAdditional.sketches);
for (let index = 0; index < 4; index++)
  editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, beforeAdditional);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, beforeRelief);
runtime.dispose();
console.log(
  'PASS advanced relief intents preserve inherited settings, repair placement, reject stale/forged views and commit selections atomically',
);
