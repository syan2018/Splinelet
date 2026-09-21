import assert from 'node:assert/strict';
import {
  makeOutputRef,
  proposeAssignmentInheritance,
  resolveRegionScope,
} from '../../../src/lib/construction/provenance.mjs';
const a = makeOutputRef('shape', 'operator', 'regions', 'a', ['edge-a']);
const b = makeOutputRef('shape', 'operator', 'regions', 'b', ['edge-b']);
const regions = [{ ref: a }, { ref: b }];
assert.equal(
  resolveRegionScope(regions, { kind: 'selected', refs: [] }).selected.length,
  0,
);
assert.deepEqual(
  resolveRegionScope(regions, { kind: 'selected', refs: [a] }).untouched,
  [regions[1]],
);
assert.equal(
  resolveRegionScope(regions, {
    kind: 'selected',
    refs: [{ ...a, key: 'deleted' }],
  }).status,
  'blocked',
);
const merged = {
  ref: makeOutputRef('shape', 'merge', 'regions', 'merged', [
    'edge-a',
    'edge-b',
  ]),
};
const assignments = [
  { id: 'red', target: a, value: { swatchId: 'red' } },
  { id: 'blue', target: b, value: { swatchId: 'blue' } },
];
const conflict = proposeAssignmentInheritance([merged], assignments);
assert.equal(conflict.conflicts.length, 1);
assert.equal(conflict.proposals.length, 0);
assert.equal(
  proposeAssignmentInheritance([], assignments).unresolved.length,
  2,
);
const children = ['left', 'right'].map((key) => ({
  ref: makeOutputRef('shape', 'split', 'regions', key, ['edge-a', key]),
}));
assert.equal(
  proposeAssignmentInheritance(children, assignments.slice(0, 1)).proposals
    .length,
  2,
);
assert.deepEqual(assignments[0].target, a);
console.log(
  'PASS: V4 selected scope never falls back to all; split inheritance and merge conflicts remain explicit',
);
