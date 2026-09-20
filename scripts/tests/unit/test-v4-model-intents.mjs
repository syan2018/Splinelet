import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createV4CreationRuntime } from '../../../src/lib/editor/creation-runtime.mjs';
import { createModelIntent } from '../../../src/lib/editor/model-intents.mjs';

let serial = 0;
const idFactory = () => `model-intent-${++serial}`;
const editor = createEditorSession(createDocument({ idFactory }), {
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
runtime.dispose();
console.log(
  'PASS advanced relief intents preserve inherited settings, repair placement, reject stale/forged views and commit selections atomically',
);
