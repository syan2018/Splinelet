import assert from 'node:assert/strict';
import { remapCanonicalRegionOutputReference } from '../../../src/lib/construction/operators/regions/partition-identity.mjs';

const text = JSON.stringify;
const ids = {
  owner: 'copy-owner',
  reference: 'copy-reference',
  partition: 'copy-partition',
  sketch: 'copy-sketch',
  edge: 'copy-edge',
};
const token = text(['sketch', 'edge', []]);
const copiedToken = text(['copy-sketch', 'copy-edge', []]);
const instances = [{ operatorId: 'reference', index: 0 }];
const key = text(['region-reference', text(['fill', [token]]), instances]);
const expectedKey = text([
  'region-reference',
  text(['fill', [copiedToken]]),
  [{ operatorId: 'copy-reference', index: 0 }],
]);
const reference = {
  kind: 'output',
  ownerNodeId: 'owner',
  operatorId: 'reference',
  port: 'regions',
  key,
  lineage: [token],
  instances,
};
const copied = remapCanonicalRegionOutputReference(reference, ids);
assert.equal(copied.key, expectedKey);
assert.deepEqual(copied.lineage, [copiedToken]);
assert.deepEqual(copied.instances, [
  { operatorId: 'copy-reference', index: 0 },
]);
assert.equal(reference.key, key);

const topology = text([text([`base:${key}+`]), []]);
const copiedTopology = text([text([`base:${expectedKey}+`]), []]);
const partitionRef = {
  ...reference,
  operatorId: 'partition',
  key: text(['partition', key, topology]),
  lineage: [token, topology].sort(),
};
const copiedPartition = remapCanonicalRegionOutputReference(partitionRef, ids);
assert.equal(
  copiedPartition.key,
  text(['partition', expectedKey, copiedTopology]),
);
assert.deepEqual(copiedPartition.lineage, [copiedToken, copiedTopology].sort());
assert.equal(copiedPartition.operatorId, 'copy-partition');
assert.equal(copiedPartition.ownerNodeId, 'copy-owner');
assert.throws(
  () =>
    remapCanonicalRegionOutputReference(
      { ...reference, key: text(['unknown', key]) },
      ids,
    ),
  /unsupported/,
);
console.log(
  'PASS copying region-reference bases remaps nested partition identity, instances and lineage consistently',
);
