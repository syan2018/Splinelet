import assert from 'node:assert/strict';
import {
  copyCurveOperator,
  curveCollectOperator,
  curveArrayOperator,
  curveMirrorOperator,
  curveOperatorSpecifications,
  curveReferenceOperator,
  curveTransformOperator,
  joinOperator,
  resolveSourceSketch,
  sourceOperator,
} from '../../../src/lib/construction/operators/curves/index.mjs';
import { evaluateConstruction } from '../../../src/lib/construction/evaluate.mjs';
import { createOperatorRegistry } from '../../../src/lib/construction/registry.mjs';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { fillCurves } from '../../../src/lib/construction/operators/regions/fill.mjs';
import {
  multiplyTransforms,
  transformPoint,
} from '../../../src/lib/scene/transforms.mjs';

const document = { geometrySettings: { joinToleranceMM: 0.001 } };
const baseValue = {
  frame: { kind: 'local', ownerNodeId: 'shape-a' },
  curves: [
    {
      key: 'path-a',
      pathRef: { kind: 'path', sketchId: 'sketch-a', id: 'path-a' },
      closed: false,
      edges: [
        {
          key: 'path-a:0:e',
          cubic: [
            [1, 0],
            [0.8, 0.2],
            [0.2, 0.8],
            [0, 1],
          ],
          startKey: 'v0',
          endKey: 'v1',
          source: { kind: 'edge', sketchId: 'sketch-a', id: 'e' },
          instances: [],
          transform: [1, 0, 0, 1, 0, 0],
        },
      ],
    },
  ],
  junctions: [],
  provenance: [],
};
const ready = (value = baseValue) => ({
  domain: 'curves',
  status: 'ready',
  value: structuredClone(value),
  diagnostics: [],
  dependencies: ['sketch-a'],
});
const run = (spec, operator, input = ready(), context = {}) =>
  spec.evaluate({
    document,
    ownerNodeId: 'shape-b',
    operator,
    inputs: { input: [input] },
    context,
  }).curves;

assert.deepEqual(
  curveOperatorSpecifications.map((spec) => spec.type),
  [
    'source',
    'curve-filter',
    'curve-collect',
    'curve-reference',
    'curve-transform',
    'curve-mirror',
    'curve-array',
    'join',
  ],
);

const selected = resolveSourceSketch({
  document,
  ownerNodeId: 'shape-a',
  input: { kind: 'sketch', sketchId: 'sketch-a', pathIds: ['good'] },
  resolveSketch: ({ pathIds }) => {
    assert.deepEqual(pathIds, ['good']);
    return {
      domain: 'curves',
      status: 'ready',
      value: {
        ...baseValue,
        curves: [
          {
            ...baseValue.curves[0],
            pathRef: { ...baseValue.curves[0].pathRef, id: 'good' },
          },
        ],
      },
      diagnostics: [],
      dependencies: ['good'],
    };
  },
});
assert.equal(selected.status, 'ready');
assert.equal(selected.value.curves[0].pathRef.id, 'good');
const source = sourceOperator.evaluate({
  operator: { id: 'source' },
  ownerNodeId: 'shape-a',
  inputs: { paths: [selected] },
}).curves;
assert.equal(source.status, 'ready');
assert.equal(source.value.frame.ownerNodeId, 'shape-a');

const referenced = run(curveReferenceOperator, { id: 'reference', params: {} });
assert.equal(referenced.value.frame.ownerNodeId, 'shape-b');
assert.deepEqual(
  referenced.value.curves[0].edges[0].cubic,
  baseValue.curves[0].edges[0].cubic,
);

const translated = run(curveTransformOperator, {
  id: 'transform',
  params: { transform: [1, 0, 0, 1, 3, -2] },
});
assert.deepEqual(translated.value.curves[0].edges[0].cubic[0], [4, -2]);
assert.deepEqual(translated.value.curves[0].edges[0].cubic[3], [3, -1]);
const rebasedTransform = curveTransformOperator.rebase(
  {
    id: 'transform',
    type: 'curve-transform',
    params: { transform: [1, 0, 0, 1, 2, 0] },
  },
  { transform: [0, 1, -1, 0, 10, 0] },
);
const g = [0, 1, -1, 0, 10, 0];
assert.deepEqual(
  rebasedTransform.params.transform,
  multiplyTransforms(
    g,
    multiplyTransforms([1, 0, 0, 1, 2, 0], [0, -1, 1, 0, 0, 10]),
  ),
);

const mirrored = run(curveMirrorOperator, {
  id: 'mirror',
  params: { center: [0, 0], angleRad: 0 },
});
assert.equal(mirrored.value.curves.length, 2);
assert.deepEqual(mirrored.value.curves[1].edges[0].cubic[0], [1, 0]);
assert.deepEqual(mirrored.value.curves[1].edges[0].cubic[3], [0, -1]);
assert.equal(mirrored.value.curves[0].edges[0].instances[0].index, 0);
assert.equal(
  mirrored.value.curves[1].edges[0].instances[0].operatorId,
  'mirror',
);

const array = run(
  curveArrayOperator,
  {
    id: 'array',
    params: {
      center: [{ kind: 'parameter', id: 'cx' }, 0],
      angleRad: { kind: 'parameter', id: 'step' },
      count: { kind: 'parameter', id: 'count' },
    },
  },
  ready(),
  {
    resolveScalar: ({ value }) =>
      ({ cx: 0, step: Math.PI / 2, count: 4 })[value.id],
  },
);
assert.equal(array.value.curves.length, 4);
assert.deepEqual(
  array.value.curves[1].edges[0].cubic[0].map(
    (item) => Math.round(item * 1e9) / 1e9,
  ),
  [0, 1],
);
assert.equal(
  new Set(
    array.value.curves.flatMap((curve) => curve.edges.map((edge) => edge.key)),
  ).size,
  4,
);

const joined = run(
  joinOperator,
  {
    id: 'join',
    params: {
      connections: [
        {
          a: {
            edgeEnd: {
              kind: 'edge-end',
              sketchId: 'sketch-a',
              edgeId: 'e',
              end: 'end',
            },
            selector: { operatorId: 'array', index: 'each', wrap: true },
          },
          b: {
            edgeEnd: {
              kind: 'edge-end',
              sketchId: 'sketch-a',
              edgeId: 'e',
              end: 'start',
            },
            selector: { operatorId: 'array', index: 'next', wrap: true },
          },
        },
      ],
    },
  },
  array,
);
assert.equal(joined.value.junctions.length, 4);
const collected = curveCollectOperator.evaluate({
  ownerNodeId: 'shape-b',
  inputs: { input: [joined] },
}).curves;
assert.deepEqual(
  collected,
  joined,
  'collect preserves Join identity and topology',
);
assert.notEqual(
  collected.value,
  joined.value,
  'collected geometry is independently owned',
);
assert.deepEqual(
  fillCurves(collected.value, { joinToleranceMM: 0.001 }),
  fillCurves(joined.value, { joinToleranceMM: 0.001 }),
  'collect retains the closure provided by Join',
);
assert.equal(
  curveCollectOperator.evaluate({
    ownerNodeId: 'shape-b',
    inputs: { input: [joined, joined] },
  }).curves.status,
  'blocked',
  'repeated branches must not create duplicate identities',
);
assert.equal(
  curveCollectOperator.evaluate({
    ownerNodeId: 'shape-b',
    inputs: { input: [] },
  }).curves.status,
  'empty',
);
assert.equal(
  curveCollectOperator.evaluate({
    ownerNodeId: 'shape-b',
    inputs: { input: [{ status: 'blocked', dependencies: ['missing'] }] },
  }).curves.status,
  'blocked',
);
assert.deepEqual(joined.value.junctions[0].endpoints[0], {
  edgeKey: 'path-a:0:e@array:0',
  end: 'end',
});
assert.deepEqual(
  joined.value.curves[0].edges[0].cubic,
  array.value.curves[0].edges[0].cubic,
);
assert.equal(
  fillCurves(joined.value, {
    operatorId: 'fill',
    geometrySettings: document.geometrySettings,
  }).status,
  'ready',
);

const gap = run(
  joinOperator,
  {
    id: 'gap',
    params: {
      connections: [
        {
          a: {
            edgeEnd: {
              kind: 'edge-end',
              sketchId: 'sketch-a',
              edgeId: 'e',
              end: 'start',
            },
            selector: { operatorId: 'array', index: 0, wrap: false },
          },
          b: {
            edgeEnd: {
              kind: 'edge-end',
              sketchId: 'sketch-a',
              edgeId: 'e',
              end: 'end',
            },
            selector: { operatorId: 'array', index: 0, wrap: false },
          },
        },
      ],
    },
  },
  array,
);
assert.equal(gap.value.junctions.length, 0);
assert.ok(gap.diagnostics.some((item) => item.code === 'join-gap'));

const rebasedMirror = curveMirrorOperator.rebase(
  {
    id: 'mirror',
    type: 'curve-mirror',
    params: { center: [1, 0], angleRad: 0 },
  },
  { transform: [0, 1, -1, 0, 2, 0] },
);
assert.deepEqual(
  rebasedMirror.params.center,
  transformPoint([0, 1, -1, 0, 2, 0], [1, 0]),
);
assert.equal(rebasedMirror.params.angleRad, Math.PI / 2);
assert.deepEqual(
  curveReferenceOperator.rebase(
    { id: 'reference', params: {} },
    { transform: [1, 0, 0, 1, 1, 1] },
  ).params,
  {},
);

const copied = copyCurveOperator(
  {
    id: 'array',
    type: 'curve-array',
    params: {
      center: [{ kind: 'parameter', id: 'cx' }, 0],
      angleRad: {
        kind: 'expression',
        op: 'add',
        args: [{ kind: 'parameter', id: 'step' }, 1],
      },
      count: 4,
    },
  },
  { idMap: { cx: 'cx-copy', step: 'step-copy' } },
);
assert.equal(copied.params.center[0].id, 'cx-copy');
assert.equal(copied.params.angleRad.args[0].id, 'step-copy');
const copiedJoin = copyCurveOperator(
  {
    id: 'join',
    type: 'join',
    params: {
      connections: [
        {
          a: {
            edgeEnd: {
              kind: 'edge-end',
              sketchId: 'sketch-a',
              edgeId: 'e',
              end: 'end',
            },
            selector: { operatorId: 'array', index: 0, wrap: false },
          },
          b: {
            edgeEnd: {
              kind: 'edge-end',
              sketchId: 'sketch-b',
              edgeId: 'f',
              end: 'start',
            },
            selector: { operatorId: 'array', index: 1, wrap: false },
          },
        },
      ],
    },
  },
  { idMap: { 'sketch-a': 'sketch-copy', e: 'edge-copy', array: 'array-copy' } },
);
assert.equal(
  copiedJoin.params.connections[0].a.edgeEnd.sketchId,
  'sketch-copy',
);
assert.equal(copiedJoin.params.connections[0].a.edgeEnd.edgeId, 'edge-copy');
assert.equal(
  copiedJoin.params.connections[0].a.selector.operatorId,
  'array-copy',
);

let generatedId = 0;
const integration = createDocument({
  version: 4,
  idFactory: () => `generated-${++generatedId}`,
});
integration.nodes.shape = {
  id: 'shape',
  name: 'Shape',
  kind: 'shape',
  parentId: null,
  order: 0,
  pose: { translationMM: [0, 0], rotationRad: 0 },
  visible: true,
  locked: false,
  programId: 'program',
};
integration.programs.program = {
  id: 'program',
  ownerNodeId: 'shape',
  operators: {
    source: {
      id: 'source',
      type: 'source',
      name: 'Source',
      enabled: true,
      inputs: {
        paths: [{ kind: 'sketch', sketchId: 'sketch-a', pathIds: ['path-a'] }],
      },
      params: {},
    },
    array: {
      id: 'array',
      type: 'curve-array',
      name: 'Array',
      enabled: true,
      inputs: {
        input: [
          {
            kind: 'port',
            ownerNodeId: 'shape',
            operatorId: 'source',
            port: 'curves',
            domain: 'curves',
            space: 'local-result',
            transform: [1, 0, 0, 1, 0, 0],
          },
        ],
      },
      params: { center: [0, 0], angleRad: Math.PI / 2, count: 4 },
    },
    join: {
      id: 'join',
      type: 'join',
      name: 'Join',
      enabled: true,
      inputs: {
        input: [
          {
            kind: 'port',
            ownerNodeId: 'shape',
            operatorId: 'array',
            port: 'curves',
            domain: 'curves',
            space: 'local-result',
            transform: [1, 0, 0, 1, 0, 0],
          },
        ],
      },
      params: {
        connections: [
          {
            a: {
              edgeEnd: {
                kind: 'edge-end',
                sketchId: 'sketch-a',
                edgeId: 'e',
                end: 'end',
              },
              selector: { operatorId: 'array', index: 'each', wrap: true },
            },
            b: {
              edgeEnd: {
                kind: 'edge-end',
                sketchId: 'sketch-a',
                edgeId: 'e',
                end: 'start',
              },
              selector: { operatorId: 'array', index: 'next', wrap: true },
            },
          },
        ],
      },
    },
  },
  outputs: {
    curves: {
      kind: 'port',
      ownerNodeId: 'shape',
      operatorId: 'join',
      port: 'curves',
      domain: 'curves',
    },
  },
};
const snapshot = evaluateConstruction(integration, {
  registry: createOperatorRegistry(curveOperatorSpecifications),
  resolveSketch: ({ pathIds }) => {
    assert.deepEqual(pathIds, ['path-a']);
    return ready();
  },
  resolveScalar: ({ value }) => value,
});
assert.equal(snapshot.published['shape:curves'].status, 'ready');
assert.equal(snapshot.published['shape:curves'].value.junctions.length, 4);

console.log(
  'PASS: V4 curve operators preserve exact cubic sources, local frames, instances, rebase and explicit Join topology.',
);
