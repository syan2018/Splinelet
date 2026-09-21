import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import {
  childrenOf,
  effectiveNodeState,
  groupNodes,
  reparentNodes,
  selectedRoots,
  transformNodes,
} from '../../../src/lib/scene/hierarchy.mjs';
import { poseMatrix, worldMatrix } from '../../../src/lib/scene/transforms.mjs';
import {
  inputFrameTransform,
  transformPoint,
} from '../../../src/lib/scene/transforms.mjs';
import { planNodeRebase } from '../../../src/lib/scene/rebase.mjs';
import { ungroupNodes } from '../../../src/lib/scene/operations.mjs';
import {
  copyNodes,
  planNodeDeletion,
} from '../../../src/lib/scene/ownership.mjs';

let counter = 0;
const document = createDocument({ idFactory: () => `fixture-${++counter}` });
for (const [id, kind, parentId, x, y, rotation] of [
  ['group', 'group', null, 10, 4, Math.PI / 2],
  ['a', 'shape', 'group', 3, 7, 0],
  ['b', 'shape', null, 50, 20, -Math.PI / 2],
  ['nested', 'group', 'group', 1, 2, 0],
  ['c', 'shape', 'nested', 1, 1, 0],
]) {
  document.nodes[id] = {
    id,
    kind,
    parentId,
    name: id,
    order: counter++,
    pose: { translationMM: [x, y], rotationRad: rotation },
    visible: true,
    locked: false,
    ...(kind === 'shape' ? { programId: `${id}-program` } : {}),
  };
  if (kind === 'shape')
    document.programs[`${id}-program`] = {
      id: `${id}-program`,
      ownerNodeId: id,
      operators: {},
      outputs: {},
    };
}
document.sketches.sketch = {
  id: 'sketch',
  ownerNodeId: 'a',
  vertices: {},
  edges: {},
  paths: {},
};
const before = structuredClone(document);
const near = (a, b) =>
  a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9));

assert.deepEqual(selectedRoots(document, ['group', 'a', 'c', 'b', 'group']), [
  'group',
  'b',
]);
const moved = transformNodes(
  document,
  ['group', 'a', 'c'],
  poseMatrix({ translationMM: [4, -8], rotationRad: 0 }),
);
for (const id of ['a', 'c']) {
  const original = worldMatrix(document, id),
    current = worldMatrix(moved, id);
  near(current.slice(0, 4), original.slice(0, 4));
  near(current.slice(4), [original[4] + 4, original[5] - 8]);
}
assert.equal(moved.nodes.a, document.nodes.a);
assert.equal(moved.sketches, document.sketches);
assert.equal(moved.programs, document.programs);
assert.equal(moved.manufacturing, document.manufacturing);
const reparented = reparentNodes(document, ['a'], null, { index: 0 });
near(worldMatrix(reparented, 'a'), worldMatrix(document, 'a'));
assert.equal(childrenOf(reparented, null)[0].id, 'a');
const grouped = groupNodes(document, ['a', 'b'], { id: 'combined' });
assert.equal(grouped.nodes.combined.parentId, null);
for (const id of ['a', 'b'])
  near(worldMatrix(grouped, id), worldMatrix(document, id));
assert.equal(grouped.sketches.sketch.ownerNodeId, 'a');
assert.deepEqual(grouped.manufacturing, document.manufacturing);
assert.throws(() => reparentNodes(document, ['group'], 'nested'), /自身或后代/);
assert.throws(() => reparentNodes(document, ['a'], 'b'), /父级必须是组/);
assert.throws(
  () =>
    groupNodes(document, ['a'], { id: document.manufacturing.defaultPartId }),
  /重复 ID/,
);
const hidden = structuredClone(document);
hidden.nodes.group.visible = false;
hidden.nodes.nested.locked = true;
assert.deepEqual(effectiveNodeState(hidden, 'c'), {
  visible: false,
  locked: true,
  hiddenBy: ['group'],
  lockedBy: ['nested'],
});
assert.deepEqual(document, before);

const withSource = structuredClone(document);
withSource.sketches.sketch.vertices.v = {
  id: 'v',
  position: { kind: 'free', value: [3, 4] },
};
withSource.programs['a-program'].operators.source = {
  id: 'source',
  type: 'source',
  name: '',
  enabled: true,
  inputs: { source: [{ kind: 'sketch', sketchId: 'sketch' }] },
  params: {},
};
const port = {
  kind: 'port',
  ownerNodeId: 'a',
  operatorId: 'source',
  port: 'curves',
  domain: 'curves',
};
withSource.programs['a-program'].outputs.curves = port;
for (const [id, space] of [
  ['local', 'local-result'],
  ['world', 'world-result'],
]) {
  withSource.programs['b-program'].operators[id] = {
    id,
    type: 'curve-reference',
    name: '',
    enabled: true,
    inputs: { input: [{ ...port, space, transform: [0, 1, -1, 0, 8, 9] }] },
    params: {},
  };
}
const sourceBefore = structuredClone(withSource);
assert.throws(
  () =>
    planNodeRebase(withSource, 'a', { translationMM: [0, 0], rotationRad: 0 }),
  /访问器/,
);
const rebased = planNodeRebase(
  withSource,
  'a',
  { translationMM: [-12, 6], rotationRad: 0.4 },
  {
    rebaseOperator: (operator) => operator,
  },
).document;
const beforePoint = withSource.sketches.sketch.vertices.v.position.value;
const afterPoint = rebased.sketches.sketch.vertices.v.position.value;
near(
  transformPoint(worldMatrix(withSource, 'a'), beforePoint),
  transformPoint(worldMatrix(rebased, 'a'), afterPoint),
);
for (const id of ['local', 'world']) {
  const oldInput =
    withSource.programs['b-program'].operators[id].inputs.input[0];
  const newInput = rebased.programs['b-program'].operators[id].inputs.input[0];
  near(
    transformPoint(inputFrameTransform(withSource, 'b', oldInput), beforePoint),
    transformPoint(inputFrameTransform(rebased, 'b', newInput), afterPoint),
  );
}
const receiverRebased = planNodeRebase(
  withSource,
  'b',
  { translationMM: [-4, 13], rotationRad: 0.7 },
  {
    rebaseOperator: (operator) => operator,
  },
).document;
for (const id of ['local', 'world']) {
  const oldInput =
    withSource.programs['b-program'].operators[id].inputs.input[0];
  const newInput =
    receiverRebased.programs['b-program'].operators[id].inputs.input[0];
  near(
    transformPoint(
      worldMatrix(withSource, 'b'),
      transformPoint(
        inputFrameTransform(withSource, 'b', oldInput),
        beforePoint,
      ),
    ),
    transformPoint(
      worldMatrix(receiverRebased, 'b'),
      transformPoint(
        inputFrameTransform(receiverRebased, 'b', newInput),
        beforePoint,
      ),
    ),
  );
}
const groupRebased = planNodeRebase(withSource, 'group', {
  translationMM: [2, 3],
  rotationRad: -0.6,
}).document;
for (const id of ['a', 'c', 'nested'])
  near(worldMatrix(groupRebased, id), worldMatrix(withSource, id));
assert.deepEqual(withSource, sourceBefore);

const withDatum = structuredClone(document);
withDatum.datums.center = {
  id: 'center',
  kind: 'point',
  name: '中心',
  ownerNodeId: 'group',
  position: [2, 3],
};
withDatum.parameters.distance = {
  id: 'distance',
  name: '距离',
  ownerNodeId: 'group',
  unit: 'mm',
  value: 3,
};
withDatum.collections.collection = {
  id: 'collection',
  name: '整理',
  origin: 'user',
  members: [{ kind: 'node', id: 'group' }],
};
const ungrouped = ungroupNodes(withDatum, ['group', 'nested']);
assert.equal(ungrouped.nodes.group, undefined);
assert.equal(ungrouped.nodes.nested, undefined);
for (const id of ['a', 'b', 'c'])
  near(worldMatrix(ungrouped, id), worldMatrix(withDatum, id));
assert.equal(ungrouped.datums.center.ownerNodeId, null);
near(
  ungrouped.datums.center.position,
  transformPoint(worldMatrix(withDatum, 'group'), [2, 3]),
);
assert.equal(ungrouped.parameters.distance.ownerNodeId, null);
assert.equal(ungrouped.parameters.distance.value, 3);
assert.deepEqual(
  ungrouped.collections.collection.members.map((ref) => ref.id).sort(),
  ['a', 'c'],
);
assert.equal(ungrouped.sketches.sketch.ownerNodeId, 'a');
assert.deepEqual(ungrouped.manufacturing, withDatum.manufacturing);
const hiddenUngrouped = ungroupNodes(hidden, ['group', 'nested']);
assert.equal(effectiveNodeState(hiddenUngrouped, 'a').visible, false);
assert.equal(effectiveNodeState(hiddenUngrouped, 'c').locked, true);

const copySource = structuredClone(withSource);
copySource.datums.shared = {
  id: 'shared',
  name: '共享中心',
  ownerNodeId: 'group',
  kind: 'point',
  position: [1, 2],
};
copySource.programs['c-program'].operators.internal = {
  id: 'internal',
  type: 'curve-reference',
  name: '',
  enabled: true,
  inputs: {
    input: [{ ...port, space: 'local-result', transform: [1, 0, 0, 1, 0, 0] }],
  },
  params: {},
};
let copyIndex = 0;
const copied = copyNodes(copySource, ['group', 'a'], {
  idFactory: () => `copy-${++copyIndex}`,
});
const map = copied.idMap;
assert.equal(copied.roots.length, 1);
assert.equal(copied.document.nodes[map.a].parentId, map.group);
assert.equal(copied.document.sketches[map.sketch].ownerNodeId, map.a);
assert.equal(copied.document.datums[map.shared].ownerNodeId, map.group);
assert.deepEqual(
  copied.document.programs[map['c-program']].operators[map.internal].inputs
    .input[0],
  {
    ...port,
    ownerNodeId: map.a,
    operatorId: map.source,
    space: 'local-result',
    transform: [1, 0, 0, 1, 0, 0],
  },
);
for (const id of ['group', 'a', 'c'])
  near(worldMatrix(copySource, id), worldMatrix(copied.document, map[id]));
assert.deepEqual(
  copied.document.programs['b-program'],
  copySource.programs['b-program'],
);
assert.throws(
  () => copyNodes(copySource, ['a'], { idFactory: () => 'a' }),
  /重复/,
);
const onlyReceiver = copyNodes(copySource, ['b'], {
  idFactory: () => `copy-${++copyIndex}`,
});
assert.equal(
  onlyReceiver.document.programs[onlyReceiver.idMap['b-program']].operators[
    onlyReceiver.idMap.local
  ].inputs.input[0].ownerNodeId,
  'a',
);
const deleted = planNodeDeletion(copySource, ['group', 'a']);
assert.equal(deleted.document.nodes.a, undefined);
assert.equal(deleted.document.sketches.sketch, undefined);
assert.ok(deleted.impacts.length >= 2);
assert.deepEqual(
  deleted.document.programs['b-program'],
  copySource.programs['b-program'],
);
assert.deepEqual(
  deleted.document.programs['b-program'].operators.local.inputs.input[0],
  copySource.programs['b-program'].operators.local.inputs.input[0],
);
console.log(
  'PASS: V4 pose-only movement, nested selection, keepWorld grouping/reparent, source/manufacturing preservation',
);
