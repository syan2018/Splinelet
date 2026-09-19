import fs from 'node:fs';
import assert from 'node:assert/strict';
import { evaluateCreation } from '../../../lib/creation-engine.mjs';
import { creationCommand } from '../../../lib/creation-commands.mjs';
import {
  creationEditTargets,
  regionsForPaths,
  pathsForRegions,
} from '../../../lib/creation-selection.mjs';

const project = JSON.parse(
  fs.readFileSync(new URL('../fixtures/shoulder-region.json', import.meta.url)),
);
const scene = evaluateCreation(project);
const path = project.paths.find((p) => p.name === '右肩内');
const object = scene.creation.objects.find((o) => o.name === '胸前');
const cells = scene.cells.filter((c) => c.objectId === object.id);
const target = cells.at(-1);
const visibleCell = (cell) => ({
  key: cell.key,
  geometry: cell.geometry,
  color: cell.color,
  swatchId: cell.swatchId,
  heightMM: cell.heightMM,
  bottomMM: cell.bottomMM ?? cell.zMM,
});
assert.equal(cells.length, 8);
assert.equal(target.name, '右肩内');
assert.equal(target.painted, false);
assert.equal(
  target.zMM,
  2,
  'a new region shares the existing chest support plane',
);
assert(Math.abs(target.areaMM2 - 3.888749447555) < 1e-9);
assert.deepEqual(
  regionsForPaths(project, scene, [path.id]).map((c) => c.key),
  [target.key],
);
assert.deepEqual(pathsForRegions(project, scene, [target.key]), [path.id]);
assert.throws(
  () => creationEditTargets({ kind: 'path', ids: [path.id] }),
  /线条/,
);
assert.deepEqual(creationEditTargets({ kind: 'cell', ids: [target.key] }), {
  cellKeys: [target.key],
});
const pristine = structuredClone(project);
let edited = project;
for (const [action, args] of [
  ['height', { heightMM: target.heightMM }],
  ['height', { heightMM: 3.25 }],
  ['paint', { color: '#e46e7f' }],
  ['height', { heightMM: 2.6 }],
  ['paint', { swatchId: 'ink' }],
]) {
  const prior = evaluateCreation(edited);
  edited = creationCommand(
    edited,
    action,
    { cellKeys: [target.key], ...args },
    prior,
  );
  const next = evaluateCreation(edited);
  assert.equal(next.errors.length, 0);
  assert.equal(next.cells.length, scene.cells.length);
  assert.deepEqual(
    next.cells.filter((c) => c.key !== target.key).map(visibleCell),
    scene.cells.filter((c) => c.key !== target.key).map(visibleCell),
  );
  assert.deepEqual(
    next.cells.map((c) => [c.key, c.geometry]),
    scene.cells.map((c) => [c.key, c.geometry]),
  );
  const actual = next.cells.find((c) => c.key === target.key);
  assert.equal(actual.painted, true);
  if (action === 'height') assert.equal(actual.heightMM, args.heightMM);
  if (action === 'paint')
    assert.equal(
      actual.swatchId,
      args.swatchId ||
        edited.creation.swatches.find((s) => s.color === args.color).id,
    );
  assert.deepEqual(edited.model, pristine.model);
  assert.deepEqual(edited.paths, pristine.paths);
  assert.deepEqual(
    evaluateCreation(JSON.parse(JSON.stringify(edited))).cells,
    next.cells,
  );
}
assert.deepEqual(project, pristine);
console.log(
  'PASS: explicit edit targets, exact boundary-region mapping, local height/paint preserves every sibling and recipe, stable keys and reload',
);
