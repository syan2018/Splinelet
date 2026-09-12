import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { evaluateCreation } from '../lib/creation-engine.mjs';
import { creationCommand } from '../lib/creation-commands.mjs';
import { buildSolid } from '../lib/solid-engine.mjs';

// The original bytes are backed up, and a concurrent edit aborts replacement.
const file = path.resolve(
  process.argv[2] ||
    '../../outputs/Sandrone-unified-creation/Sandrone-new.bezier.json',
);
const write = process.argv.includes('--write');
const original = fs.readFileSync(file),
  project = JSON.parse(original),
  scene = evaluateCreation(project);
assert.deepEqual(scene.errors, []);
const crown = scene.creation.objects.find((o) => o.name === '头饰');
const hole = crown?.modifiers.find(
  (m) => m.rolePathId === 'be92b11d-9617-4008-b6c1-be9f1d842c45',
);
assert(hole, 'expected crown diamond source');
const next = creationCommand(
  project,
  'modifier_update',
  {
    objectId: crown.id,
    modifierId: hole.id,
    changes: {
      name: '菱形凹槽',
      targets: {
        kind: 'selected',
        refs: [{ key: 'feature:body-band-64', name: '头饰嵌线 65' }],
      },
    },
  },
  scene,
);
const evaluated = evaluateCreation(next);
assert.deepEqual(evaluated.errors, []);
assert.equal(evaluated.cells.find((c) => c.featureId === 'body-8').holes, 0);
assert.equal(
  evaluated.cells.find((c) => c.featureId === 'body-band-64').holes,
  1,
);
assert.deepEqual(next.paths, project.paths);
assert.deepEqual(next.model, project.model);
const solid = await buildSolid(next);
assert(solid.report.valid && solid.report.components === 1);
const out = path.resolve('../../outputs/modifier-stack');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(
  path.join(out, 'Sandrone-new.scoped.bezier.json'),
  JSON.stringify(next, null, 2),
);
let backup;
if (write) {
  assert(
    fs.readFileSync(file).equals(original),
    'project changed during verification; retry on the latest file',
  );
  backup = path.join(
    out,
    'Sandrone-new.before-modifiers.' +
      new Date().toISOString().replace(/[:.]/g, '-') +
      '.bezier.json',
  );
  fs.writeFileSync(backup, original, { flag: 'wx' });
  const temporary = file + '.modifier-tmp';
  fs.writeFileSync(temporary, JSON.stringify(next, null, 2), { flag: 'wx' });
  assert(
    fs.readFileSync(file).equals(original),
    'project changed before replacement',
  );
  fs.renameSync(temporary, file);
}
const report = {
  file,
  written: write,
  backup,
  paths: next.paths.length,
  curves: next.paths.reduce((n, p) => n + p.curves.length, 0),
  scope: 'feature:body-band-64',
  mesh: solid.report,
};
fs.writeFileSync(
  path.join(out, 'repair-report.json'),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
