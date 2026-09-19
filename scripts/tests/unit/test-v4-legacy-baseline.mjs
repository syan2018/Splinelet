import assert from 'node:assert/strict';
import { moveCreationPaths } from '../../../src/lib/creation-path-transfer.mjs';
import {
  movePaths,
  translatePaths,
} from '../../../src/lib/source-editor/selection.mjs';
import {
  legacyF01Fixture,
  legacyF02Fixture,
} from '../fixtures/v4-baseline/legacy-defects.mjs';

const f01 = legacyF01Fixture();
const beforeMoveModifier = f01.creation.objects[0].modifiers[0];
translatePaths(f01, ['array-source'], 10, 5);
assert.deepEqual(f01.paths[0].start, { x: 20, y: 15 });
const modifier = f01.creation.objects[0].modifiers[0];
assert.notEqual(
  modifier,
  beforeMoveModifier,
  'F01 baseline reads the modifier from the creation clone returned by legacy translation',
);
assert.deepEqual(
  modifier.centerMM,
  { x: 25, y: 35 },
  'F01 baseline: legacy translation leaves the array center at its old world position',
);
assert.notDeepEqual(
  modifier.centerMM,
  { x: 35, y: 30 },
  'F01 baseline: moving a 100 mm-wide object by (+10, +5) pixels should have moved its center by (+10, -5) mm',
);

const f02 = legacyF02Fixture();
movePaths(f02, ['shared-source'], 'right');
assert.equal(f02.paths[0].groupId, 'right');
assert.deepEqual(
  f02.creation.objects.map((object) => [object.id, object.pathIds]),
  [
    ['left-object', ['shared-source']],
    ['right-object', []],
  ],
  'F02 baseline: source group movement leaves creation ownership unchanged',
);

const creationMove = legacyF02Fixture();
moveCreationPaths(creationMove, creationMove.creation, {
  objectId: 'right-object',
  pathIds: ['shared-source'],
});
assert.deepEqual(
  creationMove.creation.objects.map((object) => [object.id, object.pathIds]),
  [['right-object', ['shared-source']]],
  'F02 baseline: creation move changes construction ownership and removes the empty old owner',
);

console.log(
  'PASS: F01/F02 legacy baselines observe the documented divergent mutations',
);
