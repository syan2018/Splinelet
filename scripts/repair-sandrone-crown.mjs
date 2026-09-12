// Explicit repair for the saved Sandrone project; dry-run unless --write is supplied.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { validateModel } from '../lib/model-schema.mjs';
import { validateCreation } from '../lib/creation-schema.mjs';
import { evaluateCreation } from '../lib/creation-engine.mjs';
import { buildSolid } from '../lib/solid-engine.mjs';

const file = path.resolve(process.argv[2]);
const bytes = await fs.readFile(file);
const original = JSON.parse(bytes);
const repaired = structuredClone(original);
const band = repaired.model.regions.find((r) => r.id === 'band-64');
const head = repaired.creation.objects.find((o) =>
  o.featureIds.includes('body-band-64'),
);
assert(band?.kind === 'between' && head, 'Expected central crown construction');
band.boundaryRegionId = 'source-8';
band.boundaryJoinMM = 0.1;
if (head.disabledClosureFeatureIds) {
  head.disabledClosureFeatureIds = head.disabledClosureFeatureIds.filter(
    (id) => id !== 'body-band-64',
  );
  if (!head.disabledClosureFeatureIds.length)
    delete head.disabledClosureFeatureIds;
}
validateModel(repaired.model);
validateCreation(repaired.creation);
assert.deepEqual(repaired.paths, original.paths);
assert.deepEqual(repaired.model.features, original.model.features);
const before = evaluateCreation(original),
  scene = evaluateCreation(repaired);
assert.deepEqual(scene.errors, []);
assert.equal(
  scene.cells.filter(
    (c) =>
      c.objectId === scene.creation.objects.find((o) => o.name === '杯子').id,
  ).length,
  7,
);
const crown = scene.cells.find((c) => c.featureId === 'body-band-64');
assert(crown?.areaMM2 > 30 && crown.areaMM2 < 31);
assert.equal(crown.holes, 1);
assert.equal(crown.components, 1);
for (const cell of before.cells.filter((c) => c.featureId !== 'body-band-64'))
  assert.deepEqual(
    scene.cells.find((c) => c.key === cell.key),
    cell,
    `Unrelated region ${cell.key}`,
  );
const solid = await buildSolid(repaired);
assert(
  solid.report.valid &&
    solid.report.components === 1 &&
    solid.report.zeroArea === 0,
);
let backup;
if (
  process.argv.includes('--write') &&
  JSON.stringify(original) !== JSON.stringify(repaired)
) {
  const stamp = new Date().toISOString().replaceAll(':', '-').replace('.', '-');
  const backupDir = path.join(path.dirname(file), 'backups');
  await fs.mkdir(backupDir, { recursive: true });
  backup = path.join(
    backupDir,
    `${path.basename(file, '.bezier.json')}.before-crown-repair-${stamp}.bezier.json`,
  );
  await fs.writeFile(backup, bytes, { flag: 'wx' });
  assert(
    (await fs.readFile(file)).equals(bytes),
    'Project changed during validation; original not overwritten',
  );
  const temporary = file + '.repair-' + crypto.randomUUID() + '.tmp';
  const output = JSON.stringify(repaired, null, 2) + '\n';
  await fs.writeFile(temporary, output, { flag: 'wx' });
  assert(
    (await fs.readFile(file)).equals(bytes),
    'Project changed during staging; original not overwritten',
  );
  await fs.rename(temporary, file);
  assert.deepEqual(JSON.parse(await fs.readFile(file)), repaired);
}
console.log(
  JSON.stringify(
    {
      file,
      written: !!backup,
      backup,
      sha256: crypto
        .createHash('sha256')
        .update(await fs.readFile(file))
        .digest('hex'),
      crown: { areaMM2: crown.areaMM2, holes: crown.holes, color: crown.color },
      sourcePaths: repaired.paths.length,
      sourceCubics: repaired.paths.reduce((sum, p) => sum + p.curves.length, 0),
      report: solid.report,
    },
    null,
    2,
  ),
);
