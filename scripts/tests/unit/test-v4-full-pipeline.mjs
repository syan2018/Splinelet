import assert from 'node:assert/strict';
import { repeatedRingDocument } from '../fixtures/v4-programs.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';
import { exportSnapshot } from '../../../src/lib/export/snapshot.mjs';

const document = repeatedRingDocument();
document.appearances.swatches.red = {
  id: 'red',
  name: 'Red',
  color: '#ff0000',
};
document.appearances.defaults.shape = { swatchId: 'red' };
document.reliefDefinitions.defaults.shape = {
  enabled: true,
  thickness: { kind: 'mm', value: 1 },
  mode: 'add',
  placement: { kind: 'free', zMM: 0 },
};
const result = await evaluateDocument(document);
assert.equal(result.curves[0].status, 'ready');
assert.equal(result.regions[0].status, 'ready');
assert.equal(result.relief.status, 'ready');
assert.equal(result.placedRelief.status, 'ready');
assert.equal(
  result.bodies.status,
  'ready',
  JSON.stringify(result.bodies.diagnostics),
);
assert(result.bodies.value.bodies[0].report.volumeMM3 > 0);
const capture = {
  epoch: 'full',
  revision: 1,
  previewId: null,
  snapshot: {
    curves: result.planar.components['operator:source'].ports.curves,
    regions: result.regions[0],
    bodies: result.bodies,
  },
};
const source = await exportSnapshot(capture, {
  format: 'svg-source',
  sourceOperatorIds: ['source'],
  stage: 'curves',
});
assert.match(source.data, /<path/);
const stl = await exportSnapshot(capture, { format: 'stl', stage: 'bodies' });
assert(stl.data.byteLength > 84);
const mf = await exportSnapshot(capture, { format: '3mf', stage: 'bodies' });
assert(mf.data.byteLength > 100);
const moved = structuredClone(document);
moved.nodes.shape.pose.translationMM = [20, 5];
const movedResult = await evaluateDocument(moved);
assert.deepEqual(
  movedResult.regions[0].value,
  result.regions[0].value,
  'planar result remains owner-local',
);
assert.notEqual(
  movedResult.bodies.value.bodies[0].report.bounds[0][0],
  result.bodies.value.bodies[0].report.bounds[0][0],
  'manufacturing BodySet uses world XY',
);
const broken = structuredClone(document);
broken.sketches.sketch.vertices['outer-b'].position.value[0] += 0.1;
const failed = await evaluateDocument(broken);
assert.equal(failed.curves[0].status, 'ready');
assert.equal(failed.regions[0].status, 'blocked');
assert.equal(failed.bodies.status, 'blocked');
const sourceOnly = await evaluateDocument(broken, {
  requestedDomains: ['curves'],
});
assert.equal(sourceOnly.curves[0].status, 'ready');
assert.equal(sourceOnly.relief.status, 'absent');
console.log(
  'PASS: V4 full pipeline preserves source stages through Fill failure and builds real placed BodySet exports.',
);
