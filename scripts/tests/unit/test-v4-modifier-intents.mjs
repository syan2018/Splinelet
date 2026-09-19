import assert from 'node:assert/strict';
import {
  createDocument,
  validateDocument,
} from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { compileModifierUpdate } from '../../../src/lib/editor/modifier-intents.mjs';

const approximately = (actual, expected, label) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-10,
    `${label}: expected ${expected}, received ${actual}`,
  );

let serial = 0;
const document = createDocument({
  id: 'modifier-intents-document',
  idFactory: () => `generated-${++serial}`,
});
document.nodes.group = {
  id: 'group',
  kind: 'group',
  name: '旋转父组',
  parentId: null,
  order: 0,
  pose: { translationMM: [10, 20], rotationRad: Math.PI / 2 },
  visible: true,
  locked: false,
};
document.nodes.shape = {
  id: 'shape',
  programId: 'program',
  kind: 'shape',
  name: '源部件',
  parentId: 'group',
  order: 0,
  pose: { translationMM: [2, 3], rotationRad: 0 },
  visible: true,
  locked: false,
};
document.nodes.foreign = {
  id: 'foreign',
  programId: 'foreign-program',
  kind: 'shape',
  name: '其他部件',
  parentId: null,
  order: 1,
  pose: { translationMM: [0, 0], rotationRad: 0 },
  visible: true,
  locked: false,
};

const operator = (id, type, params) => ({
  id,
  type,
  name: id,
  enabled: true,
  inputs: {},
  params,
});
document.programs.program = {
  id: 'program',
  ownerNodeId: 'shape',
  operators: {
    mirror: {
      ...operator('mirror', 'curve-mirror', {
        center: [0, 0],
        angleRad: 0,
        rawSketch: { source: 'must-survive' },
        scope: { kind: 'all' },
        connections: [{ id: 'connection-contract' }],
      }),
      outputContract: {
        version: 1,
        members: [
          {
            port: 'curves',
            key: 'mirror-result',
            lineage: ['source-result'],
          },
        ],
      },
    },
    array: operator('array', 'curve-array', {
      center: [1, 2],
      angleRad: Math.PI / 4,
      count: 3,
      rawSketch: { source: 'array-source' },
    }),
    'region-array': operator('region-array', 'region-array', {
      center: [1, 2],
      angleRad: Math.PI / 4,
      count: 3,
      scope: { kind: 'selected', refs: [{ key: 'region' }] },
    }),
    offset: operator('offset', 'offset', {
      distanceMM: 0.5,
      scope: { kind: 'all' },
    }),
    boolean: operator('boolean', 'boolean', {
      operation: 'difference',
      scope: { kind: 'selected', refs: [{ key: 'region' }] },
    }),
    partition: operator('partition', 'partition', {
      scope: { kind: 'all' },
      endpointJoin: {
        toleranceMM: 0.01,
        disabled: [],
        cohorts: [],
      },
    }),
    fill: operator('fill', 'fill', { rule: 'even-odd' }),
    join: operator('join', 'join', {
      connections: [{ id: 'stable-connection' }],
    }),
  },
  outputs: {},
};
document.programs['foreign-program'] = {
  id: 'foreign-program',
  ownerNodeId: 'foreign',
  operators: {
    'foreign-offset': operator('foreign-offset', 'offset', {
      distanceMM: 1,
      scope: { kind: 'all' },
    }),
  },
  outputs: {},
};
validateDocument(document);

const original = structuredClone(document);
const mirrorAction = compileModifierUpdate(document, {
  objectId: 'shape',
  modifierId: 'mirror',
  sourceFeatureId: 'legacy-source-feature',
  changes: {
    enabled: false,
    name: '世界轴镜像',
    centerMM: { x: 2, y: 26 },
    angleDeg: 120,
  },
});
assert.equal(mirrorAction.kind, 'set-operator');
assert.equal(mirrorAction.ownerNodeId, 'shape');
assert.equal(mirrorAction.operatorId, 'mirror');
assert.equal(mirrorAction.enabled, false);
assert.equal(mirrorAction.name, '世界轴镜像');
approximately(mirrorAction.params.center[0], 4, 'mirror local center x');
approximately(mirrorAction.params.center[1], 5, 'mirror local center y');
approximately(
  mirrorAction.params.angleRad,
  Math.PI / 6,
  'mirror world angle becomes owner-local',
);
assert.deepEqual(mirrorAction.params.rawSketch, {
  source: 'must-survive',
});
assert.deepEqual(mirrorAction.params.scope, { kind: 'all' });
assert.deepEqual(mirrorAction.params.connections, [
  { id: 'connection-contract' },
]);
assert.deepEqual(
  document,
  original,
  'compilation must not mutate the V4 document',
);

const session = createEditorSession(document);
session.dispatch(createAuthoringCommand(mirrorAction), {
  expectedRevision: session.state.revision,
});
const editedMirror = session.state.document.programs.program.operators.mirror;
assert.equal(editedMirror.enabled, false);
assert.equal(editedMirror.name, '世界轴镜像');
assert.deepEqual(
  editedMirror.inputs,
  original.programs.program.operators.mirror.inputs,
);
assert.deepEqual(
  editedMirror.outputContract,
  original.programs.program.operators.mirror.outputContract,
);
session.undo({ expectedRevision: session.state.revision });
assert.deepEqual(
  session.state.document,
  original,
  'the compiled update is one undoable set-operator command',
);

for (const modifierId of ['array', 'region-array']) {
  const action = compileModifierUpdate(document, {
    objectId: 'shape',
    modifierId,
    changes: {
      count: 6,
      angleDeg: 120,
      centerMM: { x: 2, y: 26 },
    },
  });
  assert.equal(action.params.count, 6);
  approximately(
    action.params.angleRad,
    (2 * Math.PI) / 3,
    `${modifierId} angle remains a relative step`,
  );
  approximately(action.params.center[0], 4, `${modifierId} local center x`);
  approximately(action.params.center[1], 5, `${modifierId} local center y`);
  assert.deepEqual(
    action.params.rawSketch,
    document.programs.program.operators[modifierId].params.rawSketch,
  );
  assert.deepEqual(
    action.params.scope,
    document.programs.program.operators[modifierId].params.scope,
  );
}

const offsetAction = compileModifierUpdate(document, {
  objectId: 'shape',
  modifierId: 'offset',
  changes: { distanceMM: -1.25 },
});
assert.equal(offsetAction.params.distanceMM, -1.25);
assert.deepEqual(offsetAction.params.scope, { kind: 'all' });

const booleanAction = compileModifierUpdate(document, {
  objectId: 'shape',
  modifierId: 'boolean',
  changes: { operation: 'intersection' },
});
assert.equal(booleanAction.params.operation, 'intersection');
assert.deepEqual(booleanAction.params.scope, {
  kind: 'selected',
  refs: [{ key: 'region' }],
});

const partitionAction = compileModifierUpdate(document, {
  objectId: 'shape',
  modifierId: 'partition',
  changes: { enabled: false, name: '保留连接策略' },
});
assert.deepEqual(partitionAction, {
  kind: 'set-operator',
  ownerNodeId: 'shape',
  operatorId: 'partition',
  enabled: false,
  name: '保留连接策略',
});
for (const modifierId of ['fill', 'join']) {
  const action = compileModifierUpdate(document, {
    objectId: 'shape',
    modifierId,
    changes: { enabled: false, name: `${modifierId} 已停用` },
  });
  assert.deepEqual(action, {
    kind: 'set-operator',
    ownerNodeId: 'shape',
    operatorId: modifierId,
    enabled: false,
    name: `${modifierId} 已停用`,
  });
  assert.throws(
    () =>
      compileModifierUpdate(document, {
        objectId: 'shape',
        modifierId,
        changes: { count: 2 },
      }),
    new RegExp(`${modifierId} 不支持修改字段：count`),
  );
}

const driven = structuredClone(document);
driven.programs.program.operators.array.params.count = {
  kind: 'parameter',
  id: 'count-parameter',
};
assert.throws(
  () =>
    compileModifierUpdate(driven, {
      objectId: 'shape',
      modifierId: 'array',
      changes: { count: 8 },
    }),
  /Parameter.*expression 驱动/,
);
driven.programs.program.operators.array.params.angleRad = {
  kind: 'expression',
  op: 'add',
  args: [0, 1],
};
assert.throws(
  () =>
    compileModifierUpdate(driven, {
      objectId: 'shape',
      modifierId: 'array',
      changes: { angleDeg: 30 },
    }),
  /expression 驱动/,
);
driven.programs.program.operators.array.params.center = [
  { kind: 'datum', id: 'datum' },
  0,
];
assert.throws(
  () =>
    compileModifierUpdate(driven, {
      objectId: 'shape',
      modifierId: 'array',
      changes: { centerMM: { x: 0, y: 0 } },
    }),
  /Datum.*expression 驱动/,
);
driven.programs.program.operators.offset.params.distanceMM = {
  kind: 'parameter',
  id: 'distance-parameter',
};
assert.throws(
  () =>
    compileModifierUpdate(driven, {
      objectId: 'shape',
      modifierId: 'offset',
      changes: { distanceMM: 2 },
    }),
  /Parameter.*expression 驱动/,
);

assert.throws(
  () =>
    compileModifierUpdate(document, {
      objectId: 'shape',
      modifierId: 'foreign-offset',
      changes: { distanceMM: 2 },
    }),
  /不属于指定 Shape/,
);
assert.throws(
  () =>
    compileModifierUpdate(document, {
      objectId: 'shape',
      modifierId: 'mirror',
      changes: { count: 2 },
    }),
  /不支持修改字段：count/,
);
for (const field of ['input', 'targets', 'joinMM', 'add', 'move', 'remove'])
  assert.throws(
    () =>
      compileModifierUpdate(document, {
        objectId: 'shape',
        modifierId: 'partition',
        changes: { [field]: null },
      }),
    new RegExp(`尚不支持 ${field}`),
  );
assert.throws(
  () =>
    compileModifierUpdate(document, {
      objectId: 'shape',
      modifierId: 'boolean',
      changes: { operation: 'xor' },
    }),
  /operation 必须/,
);
assert.throws(
  () =>
    compileModifierUpdate(document, {
      objectId: 'shape',
      modifierId: 'offset',
      changes: { distanceMM: 1 },
      typo: true,
    }),
  /未知字段：typo/,
);

console.log(
  'PASS modifier_update compiles strict, frame-correct, reference-safe set-operator actions without mutating the V4 source document',
);
