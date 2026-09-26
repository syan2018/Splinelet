// Read-only source file: author commands run only in isolated editor sessions.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { openProject } from '../../src/lib/persistence/open-project.mjs';
import { createEditorSession } from '../../src/lib/editing/dispatcher.mjs';
import { createCreationIntent } from '../../src/lib/editor/creation-intents.mjs';
import { projectCreationView } from '../../src/lib/editor/creation-view.mjs';
import { evaluateDocument } from '../../src/lib/evaluation/evaluate-document.mjs';
import { createPlanarStageCache } from '../../src/lib/evaluation/planar-stage-cache.mjs';
import { createPostStageCache } from '../../src/lib/evaluation/post-evaluation-plan.mjs';

const { values } = parseArgs({
  options: {
    input: { type: 'string', default: 'public/sandrone-example.spl' },
    scope: { type: 'string', default: 'both' },
    output: { type: 'string' },
  },
});
assert(['cell', 'object', 'both'].includes(values.scope));
const bytes = new Uint8Array(await readFile(values.input));
const original = openProject({ bytes }).document;
const requestedDomains = ['curves', 'regions', 'relief', 'placed-relief'];
const options = {
  requestedDomains,
  planarStageCache: createPlanarStageCache(),
  postStageCache: createPostStageCache(),
};
const baseline = await evaluateDocument(original, options);
const view = projectCreationView(original, baseline);
const owner =
  view.creation.objects.find((object) => object.name === '头发') ||
  view.creation.objects[0];
const cells = view.cells.filter((cell) => cell.objectId === owner.id);
assert(cells.length);
const rows = [];
for (const scope of values.scope === 'both'
  ? ['cell', 'object']
  : [values.scope]) {
  const editor = createEditorSession(original);
  const before = editor.state.document;
  const displayed = {
    ...view,
    epoch: editor.state.epoch,
    revision: editor.state.revision,
  };
  const start = performance.now();
  editor.dispatch(
    createCreationIntent(
      'height',
      {
        ...(scope === 'cell'
          ? { cellKeys: [cells[0].key] }
          : { objectIds: [owner.id] }),
        heightMM: 2.1,
      },
      displayed,
    ),
    { expectedRevision: editor.state.revision },
  );
  const commandMS = performance.now() - start;
  const evaluationStart = performance.now();
  const snapshot = await evaluateDocument(editor.state.document, options);
  const evaluationMS = performance.now() - evaluationStart;
  assert.deepEqual(
    snapshot.planar,
    baseline.planar,
    'thickness cannot change planar geometry',
  );
  assert.deepEqual(editor.state.document.sketches, before.sketches);
  assert.deepEqual(editor.state.document.programs, before.programs);
  assert.deepEqual(
    editor.state.document.regionDefinitions,
    before.regionDefinitions,
  );
  const viewStart = performance.now();
  const changedView = projectCreationView(editor.state.document, snapshot);
  const viewMS = performance.now() - viewStart;
  assert.equal(changedView.cells.length, view.cells.length);
  const targetKeys = new Set(
    (scope === 'cell' ? [cells[0]] : cells).map((cell) => cell.key),
  );
  for (const cell of changedView.cells.filter((cell) =>
    targetKeys.has(cell.key),
  ))
    assert.equal(
      cell.heightMM,
      2.1,
      'the new authored thickness reaches the view',
    );
  editor.undo({ expectedRevision: editor.state.revision });
  assert.deepEqual(editor.state.document, before);
  rows.push({
    scope,
    targets: scope === 'cell' ? 1 : cells.length,
    commandMS,
    evaluationMS,
    viewMS,
  });
  console.log(JSON.stringify(rows.at(-1)));
}
const report = {
  node: process.version,
  sampleSha256: createHash('sha256').update(bytes).digest('hex'),
  requestedDomains,
  rows,
};
if (values.output) {
  const output = resolve(values.output);
  assert.notEqual(output.toLowerCase(), resolve(values.input).toLowerCase());
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
