import fs from 'node:fs';
import assert from 'node:assert/strict';
import { creationCommand } from '../../../lib/creation-commands.mjs';
import {
  creationDocument,
  validateCreation,
} from '../../../lib/creation-schema.mjs';
import { evaluateCreation } from '../../../lib/creation-engine.mjs';
import { swatchOwners } from '../../../lib/creation-colors.mjs';

const source = JSON.parse(
  fs.readFileSync(new URL('../fixtures/shoulder-region.json', import.meta.url)),
);
const p = creationCommand(source, 'swatch', {
  name: '可删除色',
  color: '#778899',
});
const unusedId = p.creation.swatches.at(-1).id;
assert.equal(swatchOwners(p.creation, unusedId).length, 0);
const removedUnused = creationCommand(p, 'delete_swatch', { id: unusedId });
assert(!removedUnused.creation.swatches.some((s) => s.id === unusedId));
assert.deepEqual(
  evaluateCreation(removedUnused).cells,
  evaluateCreation(p).cells,
);

const scene = evaluateCreation(p),
  id = 'legacy-e8d8bc',
  replacementId = 'red';
assert(swatchOwners(p.creation, id).length);
assert.throws(() => creationCommand(p, 'delete_swatch', { id }), /替换/);
assert.throws(
  () => creationCommand(p, 'delete_swatch', { id, replacementId: id }),
  /替换/,
);
const candidate = scene.cells.find((c) => c.name === '右肩内');
const painted = creationCommand(
  p,
  'paint',
  { cellKeys: [candidate.key], swatchId: id },
  scene,
);
const before = structuredClone(painted);
const deleted = creationCommand(painted, 'delete_swatch', {
  id,
  replacementId,
});
assert.deepEqual(painted, before);
assert.equal(swatchOwners(deleted.creation, id).length, 0);
assert(!deleted.creation.swatches.some((s) => s.id === id));
assert.deepEqual(deleted.paths, before.paths);
const afterScene = evaluateCreation(deleted),
  beforeScene = evaluateCreation(before);
assert.equal(afterScene.errors.length, 0);
for (const cell of beforeScene.cells) {
  const actual = afterScene.cells.find((c) => c.key === cell.key);
  assert.deepEqual(actual.geometry, cell.geometry);
  assert.equal(actual.heightMM, cell.heightMM);
  assert.equal(actual.bottomMM, cell.bottomMM);
  assert.equal(actual.zMM, cell.zMM);
  assert.equal(
    actual.swatchId,
    cell.swatchId === id ? replacementId : cell.swatchId,
  );
}
assert.deepEqual(
  evaluateCreation(JSON.parse(JSON.stringify(deleted))).cells,
  afterScene.cells,
);
const noCream = creationCommand(deleted, 'delete_swatch', {
  id: 'cream',
  replacementId: 'red',
});
noCream.paths.push({
  ...structuredClone(noCream.paths[0]),
  id: 'new-after-deletion',
  groupId: undefined,
});
validateCreation(creationDocument(noCream));
const last = {
  ...p,
  creation: {
    version: 1,
    objects: [],
    swatches: [{ id: 'only', name: '唯一色', color: '#123456' }],
  },
  paths: [],
  model: {
    version: 1,
    regions: [],
    features: [],
    parts: [{ id: 'main', name: 'main' }],
    toleranceMM: 0.02,
  },
};
assert.throws(
  () => creationCommand(last, 'delete_swatch', { id: 'only' }),
  /至少保留/,
);
console.log(
  'PASS: unused removal, referenced replacement across legacy and painted faces, geometry/height isolation, reload, deleting default colour before new paths, last-colour guard',
);
