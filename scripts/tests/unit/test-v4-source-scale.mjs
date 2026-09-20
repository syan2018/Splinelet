import assert from 'node:assert/strict';
import {
  createDocument,
  validateDocument,
} from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createSourceScaleCommand } from '../../../src/lib/editing/commands/source-scale.mjs';
import { projectSourceView } from '../../../src/lib/editor/source-view.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { readGeometry } from '../../../src/lib/region-engine.mjs';
import { resolveScalar } from '../../../src/lib/geometry/parameters.mjs';
import {
  encodeDocument,
  decodeDocument,
} from '../../../src/lib/document/codec.mjs';

let serial = 0;
const idFactory = () => `scale-${++serial}`;
const editor = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
const dispatch = (command) =>
  editor.dispatch(command, { expectedRevision: editor.state.revision });
dispatch(
  createAuthoringCommand({
    kind: 'draw-path',
    closed: true,
    points: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
  }),
);
const initial = structuredClone(editor.state.document);
const owner = Object.values(initial.sketches)[0].ownerNodeId;
const program = initial.programs[initial.nodes[owner].programId];
program.operators.offset = {
  id: 'offset',
  type: 'offset',
  name: '2 mm',
  enabled: true,
  inputs: {
    input: [
      {
        ...program.outputs.regions,
        space: 'local-result',
        transform: [1, 0, 0, 1, 0, 0],
      },
    ],
  },
  params: { distanceMM: 2, scope: { kind: 'all' } },
};
program.outputs.regions = { ...program.outputs.regions, operatorId: 'offset' };
validateDocument(initial);
const bounds = (document) => {
  const stage = evaluateProgram(document, owner).regions;
  assert.equal(stage.status, 'ready');
  const envelope = readGeometry(
    stage.value.regions[0].geometry,
  ).getEnvelopeInternal();
  return [
    envelope.getMinX(),
    envelope.getMaxX(),
    envelope.getMinY(),
    envelope.getMaxY(),
  ];
};
assert.deepEqual(bounds(initial), [-2, 12, -2, 12]);
const scaled = createSourceScaleCommand({
  kind: 'calibrate-source-scale',
  factor: 2,
})(initial).document;
assert.deepEqual(
  bounds(scaled),
  [-2, 22, -2, 22],
  'offset remains 2 mm after source calibration',
);
for (const field of [
  'programs',
  'parameters',
  'geometrySettings',
  'reliefDefinitions',
  'manufacturing',
  'appearances',
  'assets',
  'collections',
])
  assert.deepEqual(scaled[field], initial[field], field);

// Nested poses and driven source coordinates must preserve their display pixels.
initial.nodes.group = {
  id: 'group',
  kind: 'group',
  name: 'group',
  parentId: null,
  order: 1,
  pose: { translationMM: [10, -3], rotationRad: 0.4 },
  visible: true,
  locked: true,
};
initial.nodes[owner].parentId = 'group';
initial.nodes[owner].pose = { translationMM: [4, 9], rotationRad: -0.2 };
initial.parameters.distance = {
  id: 'distance',
  name: 'distance',
  ownerNodeId: null,
  unit: 'mm',
  value: 2,
};
const scalar = { kind: 'parameter', id: 'distance' };
initial.datums.axis = {
  id: 'axis',
  name: 'axis',
  kind: 'axis',
  ownerNodeId: null,
  origin: [scalar, 3],
  angleRad: 0.6,
};
const sketch = Object.values(initial.sketches)[0];
const vertices = Object.values(sketch.vertices);
vertices[0].position = { kind: 'relation', relationId: 'axis-relation' };
initial.relations['axis-relation'] = {
  id: 'axis-relation',
  kind: 'point-on-axis',
  target: { kind: 'vertex', sketchId: sketch.id, id: vertices[0].id },
  axisId: 'axis',
  distance: scalar,
  frame: { space: 'world', transform: [1, 0, 0, 1, 2, -3] },
};
vertices[1].position = { kind: 'relation', relationId: 'coincident' };
initial.relations.coincident = {
  id: 'coincident',
  kind: 'coincident',
  target: { kind: 'vertex', sketchId: sketch.id, id: vertices[1].id },
  source: { kind: 'vertex', sketchId: sketch.id, id: vertices[0].id },
  offset: [scalar, 1],
  frame: { space: 'owner-local', transform: [0, 1, -1, 0, 4, 2] },
};
initial.assets.image = {
  id: 'image',
  path: 'assets/image.png',
  mediaType: 'image/png',
  size: 0,
  sha256: '0'.repeat(64),
};
initial.references.reference = {
  id: 'reference',
  assetId: 'image',
  name: 'image',
  pixelWidth: 100,
  pixelHeight: 100,
  pixelToWorld: [0.2, 0, 0, -0.2, -10, 10],
  visible: false,
  locked: true,
  opacity: 0.4,
};
validateDocument(initial);
const frame = { width: 100, height: 100, widthMM: 20 };
const beforeView = projectSourceView(initial, frame);
const after = createSourceScaleCommand({
  kind: 'calibrate-source-scale',
  factor: 2,
})(initial).document;
const afterView = projectSourceView(after, { ...frame, widthMM: 40 });
assert.deepEqual(afterView.paths, beforeView.paths);
assert.deepEqual(after.parameters, initial.parameters);
assert.equal(
  resolveScalar(after, after.relations['axis-relation'].distance).value,
  4,
);
assert.deepEqual(after.references.reference, {
  ...initial.references.reference,
  pixelToWorld: [0.4, 0, 0, -0.4, -20, 20],
});
const restored = createSourceScaleCommand({
  kind: 'calibrate-source-scale',
  factor: 0.5,
})(after).document;
assert.deepEqual(
  restored,
  initial,
  'repeated calibration simplifies scalar wrappers',
);

for (const mode of ['smooth', 'symmetric', 'auto']) {
  const related = structuredClone(initial);
  const edges = Object.values(related.sketches[sketch.id].edges);
  edges[0].endHandle = { kind: 'free', vector: [2, 3] };
  edges[1].startHandle = { kind: 'relation', relationId: 'continuity' };
  related.relations.continuity = {
    id: 'continuity',
    kind: 'handle-continuity',
    target: {
      kind: 'edge-end',
      sketchId: sketch.id,
      edgeId: edges[1].id,
      end: 'start',
    },
    source: {
      kind: 'edge-end',
      sketchId: sketch.id,
      edgeId: edges[0].id,
      end: 'end',
    },
    mode,
    ...(mode === 'smooth' ? { length: scalar } : {}),
  };
  validateDocument(related);
  const recalibrated = createSourceScaleCommand({
    kind: 'calibrate-source-scale',
    factor: 2,
  })(related).document;
  const originalView = projectSourceView(related, frame);
  assert.equal(
    originalView.paths.length,
    1,
    'relation fixture must project an editable path',
  );
  assert.deepEqual(
    projectSourceView(recalibrated, { ...frame, widthMM: 40 }).paths,
    originalView.paths,
    mode,
  );
  // A reference-free file still preserves all source expressions exactly.
  recalibrated.assets = {};
  recalibrated.references = {};
  assert.deepEqual(
    decodeDocument(encodeDocument(recalibrated)).document,
    recalibrated,
  );
}

dispatch(() => ({ document: initial, changedRefs: [] }));
const before = structuredClone(editor.state.document);
const revision = editor.state.revision;
dispatch(createAuthoringCommand({ kind: 'calibrate-source-scale', factor: 1 }));
assert.equal(editor.state.revision, revision);
dispatch(createAuthoringCommand({ kind: 'calibrate-source-scale', factor: 2 }));
assert.equal(editor.state.revision, revision + 1);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, before);
for (const factor of [0, -1, Infinity, NaN, Number.MAX_VALUE]) {
  const state = editor.state;
  assert.throws(() =>
    dispatch(
      createAuthoringCommand({ kind: 'calibrate-source-scale', factor }),
    ),
  );
  assert.deepEqual(
    editor.state,
    state,
    'invalid and overflowing calibration is atomic',
  );
}
console.log(
  'V4 source calibration preserves physical construction parameters and source display: PASS',
);
