// Read-only sample profiling. Timings exclude decoding, input copies and hashing.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import assert from 'node:assert/strict';
import { openProject } from '../../src/lib/persistence/open-project.mjs';
import { evaluateDocument } from '../../src/lib/evaluation/evaluate-document.mjs';
import { createPlanarStageCache } from '../../src/lib/evaluation/planar-stage-cache.mjs';
import { projectCreationView } from '../../src/lib/editor/creation-view.mjs';

const { values } = parseArgs({
  options: {
    iterations: { type: 'string', default: '3' },
    output: { type: 'string' },
    baseline: { type: 'string' },
  },
});
const iterations = Number(values.iterations);
assert.ok(Number.isInteger(iterations) && iterations > 0);
const bytes = await readFile(
  new URL('../../public/sandrone-example.spl', import.meta.url),
);
const original = openProject({ bytes: new Uint8Array(bytes) }).document;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const requestedDomains = ['curves', 'regions', 'relief', 'placed-relief'];
const scenarios = {
  original: () => {},
  color: (document) => {
    Object.values(document.appearances.swatches)[0].color = '#102030';
  },
  thickness: (document) => {
    Object.values(document.reliefDefinitions.overrides)[0].value.thickness = {
      kind: 'mm',
      value: 2.1,
    };
  },
  pose: (document) => {
    Object.values(document.nodes)[0].pose.translationMM[0] += 1;
  },
  source: (document) => {
    const vertex = Object.values(document.sketches)
      .flatMap((sketch) => Object.values(sketch.vertices))
      .find((item) => item.position.kind === 'free');
    vertex.position.value[0] += 0.01;
  },
};
const baseline =
  values.baseline && JSON.parse(await readFile(values.baseline, 'utf8'));
const sampleSha256 = hash(bytes);
if (baseline)
  assert.equal(baseline.sampleSha256, sampleSha256, 'baseline sample differs');
const measure = async (document, cache) => {
  const start = performance.now();
  const snapshot = await evaluateDocument(document, {
    requestedDomains,
    planarStageCache: cache,
  });
  const evaluationMs = performance.now() - start;
  const viewStart = performance.now();
  const view = projectCreationView(document, snapshot);
  return {
    snapshot,
    view,
    evaluationMs,
    viewMs: performance.now() - viewStart,
  };
};
await measure(original, createPlanarStageCache());
const runs = [];
for (const [scenario, edit] of Object.entries(scenarios)) {
  let expected;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const document = structuredClone(original);
    edit(document);
    const result = await measure(document, createPlanarStageCache());
    const outputHash = hash(
      JSON.stringify({ snapshot: result.snapshot, view: result.view }),
    );
    expected ||= outputHash;
    assert.equal(outputHash, expected, `${scenario} is not deterministic`);
    if (baseline) {
      const previous = baseline.runs.find((run) => run.scenario === scenario);
      assert.ok(previous, `missing baseline scenario: ${scenario}`);
      assert.equal(
        outputHash,
        previous.outputHash,
        `${scenario} output changed`,
      );
    }
    const row = {
      scenario,
      iteration,
      evaluationMs: result.evaluationMs,
      viewMs: result.viewMs,
      totalMs: result.evaluationMs + result.viewMs,
      cells: result.view.cells.length,
      errors: result.view.errors.length,
      outputHash,
    };
    runs.push(row);
    console.log(JSON.stringify(row));
  }
}
const report = { node: process.version, sampleSha256, requestedDomains, runs };
if (values.output) {
  const output = resolve(values.output);
  assert.notEqual(
    output,
    values.baseline && resolve(values.baseline),
    'do not overwrite baseline',
  );
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
}
