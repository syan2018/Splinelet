import assert from 'node:assert/strict';
import {
  createDocument,
  validateDocument,
} from '../../../src/lib/document/schema.mjs';
import {
  resolveDatum,
  resolveDatumWorld,
} from '../../../src/lib/geometry/datums.mjs';
import {
  describeRelationDof,
  planRelationEdit,
  releaseRelation,
} from '../../../src/lib/geometry/edit-dof.mjs';
import { resolveScalar } from '../../../src/lib/geometry/parameters.mjs';
import { resolveRelation } from '../../../src/lib/geometry/relations.mjs';
import { resolveSketch } from '../../../src/lib/geometry/sketch.mjs';
import { ungroupNodes } from '../../../src/lib/scene/operations.mjs';
import { planNodeRebase } from '../../../src/lib/scene/rebase.mjs';
import {
  inverseTransform,
  transformPoint,
  worldMatrix,
} from '../../../src/lib/scene/transforms.mjs';

const near = (actual, expected, epsilon = 1e-9) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) =>
    assert.ok(
      Math.abs(value - expected[index]) < epsilon,
      `${value} != ${expected[index]}`,
    ),
  );
};
const pointWorld = (document, sketchId, point) =>
  transformPoint(
    worldMatrix(document, document.sketches[sketchId].ownerNodeId),
    point,
  );
const identity = [1, 0, 0, 1, 0, 0];

function shape(document, id, parentId, pose) {
  const programId = `${id}-program`;
  document.nodes[id] = {
    id,
    kind: 'shape',
    name: id,
    parentId,
    order: Object.keys(document.nodes).length,
    pose,
    visible: true,
    locked: false,
    programId,
  };
  document.programs[programId] = {
    id: programId,
    ownerNodeId: id,
    operators: {},
    outputs: {},
  };
}

function fixture() {
  let generated = 0;
  const document = createDocument({
    version: 4,
    idFactory: () => `generated-${++generated}`,
  });
  document.nodes.group = {
    id: 'group',
    kind: 'group',
    name: 'group',
    parentId: null,
    order: 0,
    pose: { translationMM: [10, -2], rotationRad: Math.PI / 2 },
    visible: true,
    locked: false,
  };
  shape(document, 'source', 'group', {
    translationMM: [4, 1],
    rotationRad: Math.PI / 6,
  });
  shape(document, 'target', null, {
    translationMM: [-6, 8],
    rotationRad: -Math.PI / 4,
  });
  document.parameters.distance = {
    id: 'distance',
    name: '距离',
    ownerNodeId: 'group',
    unit: 'mm',
    value: 4,
  };
  document.parameters.offsetX = {
    id: 'offsetX',
    name: '横偏移',
    ownerNodeId: null,
    unit: 'mm',
    value: 2,
  };
  document.parameters.angle = {
    id: 'angle',
    name: '角度',
    ownerNodeId: 'group',
    unit: 'rad',
    value: Math.PI / 2,
  };
  document.datums.axis = {
    id: 'axis',
    name: '轴',
    ownerNodeId: 'group',
    kind: 'axis',
    origin: [1, -3],
    angleRad: { kind: 'parameter', id: 'angle' },
  };
  document.datums.point = {
    id: 'point',
    name: '点',
    ownerNodeId: 'group',
    kind: 'point',
    position: [2, 5],
  };
  document.sketches['source-sketch'] = {
    id: 'source-sketch',
    ownerNodeId: 'source',
    vertices: {
      sourcePoint: {
        id: 'sourcePoint',
        position: { kind: 'free', value: [3, 2] },
      },
      srcV: { id: 'srcV', position: { kind: 'free', value: [0, 0] } },
      srcS: { id: 'srcS', position: { kind: 'free', value: [-3, 1] } },
    },
    edges: {
      sourceEdge: {
        id: 'sourceEdge',
        startVertexId: 'srcS',
        endVertexId: 'srcV',
        startHandle: { kind: 'free', vector: [1, 1] },
        endHandle: { kind: 'free', vector: [3, 4] },
      },
    },
    paths: {},
  };
  document.sketches['target-sketch'] = {
    id: 'target-sketch',
    ownerNodeId: 'target',
    vertices: {
      axisTarget: {
        id: 'axisTarget',
        position: { kind: 'relation', relationId: 'axis-relation' },
      },
      coincidentTarget: {
        id: 'coincidentTarget',
        position: { kind: 'relation', relationId: 'coincident-relation' },
      },
      localTarget: {
        id: 'localTarget',
        position: { kind: 'relation', relationId: 'local-coincident' },
      },
      editTarget: {
        id: 'editTarget',
        position: { kind: 'relation', relationId: 'direct-axis' },
      },
      v: { id: 'v', position: { kind: 'free', value: [0, 0] } },
      s: { id: 's', position: { kind: 'free', value: [-3, 1] } },
      t: { id: 't', position: { kind: 'free', value: [3, 4] } },
    },
    edges: {
      targetEdge: {
        id: 'targetEdge',
        startVertexId: 'v',
        endVertexId: 't',
        startHandle: { kind: 'relation', relationId: 'auto-relation' },
        endHandle: { kind: 'free', vector: [-1, 0] },
      },
      sourceContinuity: {
        id: 'sourceContinuity',
        startVertexId: 's',
        endVertexId: 'v',
        startHandle: { kind: 'free', vector: [1, 1] },
        endHandle: { kind: 'free', vector: [3, 4] },
      },
      smoothEdge: {
        id: 'smoothEdge',
        startVertexId: 'v',
        endVertexId: 't',
        startHandle: { kind: 'relation', relationId: 'smooth-relation' },
        endHandle: { kind: 'free', vector: [-1, 0] },
      },
      symmetricEdge: {
        id: 'symmetricEdge',
        startVertexId: 'v',
        endVertexId: 't',
        startHandle: { kind: 'relation', relationId: 'symmetric-relation' },
        endHandle: { kind: 'free', vector: [-1, 0] },
      },
    },
    paths: {
      resolved: {
        id: 'resolved',
        name: '关系',
        edges: [{ edgeId: 'targetEdge', reversed: false }],
        visible: true,
      },
    },
  };
  document.relations['axis-relation'] = {
    id: 'axis-relation',
    kind: 'point-on-axis',
    target: { kind: 'vertex', sketchId: 'target-sketch', id: 'axisTarget' },
    axisId: 'axis',
    distance: {
      kind: 'expression',
      op: 'add',
      args: [{ kind: 'parameter', id: 'distance' }, 1],
    },
    frame: { space: 'world', transform: identity },
  };
  document.relations['coincident-relation'] = {
    id: 'coincident-relation',
    kind: 'coincident',
    target: {
      kind: 'vertex',
      sketchId: 'target-sketch',
      id: 'coincidentTarget',
    },
    source: { kind: 'vertex', sketchId: 'source-sketch', id: 'sourcePoint' },
    offset: [{ kind: 'parameter', id: 'offsetX' }, -1],
    frame: { space: 'world', transform: [0, 1, -1, 0, 1, -2] },
  };
  document.relations['direct-axis'] = {
    id: 'direct-axis',
    kind: 'point-on-axis',
    target: { kind: 'vertex', sketchId: 'target-sketch', id: 'editTarget' },
    axisId: 'axis',
    distance: { kind: 'parameter', id: 'distance' },
    frame: { space: 'world', transform: identity },
  };
  document.relations['local-coincident'] = {
    id: 'local-coincident',
    kind: 'coincident',
    target: { kind: 'vertex', sketchId: 'target-sketch', id: 'localTarget' },
    source: { kind: 'datum', id: 'point' },
    offset: [1, 2],
    frame: { space: 'owner-local', transform: [0, 1, -1, 0, 2, 0] },
  };
  for (const [id, mode] of [
    ['auto-relation', 'auto'],
    ['symmetric-relation', 'symmetric'],
    ['smooth-relation', 'smooth'],
  ])
    document.relations[id] = {
      id,
      kind: 'handle-continuity',
      target: {
        kind: 'edge-end',
        sketchId: 'target-sketch',
        edgeId:
          id === 'auto-relation'
            ? 'targetEdge'
            : id === 'smooth-relation'
              ? 'smoothEdge'
              : 'symmetricEdge',
        end: 'start',
      },
      source: {
        kind: 'edge-end',
        sketchId: 'target-sketch',
        edgeId: 'sourceContinuity',
        end: 'end',
      },
      mode,
      ...(mode === 'smooth'
        ? { length: { kind: 'parameter', id: 'distance' } }
        : {}),
    };
  validateDocument(document);
  return document;
}

const document = fixture();

assert.equal(
  resolveScalar(document, {
    kind: 'expression',
    op: 'cos',
    args: [{ kind: 'expression', op: 'negate', args: [0] }],
  }).value,
  1,
);
assert.equal(
  resolveScalar(document, { kind: 'parameter', id: 'distance' }).value,
  4,
);
assert.equal(
  resolveScalar(document, { kind: 'expression', op: 'divide', args: [1, 0] })
    .status,
  'blocked',
);
assert.equal(
  resolveScalar(document, { kind: 'parameter', id: 'gone' }).status,
  'blocked',
);
const scalarCycle = { kind: 'expression', op: 'negate', args: [] };
scalarCycle.args.push(scalarCycle);
assert.equal(resolveScalar(document, scalarCycle).diagnostics[0].kind, 'cycle');

const datum = resolveDatum(document, 'axis');
assert.equal(datum.status, 'ready');
near(datum.value.origin, [1, -3]);
near(datum.value.direction, [0, 1]);
assert.ok(datum.dependencies.includes('datum:axis'));
assert.ok(datum.dependencies.includes('parameter:angle'));
const datumWorld = resolveDatumWorld(document, 'point');
near(
  datumWorld.value.position,
  transformPoint(worldMatrix(document, 'group'), [2, 5]),
);
assert.ok(datumWorld.dependencies.includes('node:group:world'));

const axis = resolveRelation({
  document,
  sketch: document.sketches['target-sketch'],
  target: document.relations['axis-relation'].target,
  relationId: 'axis-relation',
});
assert.equal(axis.status, 'ready');
near(
  pointWorld(document, 'target-sketch', axis.value),
  transformPoint(worldMatrix(document, 'group'), [1, 2]),
);
for (const dependency of [
  'relation:axis-relation',
  'datum:axis',
  'parameter:angle',
  'parameter:distance',
  'node:group:world',
  'node:target:world',
])
  assert.ok(axis.dependencies.includes(dependency), dependency);

const coincidence = resolveRelation({
  document,
  sketch: document.sketches['target-sketch'],
  target: document.relations['coincident-relation'].target,
  relationId: 'coincident-relation',
});
assert.equal(coincidence.status, 'ready');
const sourceLocal = [5, 1];
const sourceWorld = transformPoint(
  worldMatrix(document, 'source'),
  sourceLocal,
);
near(
  pointWorld(document, 'target-sketch', coincidence.value),
  transformPoint(
    worldMatrix(document, 'target'),
    transformPoint(
      [0, 1, -1, 0, 1, -2],
      transformPoint(
        inverseTransform(worldMatrix(document, 'target')),
        sourceWorld,
      ),
    ),
  ),
);
assert.ok(coincidence.dependencies.includes('sketch:source-sketch'));
assert.ok(coincidence.dependencies.includes('parameter:offsetX'));

const localCoincidence = resolveRelation({
  document,
  target: document.relations['local-coincident'].target,
  relationId: 'local-coincident',
});
near(localCoincidence.value, [-5, 3]);
assert.ok(
  !localCoincidence.dependencies.some((key) => key.startsWith('node:')),
);

const auto = resolveRelation({
  document,
  target: document.relations['auto-relation'].target,
  relationId: 'auto-relation',
});
near(auto.value, [(2 * Math.sqrt(5)) / 3, Math.sqrt(5) / 3]);
const smooth = resolveRelation({
  document,
  target: document.relations['smooth-relation'].target,
  relationId: 'smooth-relation',
});
near(smooth.value, [-12 / 5, -16 / 5]);
const symmetric = resolveRelation({
  document,
  target: document.relations['symmetric-relation'].target,
  relationId: 'symmetric-relation',
});
near(symmetric.value, [-3, -4]);
const sketchResult = resolveSketch(document, 'target-sketch', {
  resolveRelation,
});
assert.equal(sketchResult.status, 'ready');
near(sketchResult.value.curves[0].edges[0].cubic[1], auto.value);

const cyclic = fixture();
cyclic.sketches['target-sketch'].vertices.cycleA = {
  id: 'cycleA',
  position: { kind: 'relation', relationId: 'cycle-a' },
};
cyclic.sketches['target-sketch'].vertices.cycleB = {
  id: 'cycleB',
  position: { kind: 'relation', relationId: 'cycle-b' },
};
cyclic.relations['cycle-a'] = {
  id: 'cycle-a',
  kind: 'coincident',
  target: { kind: 'vertex', sketchId: 'target-sketch', id: 'cycleA' },
  source: { kind: 'vertex', sketchId: 'target-sketch', id: 'cycleB' },
  offset: [0, 0],
  frame: { space: 'owner-local', transform: identity },
};
cyclic.relations['cycle-b'] = {
  id: 'cycle-b',
  kind: 'coincident',
  target: { kind: 'vertex', sketchId: 'target-sketch', id: 'cycleB' },
  source: { kind: 'vertex', sketchId: 'target-sketch', id: 'cycleA' },
  offset: [0, 0],
  frame: { space: 'owner-local', transform: identity },
};
const cycle = resolveRelation({
  document: cyclic,
  target: cyclic.relations['cycle-a'].target,
  relationId: 'cycle-a',
});
assert.equal(cycle.status, 'blocked');
assert.match(cycle.diagnostics[0].message, /cycle-a.*cycle-b.*cycle-a/);

assert.deepEqual(
  describeRelationDof(document, 'axis-relation').value.editable,
  [],
);
const edited = planRelationEdit(document, {
  relationId: 'axis-relation',
  field: 'distance',
  value: 7,
});
assert.equal(edited.status, 'blocked');
assert.deepEqual(describeRelationDof(document, 'direct-axis').value.editable, [
  'value',
]);
const directEdited = planRelationEdit(document, {
  relationId: 'direct-axis',
  field: 'distance',
  value: 7,
});
assert.equal(directEdited.status, 'ready');
assert.equal(directEdited.value.document.parameters.distance.value, 7);
assert.equal(document.parameters.distance.value, 4);
const sharedOffset = structuredClone(document);
sharedOffset.relations['coincident-relation'].offset = [
  { kind: 'parameter', id: 'offsetX' },
  { kind: 'parameter', id: 'offsetX' },
];
assert.equal(
  planRelationEdit(sharedOffset, {
    relationId: 'coincident-relation',
    field: 'offset',
    value: [1, 2],
  }).status,
  'blocked',
);
const released = releaseRelation(document, 'axis-relation', axis.value);
assert.equal(released.document.relations['axis-relation'], undefined);
assert.deepEqual(
  released.document.sketches['target-sketch'].vertices.axisTarget.position,
  { kind: 'free', value: axis.value },
);
assert.throws(
  () => releaseRelation(document, 'axis-relation', [Infinity, 0]),
  /有限 Vec2/,
);

const rebaseSource = fixture();
const relationBefore = resolveRelation({
  document: rebaseSource,
  target: rebaseSource.relations['coincident-relation'].target,
  relationId: 'coincident-relation',
});
const worldBefore = pointWorld(
  rebaseSource,
  'target-sketch',
  relationBefore.value,
);
const rebased = planNodeRebase(rebaseSource, 'source', {
  translationMM: [-4, 12],
  rotationRad: -0.3,
}).document;
const relationAfter = resolveRelation({
  document: rebased,
  target: rebased.relations['coincident-relation'].target,
  relationId: 'coincident-relation',
});
near(pointWorld(rebased, 'target-sketch', relationAfter.value), worldBefore);

const localRebaseSource = fixture();
const localBefore = resolveRelation({
  document: localRebaseSource,
  target: localRebaseSource.relations['local-coincident'].target,
  relationId: 'local-coincident',
});
const localWorldBefore = pointWorld(
  localRebaseSource,
  'target-sketch',
  localBefore.value,
);
const localRebased = planNodeRebase(localRebaseSource, 'group', {
  translationMM: [3, -8],
  rotationRad: 0.2,
}).document;
const localAfter = resolveRelation({
  document: localRebased,
  target: localRebased.relations['local-coincident'].target,
  relationId: 'local-coincident',
});
near(
  pointWorld(localRebased, 'target-sketch', localAfter.value),
  localWorldBefore,
);

const ungroupSource = fixture();
const axisBefore = resolveRelation({
  document: ungroupSource,
  target: ungroupSource.relations['axis-relation'].target,
  relationId: 'axis-relation',
});
const axisWorldBefore = pointWorld(
  ungroupSource,
  'target-sketch',
  axisBefore.value,
);
const localUngroupBefore = resolveRelation({
  document: ungroupSource,
  target: ungroupSource.relations['local-coincident'].target,
  relationId: 'local-coincident',
});
const localUngroupWorldBefore = pointWorld(
  ungroupSource,
  'target-sketch',
  localUngroupBefore.value,
);
const ungrouped = ungroupNodes(ungroupSource, ['group']);
const axisAfter = resolveRelation({
  document: ungrouped,
  target: ungrouped.relations['axis-relation'].target,
  relationId: 'axis-relation',
});
near(pointWorld(ungrouped, 'target-sketch', axisAfter.value), axisWorldBefore);
assert.equal(ungrouped.datums.axis.ownerNodeId, null);
const localUngrouped = resolveRelation({
  document: ungrouped,
  target: ungrouped.relations['local-coincident'].target,
  relationId: 'local-coincident',
});
near(
  pointWorld(ungrouped, 'target-sketch', localUngrouped.value),
  localUngroupWorldBefore,
);

console.log(
  'PASS: V4 safe Scalar, local/world Datum, finite Relation resolution, editable DOF, and rebase/ungroup invariants.',
);
