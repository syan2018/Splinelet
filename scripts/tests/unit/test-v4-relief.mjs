import assert from 'node:assert/strict';
import {
  createDocument,
  validateDocument,
} from '../../../src/lib/document/schema.mjs';
import { firstPaintPlan } from '../../../src/lib/relief/assignments.mjs';
import { resolveRelief } from '../../../src/lib/relief/resolve.mjs';

const output = (ownerNodeId, key, lineage, instances = []) => ({
  kind: 'output',
  ownerNodeId,
  operatorId: `${ownerNodeId}-fill`,
  port: 'regions',
  key,
  instances,
  lineage,
});
const polygon = (x) => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, 0],
      [x + 1, 0],
      [x + 1, 1],
      [x, 1],
      [x, 0],
    ],
  ],
});

function fixture() {
  let sequence = 0;
  const document = createDocument({
    version: 4,
    idFactory: () => `generated-${++sequence}`,
  });
  for (const [id, order, visible, locked] of [
    ['shape-a', 0, true, false],
    ['shape-b', 1, false, true],
  ]) {
    document.nodes[id] = {
      id,
      kind: 'shape',
      name: id,
      parentId: null,
      order,
      pose: { translationMM: [0, 0], rotationRad: 0 },
      visible,
      locked,
      programId: `${id}-program`,
    };
    document.programs[`${id}-program`] = {
      id: `${id}-program`,
      ownerNodeId: id,
      operators: {},
      outputs: {},
    };
  }
  document.appearances.swatches = {
    red: { id: 'red', name: 'Red', color: '#ff0000' },
    blue: { id: 'blue', name: 'Blue', color: '#0000ff' },
    green: { id: 'green', name: 'Green', color: '#00ff00' },
  };
  document.appearances.defaults = {
    'shape-a': { swatchId: 'red' },
    'shape-b': { swatchId: 'blue' },
  };
  const a = output('shape-a', 'region-a', ['source-a']);
  const b = output(
    'shape-b',
    'region-b',
    ['source-b'],
    [{ kind: 'array', index: 2 }],
  );
  document.appearances.overrides.paintA = {
    id: 'paintA',
    target: a,
    value: { swatchId: 'green' },
  };
  document.reliefDefinitions.defaults = {
    'shape-a': {
      enabled: false,
      thickness: { kind: 'mm', value: 1 },
      mode: 'add',
      placement: { kind: 'free', zMM: 0 },
    },
    'shape-b': {
      enabled: true,
      thickness: { kind: 'layers', count: 3 },
      mode: 'cut',
      placement: { kind: 'layer', layerId: 'generated-1', offsetMM: 0.2 },
    },
  };
  document.reliefDefinitions.overrides.reliefA = {
    id: 'reliefA',
    target: a,
    value: {
      enabled: true,
      thickness: { kind: 'mm', value: 2.5 },
      placement: { kind: 'free', zMM: 4 },
    },
  };
  validateDocument(document);
  return { document, a, b };
}

const { document, a, b } = fixture();
const regions = {
  domain: 'regions',
  status: 'ready',
  value: {
    frame: { kind: 'local', ownerNodeId: 'shape-a' },
    regions: [
      { ref: a, geometry: polygon(0) },
      { ref: b, geometry: polygon(2) },
    ],
    provenance: [],
  },
  diagnostics: [],
  dependencies: ['operator:shape-a-fill:regions'],
};
const before = structuredClone(document);
const resolved = resolveRelief(document, regions);
assert.equal(resolved.domain, 'relief');
assert.equal(resolved.status, 'ready', JSON.stringify(resolved.diagnostics));
assert.equal(resolved.value.reliefs.length, 2);
const aRelief = resolved.value.reliefs.find(
  (item) => item.ref.key === 'region-a',
);
const bRelief = resolved.value.reliefs.find(
  (item) => item.ref.key === 'region-b',
);
assert.deepEqual(aRelief.ref, a, 'all OutputRef identity fields survive');
assert.deepEqual(bRelief.ref, b, 'instances and lineage remain distinct');
assert.deepEqual(aRelief.thickness, { kind: 'mm', value: 2.5 });
assert.equal(aRelief.color, '#00ff00');
assert.deepEqual(aRelief.placement, { kind: 'free', zMM: 4 });
assert.deepEqual(bRelief.thickness, { kind: 'layers', count: 3 });
assert.equal('effectiveHeightMM' in bRelief, false);
assert.equal(bRelief.color, '#0000ff');
assert.equal(bRelief.mode, 'cut');
assert.deepEqual(document, before, 'relief resolution is read-only');
assert.equal(
  bRelief.enabled,
  true,
  'scene visible/locked state does not decide manufacturing participation',
);

const unpainted = structuredClone(document);
unpainted.reliefDefinitions.defaults['shape-a'].enabled = false;
delete unpainted.reliefDefinitions.overrides.reliefA;
unpainted.reliefDefinitions.defaults['shape-b'].enabled = false;
assert.equal(resolveRelief(unpainted, regions).status, 'empty');
assert.deepEqual(firstPaintPlan({ target: a, swatchId: 'red' }).relief.value, {
  enabled: true,
  thickness: { kind: 'mm', value: 1 },
  mode: 'add',
  placement: { kind: 'free', zMM: 0 },
});

const staleLineage = structuredClone(document);
staleLineage.reliefDefinitions.overrides.stale = {
  id: 'stale',
  target: { ...a, lineage: ['other-source'] },
  value: { enabled: false },
};
const staleResult = resolveRelief(staleLineage, regions);
assert.equal(staleResult.status, 'blocked');
assert.equal(staleResult.diagnostics.at(-1).kind, 'unresolved-reference');
assert.equal(
  staleResult.diagnostics.at(-1).ref.lineage[0],
  'other-source',
  'a stale assignment never degrades to all outputs or a same-key sibling',
);

const duplicate = structuredClone(document);
duplicate.appearances.overrides.paintA2 = {
  id: 'paintA2',
  target: structuredClone(a),
  value: { swatchId: 'red' },
};
assert.equal(resolveRelief(duplicate, regions).status, 'blocked');

const noBlue = structuredClone(document);
delete noBlue.appearances.swatches.blue;
assert.equal(
  resolveRelief(noBlue, regions).status,
  'blocked',
  'a deleted swatch blocks its valid enabled assignment rather than changing color',
);
assert.equal(
  resolveRelief(document, {
    ...regions,
    status: 'empty',
    value: { ...regions.value, regions: [] },
  }).status,
  'blocked',
);
assert.equal(
  resolveRelief(document, { ...regions, status: 'absent', value: undefined })
    .status,
  'blocked',
);
assert.equal(
  resolveRelief(document, {
    ...regions,
    status: 'blocked',
    value: undefined,
    diagnostics: [{ code: 'fill-blocked', message: 'open' }],
  }).status,
  'blocked',
);

console.log(
  'PASS: V4 Relief resolves exact per-output appearance and intent without placement solving or document writes.',
);
