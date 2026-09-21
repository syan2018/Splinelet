import assert from 'node:assert/strict';
import {
  identityTransform,
  inputFrameTransform,
  inverseTransform,
  matrixPose,
  multiplyTransforms,
  poseMatrix,
  relationFrameTransform,
  transformPoint,
  transformVector,
  worldMatrix,
} from '../../../src/lib/scene/transforms.mjs';

const near = (actual, expected) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) =>
    assert.ok(
      Math.abs(value - expected[index]) < 1e-9,
      `${actual} != ${expected}`,
    ),
  );
};
const node = (id, kind, parentId, x, y, angle) => ({
  id,
  kind,
  parentId,
  pose: { translationMM: [x, y], rotationRad: angle },
});
const document = {
  nodes: {
    group: node('group', 'group', null, 5, 8, Math.PI / 2),
    source: node('source', 'shape', 'group', 2, 3, -Math.PI / 2),
    receiver: node('receiver', 'shape', null, -3, 9, Math.PI),
  },
};
const before = structuredClone(document);
const sourceWorld = worldMatrix(document, 'source');
near(transformPoint(sourceWorld, [1, 2]), [3, 12]);
near(
  multiplyTransforms(inverseTransform(sourceWorld), sourceWorld),
  identityTransform(),
);
near(transformVector(sourceWorld, [1, 2]), [1, 2]);
near(poseMatrix(matrixPose(sourceWorld)), sourceWorld);

const input = {
  ownerNodeId: 'source',
  space: 'world-result',
  transform: identityTransform(),
};
const localInputPoint = transformPoint(
  inputFrameTransform(document, 'receiver', input),
  [1, 2],
);
near(
  transformPoint(worldMatrix(document, 'receiver'), localInputPoint),
  [3, 12],
);
const localReference = {
  ...input,
  space: 'local-result',
  transform: [1, 0, 0, 1, 2, 4],
};
near(
  transformPoint(
    inputFrameTransform(document, 'receiver', localReference),
    [1, 2],
  ),
  [3, 6],
);

const moved = structuredClone(document);
moved.nodes.group.pose.translationMM = [50, 80];
near(
  inputFrameTransform(moved, 'receiver', localReference),
  localReference.transform,
);
assert.notDeepEqual(
  inputFrameTransform(moved, 'receiver', input),
  inputFrameTransform(document, 'receiver', input),
);
near(
  relationFrameTransform(document, 'receiver', 'source', {
    space: 'world',
    transform: identityTransform(),
  }),
  inputFrameTransform(document, 'receiver', input),
);
near(
  transformPoint(
    relationFrameTransform(document, null, 'source', {
      space: 'world',
      transform: identityTransform(),
    }),
    [1, 2],
  ),
  [3, 12],
);
assert.deepEqual(document, before);

for (const invalid of [
  [2, 0, 0, 1, 0, 0],
  [-1, 0, 0, 1, 0, 0],
  [1, 0, 0.1, 1, 0, 0],
])
  assert.throws(() => matrixPose(invalid), /只允许/);
assert.throws(() => inverseTransform([0, 0, 0, 0, 0, 0]), /不可逆/);
assert.throws(
  () => poseMatrix({ translationMM: [NaN, 0], rotationRad: 0 }),
  /有限数/,
);
const cyclic = {
  nodes: {
    a: node('a', 'group', 'b', 0, 0, 0),
    b: node('b', 'group', 'a', 0, 0, 0),
  },
};
assert.throws(() => worldMatrix(cyclic, 'a'), /循环/);
assert.throws(() => worldMatrix(document, 'missing'), /不存在/);
console.log(
  'PASS: V4 rigid transforms, nested frames, reference spaces, shared datum frames and immutable inputs',
);
