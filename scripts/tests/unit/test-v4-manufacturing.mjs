import assert from 'node:assert/strict';
import { resolveManufacturing } from '../../../src/lib/manufacturing/placement.mjs';

const ref = (key, ownerNodeId = 'a') => ({
  kind: 'output',
  ownerNodeId,
  operatorId: `${ownerNodeId}-fill`,
  port: 'regions',
  key,
  instances: [],
  lineage: [key],
});
const relief = (
  key,
  placement,
  thickness = { kind: 'mm', value: 1 },
  owner = 'a',
  mode = 'add',
) => ({
  ref: ref(key, owner),
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
  },
  enabled: true,
  thickness,
  mode,
  placement,
});
const document = {
  manufacturing: {
    layerHeightMM: 0.2,
    layerOrder: ['low', 'high'],
    layers: { low: {}, high: {} },
    parts: { p: {} },
    defaultPartId: 'p',
    assignments: {},
    excluded: [],
  },
};
const input = {
  domain: 'relief',
  status: 'ready',
  diagnostics: [],
  dependencies: [],
  value: {
    reliefs: [
      relief(
        'low',
        { kind: 'layer', layerId: 'low', offsetMM: 0 },
        { kind: 'layers', count: 3 },
      ),
      relief(
        'high',
        { kind: 'layer', layerId: 'high', offsetMM: 0 },
        { kind: 'mm', value: 2 },
      ),
      relief('free', { kind: 'free', zMM: 9 }, { kind: 'mm', value: 1 }, 'b'),
      relief('attached', {
        kind: 'attached',
        target: { kind: 'node', id: 'a' },
        offsetMM: 0.5,
      }),
    ],
  },
};
const placed = resolveManufacturing(document, input, { a: [1, 0, 0, 1, 4, 5] });
assert.equal(placed.status, 'ready');
const byKey = Object.fromEntries(
  placed.value.reliefs.map((item) => [item.ref.key, item]),
);
assert.equal(byKey.low.mm, 0.6000000000000001);
assert.equal(byKey.high.zBase, 0.6000000000000001);
assert.equal(
  byKey.attached.zBase,
  3.1,
  'Shape attachment uses highest valid add top, not first',
);
assert.equal(byKey.free.zBase, 9, 'free placement ignores layer order');
assert.deepEqual(byKey.low.geometry.coordinates[0][0], [4, 5]);
const excluded = structuredClone(document);
excluded.manufacturing.excluded = [{ kind: 'output', ...ref('high') }];
const ignored = structuredClone(input);
ignored.value.reliefs.push(
  relief(
    'cut',
    { kind: 'free', zMM: 99 },
    { kind: 'mm', value: 1 },
    'a',
    'cut',
  ),
);
const ignoredPlaced = resolveManufacturing(excluded, ignored);
assert.equal(ignoredPlaced.status, 'ready');
assert.equal(
  ignoredPlaced.value.reliefs.find((item) => item.ref.key === 'attached').zBase,
  1.1,
  'excluded and cut members never become Shape attachment supports',
);
const cross = structuredClone(document);
cross.manufacturing.parts.q = {};
cross.manufacturing.assignments.x = {
  target: { kind: 'node', id: 'a' },
  partId: 'q',
};
cross.manufacturing.assignments.y = {
  target: { kind: 'output', ...ref('attached') },
  partId: 'p',
};
assert.equal(resolveManufacturing(cross, input).status, 'blocked');
assert.equal(
  resolveManufacturing(document, { ...input, status: 'empty' }).status,
  'empty',
);
assert.equal(
  resolveManufacturing(document, { ...input, status: 'blocked' }).status,
  'blocked',
);
console.log(
  'PASS: V4 manufacturing preserves thickness authority, layer/attachment placement, Parts and exclusions.',
);
