// Repair the remaining straight crown closures in a workspace copy. No source
// curve, colour, height, role or unrelated recipe is changed. Dry-run by default.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { evaluateCreation } from '../lib/creation-engine.mjs';
import { creationCommand } from '../lib/creation-commands.mjs';
import { buildSolid } from '../lib/solid-engine.mjs';

const file = path.resolve(process.argv[2]);
const bytes = await fs.readFile(file);
const original = JSON.parse(bytes);
const before = evaluateCreation(original);
const crown = before.creation.objects.find((o) => o.name === '头饰');
assert(crown, 'Expected crown object');
assert.deepEqual(before.errors, []);
let repaired = original;
const changed = [];
for (const closure of new Map(
  before.closures
    .filter(
      (c) => c.objectId === crown.id && !c.disabled && !c.boundaryRegionId,
    )
    .map((c) => [c.regionId, c]),
).values()) {
  const nearby = closure.boundaryOptions.filter((b) => b.gapMM <= 0.15);
  assert.equal(
    nearby.length,
    1,
    `Ambiguous or distant contour for ${closure.regionId}`,
  );
  repaired = creationCommand(repaired, 'closure_boundary', {
    objectId: crown.id,
    featureId: closure.featureId,
    regionId: closure.regionId,
    boundaryRegionId: nearby[0].id,
    joinMM: 0.15,
  });
  changed.push({
    regionId: closure.regionId,
    featureId: closure.featureId,
    ...nearby[0],
  });
}
const after = evaluateCreation(repaired);
assert.deepEqual(after.errors, []);
assert.deepEqual(repaired.paths, original.paths);
assert.deepEqual(repaired.creation, original.creation);
assert.deepEqual(repaired.model.features, original.model.features);
const affected = new Set(changed.map((c) => c.featureId));
for (const cell of before.cells.filter((c) => !affected.has(c.featureId)))
  assert.deepEqual(
    after.cells.find((c) => c.key === cell.key),
    cell,
    cell.key,
  );
assert(
  after.closures
    .filter((c) => c.objectId === crown.id && !c.disabled)
    .every((c) => c.boundaryRegionId && c.coordinates.length >= 4),
);
const solid = await buildSolid(repaired);
assert(
  solid.report.valid &&
    solid.report.components === 1 &&
    solid.report.zeroArea === 0,
);
const output = JSON.stringify(repaired, null, 2) + '\n';
let backup;
if (process.argv.includes('--write') && changed.length) {
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const dir = path.join(path.dirname(file), 'backups');
  await fs.mkdir(dir, { recursive: true });
  backup = path.join(
    dir,
    `${path.basename(file)}.before-closure-repair-${stamp}.json`,
  );
  await fs.writeFile(backup, bytes, { flag: 'wx' });
  assert(
    (await fs.readFile(file)).equals(bytes),
    'Project changed during validation',
  );
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  await fs.writeFile(temp, output, { flag: 'wx' });
  assert(
    (await fs.readFile(file)).equals(bytes),
    'Project changed before replacement',
  );
  await fs.rename(temp, file);
  assert.deepEqual(JSON.parse(await fs.readFile(file)), repaired);
}
const outputIndex = process.argv.indexOf('--output');
if (outputIndex !== -1)
  await fs.writeFile(path.resolve(process.argv[outputIndex + 1]), output);
console.log(
  JSON.stringify(
    { file, written: !!backup, backup, changed, report: solid.report },
    null,
    2,
  ),
);
