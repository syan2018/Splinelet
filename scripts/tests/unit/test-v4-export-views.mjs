import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';
import { exportSnapshot } from '../../../src/lib/export/snapshot.mjs';
import { mountV4BrowserAPI } from '../helpers/v4-browser.mjs';
import { createV4AgentAPI } from '../../../src/lib/agent/v4-api.mjs';
let serial = 0;
const doc = createDocument({ version: 4 });
doc.appearances.swatches.red = { id: 'red', name: 'red', color: '#ff0000' };
const editor = createEditorSession(doc, {
  idFactory: () => `export-view-${++serial}`,
});
const run = (action) =>
  editor.dispatch(createAuthoringCommand(action), {
    expectedRevision: editor.state.revision,
  });
run({
  kind: 'draw-path',
  points: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
  closed: true,
});
const owner = Object.keys(editor.state.document.nodes)[0];
let evaluated = await evaluateDocument(editor.state.document, {
  requestedDomains: ['regions'],
});
run({
  kind: 'paint-region',
  target: evaluated.regions[0].value.regions[0].ref,
  swatchId: 'red',
});
run({ kind: 'move-nodes', nodeIds: [owner], deltaMM: [20, 30] });
evaluated = await evaluateDocument(editor.state.document, {
  requestedDomains: ['curves', 'regions'],
});
const captured = {
  epoch: editor.state.epoch,
  revision: editor.state.revision,
  previewId: null,
  snapshot: evaluated,
};
assert.deepEqual(
  evaluated.sourceCurves.value.curves[0].edges[0].cubic[0],
  [20, 30],
);
assert.equal(evaluated.worldRegions.value.regions[0].color, '#ff0000');
const source = await exportSnapshot(captured, {
  format: 'svg-source',
  stage: 'curves',
});
assert.match(source.data, /width="10mm"/);
assert.match(source.data, /viewBox="20 -40 10 10"/);
const colored = await exportSnapshot(captured, {
  format: 'svg-colored',
  stage: 'regions',
});
assert.match(colored.data, /fill="#ff0000"/);
assert.match(colored.data, /scale\(1 -1\)/);
// Toggling visibility is display-only; the export snapshot still includes the object.
run({ kind: 'set-node', nodeId: owner, value: { visible: false } });
assert.deepEqual(
  (
    await evaluateDocument(editor.state.document, {
      requestedDomains: ['curves'],
    })
  ).sourceCurves.value,
  evaluated.sourceCurves.value,
);
const api = createV4AgentAPI({ editorSession: editor });
const host = {},
  tools = [];
const dispose = mountV4BrowserAPI(api, {
  host,
  modelContext: { registerTool: (definition) => tools.push(definition) },
});
assert.equal(host.traceStudio, api);
assert.ok(tools.some((tool) => tool.name === 'splinelet_authoring_run'));
const before = editor.state.document;
const preview = await api.call('preview.begin', {
  expectedRevision: editor.state.revision,
});
await api.call('preview.update', {
  expectedRevision: preview.revision,
  previewId: preview.previewId,
  action: { kind: 'move-nodes', nodeIds: [owner], deltaMM: [5, 0] },
});
assert.deepEqual(editor.state.document, before);
assert.notDeepEqual(editor.state.preview.document, before);
await api.call('preview.cancel', {
  expectedRevision: preview.revision,
  previewId: preview.previewId,
});
assert.deepEqual(editor.state.document, before);
dispose();
assert.equal(host.traceStudio, undefined);
console.log(
  'V4 world export views, mm/y-up SVG, display independence and browser API preview parity passed',
);
