import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  assertV4SnapshotsEqual,
  compareV4Snapshots,
  v4ComparisonThresholds,
} from '../helpers/v4-compare.mjs';

const root = new URL('../../../', import.meta.url);
const manifest = JSON.parse(
  await readFile(
    new URL('../fixtures/v4-baseline/manifest.json', import.meta.url),
  ),
);
const baseline = JSON.parse(
  await readFile(
    new URL('../fixtures/v4-baseline/minimal-success.json', import.meta.url),
  ),
);
const sha256 = async (path) =>
  createHash('sha256')
    .update(await readFile(new URL(path, root)))
    .digest('hex');
const clone = (value) => structuredClone(value);
const mismatch = (expected, actual, path) =>
  compareV4Snapshots(expected, actual).some(
    (difference) => difference.path === path,
  );

assert.equal(manifest.baselineCommit, '1fc9902');
assert.deepEqual(manifest.thresholds, v4ComparisonThresholds);
for (const entry of [
  ...manifest.fixtures.map((fixture) => fixture.source),
  ...manifest.legacyDefects.flatMap((defect) => [
    defect.source,
    defect.reproductionTest,
  ]),
]) {
  assert.equal(
    await sha256(entry.path),
    entry.sha256,
    `fixture reference changed: ${fileURLToPath(new URL(entry.path, root))}`,
  );
}

assertV4SnapshotsEqual(baseline, clone(baseline));
assert.throws(
  () => compareV4Snapshots({}, {}),
  /expected\.worldCubics must be an array/,
);
const incomplete = clone(baseline);
delete incomplete.outputs[0].mode;
assert.throws(
  () => compareV4Snapshots(incomplete, incomplete),
  /expected\.outputs\.body:face\.mode is required/,
);

const wrongTarget = clone(baseline);
wrongTarget.planar.find(
  (entry) => entry.id === 'body:face',
).geometry.coordinates[0][1] = [18, 0];
wrongTarget.planar.find((entry) => entry.id === 'body:face').areaMM2 = 316;
assert(
  mismatch(
    baseline,
    wrongTarget,
    'planar.body:face.geometry.areaDifferenceMM2',
  ),
  'a cut applied to body instead of detail must change the target planar result',
);

const lostLocalBottom = clone(baseline);
lostLocalBottom.outputs.find((entry) => entry.id === 'detail:face').zMM = 0;
assert(
  mismatch(baseline, lostLocalBottom, 'outputs.detail:face.zMM'),
  'a local bottom plane must not collapse to z=0',
);

const changedMode = clone(baseline);
changedMode.outputs.find((entry) => entry.id === 'detail:face').mode = 'cut';
assert(
  mismatch(baseline, changedMode, 'outputs.detail:face.mode'),
  'add, cut, and through modes must be migration-visible',
);

const lostHole = clone(baseline);
const face = lostHole.planar.find((entry) => entry.id === 'body:face');
face.holes = 0;
face.geometry.coordinates.pop();
face.areaMM2 = 400;
assert(
  mismatch(baseline, lostHole, 'planar.body:face.holes'),
  'a filled hole must be reported',
);

const blocked = clone(baseline);
blocked.outputs = [];
blocked.states.find((entry) => entry.id === 'detail:fill').state = 'blocked';
blocked.states.find((entry) => entry.id === 'detail:fill').reasonCode =
  'open-contour';
blocked.states.find((entry) => entry.id === 'detail:fill').outputIds = [];
const staleFallback = clone(blocked);
staleFallback.outputs = [
  clone(baseline.outputs.find((entry) => entry.id === 'detail:face')),
];
staleFallback.states.find((entry) => entry.id === 'detail:fill').state =
  'ready';
staleFallback.states.find((entry) => entry.id === 'detail:fill').reasonCode =
  null;
staleFallback.states.find((entry) => entry.id === 'detail:fill').outputIds = [
  'detail:face',
];
assert(
  mismatch(blocked, staleFallback, 'outputs.detail:face') &&
    mismatch(blocked, staleFallback, 'states.detail:fill.state'),
  'a blocked Fill must not fall back to a prior visible output',
);

const invalidSolid = clone(baseline);
invalidSolid.bodies.find((entry) => entry.id === 'main:ink').valid = false;
assert(
  mismatch(baseline, invalidSolid, 'bodies.main:ink.valid'),
  'solid validity is a migration contract',
);

const swappedMaterialVolumes = clone(baseline);
const cream = swappedMaterialVolumes.bodies.find(
  (entry) => entry.id === 'main:cream',
);
const ink = swappedMaterialVolumes.bodies.find(
  (entry) => entry.id === 'main:ink',
);
[cream.volumeMM3, ink.volumeMM3] = [ink.volumeMM3, cream.volumeMM3];
assert.equal(
  swappedMaterialVolumes.bodies.reduce(
    (total, body) => total + body.volumeMM3,
    0,
  ),
  baseline.bodies.reduce((total, body) => total + body.volumeMM3, 0),
  'the counterexample preserves total volume while exchanging two materials in one Part',
);
assert(
  mismatch(baseline, swappedMaterialVolumes, 'bodies.main:cream.volumeMM3') &&
    mismatch(baseline, swappedMaterialVolumes, 'bodies.main:ink.volumeMM3'),
  'per-material body volumes must not be masked by equal Part totals',
);

console.log(
  'PASS: V4 baseline comparator freezes geometry, output, failure, and solid contracts',
);
