import assert from 'node:assert/strict';
import {
  decodeDocument,
  encodeDocument,
} from '../../../src/lib/document/codec.mjs';
import { validateDocument } from '../../../src/lib/document/schema.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { createObjectTransformCommand } from '../../../src/lib/editing/commands/object-transform.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { worldMatrix } from '../../../src/lib/scene/transforms.mjs';
import { repeatedRingDocument } from '../fixtures/v4-programs.mjs';

const port = (ownerNodeId, operatorId, domain) => ({
  kind: 'port',
  ownerNodeId,
  operatorId,
  port: domain,
  domain,
});
const input = (ownerNodeId, operatorId, domain, transform) => ({
  ...port(ownerNodeId, operatorId, domain),
  space: 'local-result',
  transform,
});
const transform = (request) => createObjectTransformCommand(request);
const dispatch = (editor, request) =>
  editor.dispatch(transform(request), {
    expectedRevision: editor.state.revision,
  });
const assertScaledPoints = (actual, before, factor, message) => {
  assert.equal(actual.length, before.length, message);
  for (const [index, point] of actual.entries())
    for (const axis of [0, 1])
      assert.ok(
        Math.abs(point[axis] - before[index][axis] * factor) < 1e-9,
        message,
      );
};

const document = repeatedRingDocument();
document.nodes.group = {
  id: 'group',
  kind: 'group',
  name: '旋转组',
  parentId: null,
  order: 1,
  pose: { translationMM: [12, -4], rotationRad: Math.PI / 6 },
  visible: true,
  locked: false,
};
document.nodes.shape.parentId = 'group';
document.nodes.shape.pose = {
  translationMM: [3, 2],
  rotationRad: -Math.PI / 9,
};
const program = document.programs.program;
program.operators.transform = {
  id: 'transform',
  type: 'curve-transform',
  name: '位移曲线',
  enabled: true,
  inputs: {
    input: [
      {
        ...port('shape', 'source', 'curves'),
        space: 'world-result',
        transform: [0, 1, -1, 0, 1, 2],
      },
    ],
  },
  params: { transform: [1, 0, 0, 1, 3, -2] },
};
program.operators.mirror.inputs.input = [
  input('shape', 'transform', 'curves', [1, 0, 0, 1, 2, -1]),
];
program.operators.mirror.params.center = [2, 3];
program.operators.array.params.center = [4, -2];
program.operators.stroke = {
  id: 'stroke',
  type: 'stroke',
  name: '描边',
  enabled: true,
  inputs: { input: [input('shape', 'array', 'curves', [1, 0, 0, 1, 0, 0])] },
  params: { widthMM: 2 },
};
program.operators.offset = {
  id: 'offset',
  type: 'offset',
  name: '偏移',
  enabled: true,
  inputs: { input: [input('shape', 'stroke', 'regions', [1, 0, 0, 1, 0, 0])] },
  params: { distanceMM: 1, scope: { kind: 'all' } },
};
program.outputs.regions = port('shape', 'offset', 'regions');
document.sketches.sketch.vertices['continuity-end'] = {
  id: 'continuity-end',
  position: { kind: 'free', value: [12, 12] },
};
document.sketches.sketch.edges['continuity-edge'] = {
  id: 'continuity-edge',
  startVertexId: 'outer-b',
  endVertexId: 'continuity-end',
  startHandle: { kind: 'relation', relationId: 'smooth' },
  endHandle: { kind: 'free', vector: [0, 0] },
};
document.sketches.sketch.edges['outer-edge'].endHandle = {
  kind: 'free',
  vector: [2, 0],
};
document.sketches.sketch.vertices['inner-b'].position = {
  kind: 'relation',
  relationId: 'world-frame',
};
document.relations.smooth = {
  id: 'smooth',
  kind: 'handle-continuity',
  target: {
    kind: 'edge-end',
    sketchId: 'sketch',
    edgeId: 'continuity-edge',
    end: 'start',
  },
  source: {
    kind: 'edge-end',
    sketchId: 'sketch',
    edgeId: 'outer-edge',
    end: 'end',
  },
  mode: 'smooth',
  length: 3,
};
document.relations['world-frame'] = {
  id: 'world-frame',
  kind: 'coincident',
  target: { kind: 'vertex', sketchId: 'sketch', id: 'inner-b' },
  source: { kind: 'vertex', sketchId: 'sketch', id: 'inner-a' },
  offset: [1, -2],
  frame: { space: 'world', transform: [0, 1, -1, 0, 3, -4] },
};
validateDocument(document);
const before = structuredClone(document);
assert.equal(evaluateProgram(before, 'shape').regions.status, 'ready');
const beforeCurve = evaluateProgram(before, 'shape').curves.value.curves[0]
  .edges[0].cubic;

const moved = transform({
  nodeIds: ['group', 'shape'],
  mode: 'translate',
  deltaMM: [5, -7],
})(before).document;
assert.deepEqual(
  worldMatrix(moved, 'shape').slice(4),
  worldMatrix(before, 'shape')
    .slice(4)
    .map((value, axis) => value + [5, -7][axis]),
  'group-root translation moves the entire hierarchy once',
);

const rotated = transform({
  nodeIds: ['group'],
  mode: 'rotate',
  centerMM: [0, 0],
  angleRad: Math.PI / 2,
})(before).document;
const originalOrigin = worldMatrix(before, 'shape').slice(4);
assert.deepEqual(
  worldMatrix(rotated, 'shape')
    .slice(4)
    .map((value) => Number(value.toFixed(9))),
  [-originalOrigin[1], originalOrigin[0]].map((value) =>
    Number(value.toFixed(9)),
  ),
  'rotation uses the supplied world-space center',
);

const centerMM = [7, -5];
const scaled = transform({
  nodeIds: ['group'],
  mode: 'scale',
  centerMM,
  factor: 2,
})(before).document;
assert.deepEqual(
  scaled.sketches.sketch.vertices['outer-a'].position.value,
  [20, 0],
);
assert.deepEqual(
  scaled.sketches.sketch.edges['outer-edge'].startHandle.vector,
  [0, 0],
);
assert.deepEqual(program.operators.mirror.params.center, [2, 3]);
assert.deepEqual(
  scaled.programs.program.operators.mirror.params.center,
  [4, 6],
);
assert.deepEqual(
  scaled.programs.program.operators.array.params.center,
  [8, -4],
);
assert.deepEqual(
  scaled.programs.program.operators.transform.params.transform,
  [1, 0, 0, 1, 6, -4],
);
assert.deepEqual(
  scaled.programs.program.operators.transform.inputs.input[0].transform,
  [0, 1, -1, 0, 2, 4],
  'world-result affine keeps rotation and doubles its translation',
);
assert.deepEqual(
  scaled.programs.program.operators.mirror.inputs.input[0].transform,
  [1, 0, 0, 1, 4, -2],
);
assert.equal(scaled.programs.program.operators.stroke.params.widthMM, 4);
assert.equal(scaled.programs.program.operators.offset.params.distanceMM, 2);
assert.equal(scaled.relations.smooth.length, 6);
assert.deepEqual(scaled.relations['world-frame'].offset, [2, -4]);
assert.deepEqual(scaled.relations['world-frame'].frame, {
  space: 'world',
  transform: [0, 1, -1, 0, 6, -8],
});
const beforeOrigin = worldMatrix(before, 'shape').slice(4);
assert.deepEqual(
  worldMatrix(scaled, 'shape')
    .slice(4)
    .map((value) => Number(value.toFixed(9))),
  beforeOrigin
    .map((value, axis) => centerMM[axis] + (value - centerMM[axis]) * 2)
    .map((value) => Number(value.toFixed(9))),
  'all descendant node origins scale around one shared world center',
);
assert.equal(evaluateProgram(scaled, 'shape').regions.status, 'ready');
assertScaledPoints(
  evaluateProgram(scaled, 'shape').curves.value.curves[0].edges[0].cubic,
  beforeCurve,
  2,
  'same-selection world relation and world-result port remain scale-equivalent',
);
assert.deepEqual(decodeDocument(encodeDocument(scaled)), {
  document: scaled,
  assets: {},
});

let serial = 0;
const editor = createEditorSession(before, {
  idFactory: () => `object-${++serial}`,
});
dispatch(editor, { nodeIds: ['group'], mode: 'scale', centerMM, factor: 2 });
assert.equal(editor.state.revision, 1);
editor.undo({ expectedRevision: 1 });
assert.deepEqual(
  editor.state.document,
  before,
  'one undo restores the entire transform',
);

const locked = structuredClone(before);
locked.nodes.shape.locked = true;
const lockedBefore = structuredClone(locked);
assert.throws(
  () =>
    transform({ nodeIds: ['group'], mode: 'scale', centerMM, factor: 2 })(
      locked,
    ),
  /锁定/,
);
assert.deepEqual(locked, lockedBefore, 'rejected scale is atomic');
for (const request of [
  { nodeIds: ['group'], mode: 'scale', centerMM, factor: 0 },
  { nodeIds: ['group'], mode: 'scale', centerMM, factor: Infinity },
  { nodeIds: ['group'], mode: 'translate', deltaMM: [Infinity, 0] },
  { nodeIds: ['group'], mode: 'rotate', centerMM: [0, 0], angleRad: NaN },
])
  assert.throws(() => transform(request)(before), /对象变换/);

console.log(
  'PASS: V4 object transforms move/rotate rigid roots, scale grouped geometry and spatial programs, preserve serialization, and reject locked or invalid requests atomically.',
);
