import assert from 'node:assert/strict';
import { sceneGroupSelection } from '../../../src/lib/editor/scene-group-selection.mjs';

const rows = [
  { id: 'outer', kind: 'group', ancestors: [] },
  { id: 'inner', kind: 'group', ancestors: ['outer'] },
  { id: 'a', kind: 'shape', ancestors: ['outer', 'inner'] },
  { id: 'b', kind: 'shape', ancestors: [] },
  { id: 'other', kind: 'group', ancestors: [] },
];

let selection = sceneGroupSelection(rows, ['outer', 'other']);
assert.deepEqual(
  selection.groups.map((row) => row.id),
  ['outer', 'other'],
);
assert.deepEqual(
  selection.rootGroups.map((row) => row.id),
  ['outer', 'other'],
);
assert.equal(selection.singleGroup, null);

selection = sceneGroupSelection(rows, ['outer', 'a']);
assert.deepEqual(
  selection.groups.map((row) => row.id),
  ['outer'],
);
assert.deepEqual(
  selection.shapes.map((row) => row.id),
  ['a'],
);
assert.equal(selection.singleGroup, null);

selection = sceneGroupSelection(rows, ['outer', 'inner']);
assert.deepEqual(
  selection.groups.map((row) => row.id),
  ['outer', 'inner'],
);
assert.deepEqual(
  selection.rootGroups.map((row) => row.id),
  ['outer'],
);

selection = sceneGroupSelection(rows, ['inner']);
assert.equal(selection.singleGroup?.id, 'inner');
assert.deepEqual(selection.shapes, []);

console.log(
  'PASS scene group selection preserves mixed counts and deduplicates nested group actions at selected roots',
);
