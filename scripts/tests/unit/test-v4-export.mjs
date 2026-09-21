import assert from 'node:assert/strict';
import { exportSnapshot } from '../../../src/lib/export/snapshot.mjs';
import { buildBodies } from '../../../src/lib/solid/bodies.mjs';

const ref = {
  kind: 'output',
  ownerNodeId: 'shape',
  operatorId: 'fill',
  port: 'regions',
  key: 'area',
  lineage: ['area'],
  instances: [],
};
const geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ],
  ],
};
const placed = await buildBodies({
  domain: 'placed-relief',
  status: 'ready',
  diagnostics: [],
  dependencies: [],
  value: {
    reliefs: [
      {
        ref,
        geometry,
        color: '#ff0000',
        swatchId: 'red',
        enabled: true,
        mode: 'add',
        partId: 'main',
        mm: 1,
        layers: null,
        zBase: 0,
        zTop: 1,
      },
    ],
    provenance: [],
  },
});
assert.equal(placed.status, 'ready');
const snapshot = {
  epoch: 'export-open',
  revision: 3,
  previewId: null,
  snapshot: {
    curves: {
      status: 'ready',
      value: {
        frame: { kind: 'local', ownerNodeId: 'shape' },
        curves: [
          {
            key: 'source-cubic',
            closed: false,
            edges: [
              {
                cubic: [
                  [0, 0],
                  [1, 2],
                  [2, 2],
                  [3, 0],
                ],
              },
            ],
          },
        ],
        junctions: [],
        provenance: [],
      },
    },
    regions: {
      status: 'ready',
      value: {
        frame: { kind: 'local', ownerNodeId: 'shape' },
        regions: [{ ref, geometry }],
        provenance: [],
      },
    },
    bodies: placed,
  },
};
const source = await exportSnapshot(snapshot, {
  format: 'svg-source',
  stage: 'curves',
});
assert.match(source.data, /C 1 2 2 2 3 0/);
assert.match(source.data, /source-cubic/);
const colored = await exportSnapshot(snapshot, {
  format: 'svg-colored',
  stage: 'regions',
  colors: { area: '#ff0000' },
});
assert.match(colored.data, /fill="#ff0000"/);
const stl = await exportSnapshot(snapshot, { format: 'stl', stage: 'bodies' });
assert.equal(stl.mimeType, 'model/stl');
assert(stl.data.byteLength > 84);
const generic = await exportSnapshot(snapshot, {
  format: '3mf',
  stage: 'bodies',
});
assert.equal(generic.mimeType, 'model/3mf');
assert(generic.data.byteLength > 100);
const blenderSource = await exportSnapshot(snapshot, {
  format: 'blender-source',
  stage: 'curves',
});
assert.deepEqual(blenderSource.data.curves[0].edges[0].cubic[1], [1, 2]);
await assert.rejects(
  exportSnapshot(
    { ...snapshot, previewId: 'draft' },
    { format: 'svg-source', stage: 'curves' },
  ),
  /已提交/,
);
await assert.rejects(
  exportSnapshot(snapshot, { format: 'svg-source', stage: 'regions' }),
  /curves stage/,
);
await assert.rejects(
  exportSnapshot(snapshot, { format: '3mf-bambu', stage: 'bodies' }),
  /Bambu/,
);
const derived = structuredClone(snapshot);
derived.snapshot.curves.value.curves[0].edges[0].instances = [
  { operatorId: 'array', index: 1 },
];
await assert.rejects(
  exportSnapshot(derived, { format: 'svg-source', stage: 'curves' }),
  /Source cubic/,
);
console.log(
  'PASS: V4 exports consume only explicit committed CurveSet, RegionSet, or BodySet stages.',
);
