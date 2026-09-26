import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { openProject } from '../../src/lib/persistence/open-project.mjs';
import { createStudioSession } from '../../src/lib/editor/studio-session.mjs';
import { beginV4PointGesture } from '../../src/lib/source-editor/point-gesture.mjs';

// Read-only input; all gesture edits are confined to an isolated memory session.
const file = process.argv[2] || 'public/sandrone-example.spl';
const opened = openProject({ bytes: new Uint8Array(fs.readFileSync(file)) });
let evaluations = 0;
const session = createStudioSession({
  opened,
  presentation: {
    frame: opened.document.sourceFrame,
    reference: null,
    fileName: 'source-benchmark.spl',
    blenderExtrusionMM: 2,
  },
  persistence: {
    writeFile: async () => {
      throw Error('Benchmark must not save');
    },
  },
  evaluate: () => {
    evaluations++;
    throw Error('Source feedback must not evaluate regions');
  },
});
const initial = session.getSnapshot();
const path =
  initial.project.paths.find((item) => item.name === '头发大型') ||
  initial.project.paths.find((item) => item.curves.length && !item.locked);
assert.ok(path, '需要一条可编辑的样条');
const gesture = beginV4PointGesture({
  runtime: initial.runtime,
  project: initial.project,
  pathId: path.id,
  curve: 0,
  point: 0,
  displayOnly: true,
});
const samples = [];
for (let index = 0; index < 100; index++) {
  const start = performance.now();
  gesture.update({ x: (index + 1) / 100, y: (index + 1) / 100 });
  samples.push(performance.now() - start);
}
assert.equal(session.getSnapshot(), initial);
assert.equal(evaluations, 0);
const start = performance.now();
gesture.commit();
const commitMS = performance.now() - start;
assert.equal(
  session.getSnapshot().editorState.revision,
  initial.editorState.revision + 1,
);
session.undo();
assert.deepEqual(
  session.getSnapshot().editorState.document,
  initial.editorState.document,
);
session.dispose();
const sorted = [...samples].sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      file,
      samples: samples.length,
      sourcePaths: initial.project.paths.length,
      pointerSynchronousMS: {
        median: sorted[49],
        p95: sorted[94],
        max: sorted[99],
      },
      commitMS,
      evaluationsDuringGesture: evaluations,
      note: 'Node source projection timing; browser input-to-paint must be measured separately.',
    },
    null,
    2,
  ),
);
