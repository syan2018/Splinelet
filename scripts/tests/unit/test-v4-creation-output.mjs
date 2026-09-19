import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createV4CreationRuntime } from '../../../src/lib/editor/creation-runtime.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';

let sequence = 0,
  bodies = 0;
const idFactory = () => `output-${++sequence}`;
const editor = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
editor.dispatch(
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
  { expectedRevision: 0 },
);
let release;
let wait = null;
const runtime = createV4CreationRuntime({
  editorSession: editor,
  sourceFrame: { width: 800, height: 600, widthMM: 160 },
  toDisplayProject: (state, view) => ({ version: 4, creation: view.creation }),
  evaluate: async (document, options) => {
    assert.equal(typeof options.epoch, 'string');
    if (options.requestedDomains.includes('bodies')) {
      bodies++;
      if (wait) await wait;
    }
    return evaluateDocument(document, options);
  },
});
let project = runtime.project();
let scene = await runtime.evaluate('creation', {}, project);
project = runtime
  .command(
    'paint',
    { cellKeys: [scene.cells[0].key], color: '#ffaa00' },
    { project, scene },
  )
  .commit();
scene = await runtime.evaluate('creation', {}, project);
project = runtime
  .command(
    'height',
    { cellKeys: [scene.cells[0].key], heightMM: 2 },
    { project, scene },
  )
  .commit();
const baseline = editor.state;
const settings = runtime.readOutputSettings(project);
assert.equal(
  settings.defaultPartId,
  editor.state.document.manufacturing.defaultPartId,
);
assert.ok(Object.isFrozen(settings.parts));
const solid = await runtime.evaluate(
  'solid',
  { partId: settings.defaultPartId },
  project,
);
assert.equal(solid.report.valid, true);
assert.ok(Math.abs(solid.report.volumeMM3 - 200) < 0.001);
const exported = await runtime.evaluate(
  '3mf',
  { partId: settings.defaultPartId },
  project,
);
assert.equal(bodies, 1, 'check and export reuse the same committed BodySet');
assert.deepEqual(editor.state, baseline);
assert.equal(exported.report.volumeMM3, solid.report.volumeMM3);
const zip = unzipSync(new Uint8Array(exported.bytes));
assert.match(strFromU8(zip['3D/3dmodel.model']), /<triangle /);
await assert.rejects(
  runtime.evaluate('solid', { partId: 'missing' }, project),
  /不存在/,
);
await assert.rejects(
  runtime.evaluate('3mf', { slicerTemplate: { wrong: true } }, project),
  /模板/,
);
const preview = runtime.beginObjectGesture(project, [
  Object.keys(editor.state.document.nodes)[0],
]);
await assert.rejects(runtime.evaluate('solid', {}, runtime.project()), /拖动/);
preview.cancel();
editor.undo({ expectedRevision: editor.state.revision });
await assert.rejects(runtime.evaluate('solid', {}, project), /过期/);
project = runtime.project();
wait = new Promise((resolve) => {
  release = resolve;
});
const delayed = runtime.evaluate('solid', {}, project);
editor.redo({ expectedRevision: editor.state.revision });
release();
await assert.rejects(delayed, /过期/);
runtime.dispose();
console.log(
  'PASS original output runtime builds canonical solids and 3MF, preserves document, reuses bodies, rejects preview and late output',
);
