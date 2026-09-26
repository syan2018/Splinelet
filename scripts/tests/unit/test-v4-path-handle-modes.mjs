import assert from 'node:assert/strict';
import {
  createDocument,
  inspectDocumentReferences,
  validateDocument,
} from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createSourceCommand } from '../../../src/lib/editing/commands/source.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { editSketch } from '../../../src/lib/geometry/sketch-edit.mjs';
import { resolveSketch } from '../../../src/lib/geometry/sketch.mjs';
import { copyNodes } from '../../../src/lib/scene/ownership.mjs';

const close = (actual, expected, epsilon = 1e-9) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) =>
    assert.ok(
      Math.abs(value - expected[index]) <= epsilon,
      `${actual} != ${expected}`,
    ),
  );
};

const document = createDocument({
  version: 4,
  id: 'mode-document',
  idFactory: () => 'part',
});
document.nodes.shape = {
  id: 'shape',
  kind: 'shape',
  name: '曲线',
  parentId: null,
  order: 0,
  pose: { translationMM: [0, 0], rotationRad: 0 },
  visible: true,
  locked: false,
  programId: 'program',
};
document.programs.program = {
  id: 'program',
  ownerNodeId: 'shape',
  operators: {},
  outputs: {},
};
document.sketches.sketch = {
  id: 'sketch',
  ownerNodeId: 'shape',
  vertices: {
    a: { id: 'a', position: { kind: 'free', value: [0, 0] } },
    b: { id: 'b', position: { kind: 'free', value: [10, 0] } },
    c: { id: 'c', position: { kind: 'free', value: [20, 5] } },
  },
  edges: {
    left: {
      id: 'left',
      startVertexId: 'a',
      endVertexId: 'b',
      startHandle: { kind: 'free', vector: [0, 0] },
      endHandle: { kind: 'free', vector: [-2, 0] },
    },
    right: {
      id: 'right',
      startVertexId: 'b',
      endVertexId: 'c',
      startHandle: { kind: 'free', vector: [4, 2] },
      endHandle: { kind: 'free', vector: [0, 0] },
    },
  },
  paths: {
    path: {
      id: 'path',
      name: '开放路径',
      edges: [
        { edgeId: 'left', reversed: false },
        { edgeId: 'right', reversed: false },
      ],
      visible: true,
    },
  },
};
validateDocument(document);

const annotated = structuredClone(document);
annotated.sketches.sketch.paths.path.handleModes = { b: 'smooth' };
validateDocument(annotated);
assert.deepEqual(
  resolveSketch(annotated, 'sketch'),
  resolveSketch(document, 'sketch'),
  'stored editing modes do not alter initial Sketch evaluation',
);
const cornerOnly = editSketch(annotated, {
  kind: 'set-path-handle-mode',
  sketchId: 'sketch',
  pathId: 'path',
  vertexId: 'b',
  mode: 'corner',
}).document;
assert.equal(cornerOnly.sketches.sketch.paths.path.handleModes, undefined);
assert.deepEqual(
  cornerOnly.sketches.sketch.edges,
  annotated.sketches.sketch.edges,
  'corner changes only the stored editing mode',
);
const invalidMode = structuredClone(document);
invalidMode.sketches.sketch.paths.path.handleModes = { a: 'automatic' };
assert.throws(() => validateDocument(invalidMode), /handleModes 模式无效/);
const unrelatedVertex = structuredClone(document);
unrelatedVertex.sketches.sketch.vertices.unused = {
  id: 'unused',
  position: { kind: 'free', value: [30, 0] },
};
unrelatedVertex.sketches.sketch.paths.path.handleModes = { unused: 'smooth' };
validateDocument(unrelatedVertex);
assert.ok(
  inspectDocumentReferences(unrelatedVertex).some(
    (diagnostic) =>
      diagnostic.kind === 'invalid-reference' &&
      diagnostic.message.includes('不属于路径'),
  ),
);
const missingModeVertex = structuredClone(document);
missingModeVertex.sketches.sketch.paths.path.handleModes = { ghost: 'smooth' };
validateDocument(missingModeVertex);
assert.ok(
  inspectDocumentReferences(missingModeVertex).some(
    (diagnostic) =>
      diagnostic.kind === 'unresolved-reference' &&
      diagnostic.message.includes('ghost'),
  ),
);
const danglingDefinition = structuredClone(document);
danglingDefinition.sketches.sketch.paths.path.handleModes = { a: 'smooth' };
const danglingModePath = editSketch(danglingDefinition, {
  kind: 'remove-edge',
  sketchId: 'sketch',
  edgeId: 'left',
  updatePaths: false,
}).document;
assert.deepEqual(danglingModePath.sketches.sketch.paths.path.handleModes, {
  a: 'smooth',
});
assert.ok(
  inspectDocumentReferences(danglingModePath).some(
    (diagnostic) =>
      diagnostic.kind === 'unresolved-reference' &&
      diagnostic.message === 'Path edgeId 不存在',
  ),
);
assert.ok(
  inspectDocumentReferences(danglingModePath).some(
    (diagnostic) =>
      diagnostic.kind === 'invalid-reference' &&
      diagnostic.message.includes('a'),
  ),
);

let serial = 0;
const editor = createEditorSession(document, {
  idFactory: () => `mode-${++serial}`,
});
const run = (action) =>
  editor.dispatch(createSourceCommand(action), {
    expectedRevision: editor.state.revision,
  });
const path = () => editor.state.document.sketches.sketch.paths.path;
const edge = (id) => editor.state.document.sketches.sketch.edges[id];

run({
  kind: 'set-path-handle-mode',
  sketchId: 'sketch',
  pathId: 'path',
  vertexId: 'b',
  mode: 'smooth',
});
assert.equal(path().handleModes.b, 'smooth');
close(edge('left').endHandle.vector, [-4 / Math.sqrt(5), -2 / Math.sqrt(5)]);
assert.deepEqual(edge('right').startHandle.vector, [4, 2]);

run({
  kind: 'move-path-handle',
  sketchId: 'sketch',
  pathId: 'path',
  edgeId: 'left',
  end: 'end',
  vector: [-3, 0],
});
assert.deepEqual(edge('left').endHandle.vector, [-3, 0]);
close(edge('right').startHandle.vector, [Math.sqrt(20), 0]);

run({
  kind: 'set-path-handle-mode',
  sketchId: 'sketch',
  pathId: 'path',
  vertexId: 'b',
  mode: 'symmetric',
});
close(edge('left').endHandle.vector, [-Math.sqrt(20), 0]);
run({
  kind: 'move-path-handle',
  sketchId: 'sketch',
  pathId: 'path',
  edgeId: 'right',
  end: 'start',
  vector: [2, 3],
});
close(edge('left').endHandle.vector, [-2, -3]);

run({
  kind: 'set-path-handle-mode',
  sketchId: 'sketch',
  pathId: 'path',
  vertexId: 'b',
  mode: 'smooth',
});
run({
  kind: 'move-path-handle',
  sketchId: 'sketch',
  pathId: 'path',
  edgeId: 'right',
  end: 'start',
  vector: [0, 0],
});
assert.deepEqual(edge('right').startHandle.vector, [0, 0]);
close(edge('left').endHandle.vector, [-2, -3]);
assert.equal(path().handleModes.b, 'smooth');
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(edge('right').startHandle.vector, [2, 3]);
close(edge('left').endHandle.vector, [-2, -3]);

run({
  kind: 'set-continuity',
  source: {
    kind: 'edge-end',
    sketchId: 'sketch',
    edgeId: 'left',
    end: 'end',
  },
  target: {
    kind: 'edge-end',
    sketchId: 'sketch',
    edgeId: 'right',
    end: 'start',
  },
  mode: 'symmetric',
});
const relationSnapshot = structuredClone(editor.state.document);
assert.throws(
  () =>
    run({
      kind: 'move-path-handle',
      sketchId: 'sketch',
      pathId: 'path',
      edgeId: 'left',
      end: 'end',
      vector: [-5, 0],
    }),
  /Relation/,
);
assert.deepEqual(editor.state.document, relationSnapshot);
assert.throws(
  () =>
    run({
      kind: 'set-path-handle-mode',
      sketchId: 'sketch',
      pathId: 'path',
      vertexId: 'b',
      mode: 'symmetric',
    }),
  /Relation/,
);
assert.deepEqual(editor.state.document, relationSnapshot);
editor.undo({ expectedRevision: editor.state.revision });

run({
  kind: 'set-path-handle-mode',
  sketchId: 'sketch',
  pathId: 'path',
  vertexId: 'b',
  mode: 'symmetric',
});
run({
  kind: 'split-edge',
  sketchId: 'sketch',
  edgeId: 'left',
  t: 0.5,
  vertexId: 'mid',
  secondEdgeId: 'split',
});
assert.equal(path().handleModes.mid, 'smooth');
assert.equal(path().handleModes.b, 'smooth');
const modesBeforeReverse = structuredClone(path().handleModes);
run({
  kind: 'reverse-path',
  sketchId: 'sketch',
  pathId: 'path',
});
assert.deepEqual(path().handleModes, modesBeforeReverse);
run({
  kind: 'remove-edge',
  sketchId: 'sketch',
  edgeId: 'split',
  updatePaths: true,
});
assert.equal(path().handleModes, undefined);

editor.dispatch(
  createAuthoringCommand({
    kind: 'set-node',
    nodeId: 'shape',
    value: { locked: true },
  }),
  { expectedRevision: editor.state.revision },
);
assert.throws(
  () =>
    run({
      kind: 'move-path-handle',
      sketchId: 'sketch',
      pathId: 'path',
      edgeId: 'left',
      end: 'start',
      vector: [1, 0],
    }),
  /锁定/,
);

const ambiguous = structuredClone(document);
ambiguous.sketches.sketch.paths.path.edges.push({
  edgeId: 'left',
  reversed: true,
});
assert.throws(
  () =>
    editSketch(ambiguous, {
      kind: 'move-path-handle',
      sketchId: 'sketch',
      pathId: 'path',
      edgeId: 'left',
      end: 'end',
      vector: [-1, 0],
    }),
  /多次出现|语义不明确/,
);

let copySerial = 0;
const copied = copyNodes(annotated, ['shape'], {
  idFactory: () => `copy-${++copySerial}`,
});
const copiedSketch = copied.document.sketches[copied.idMap.sketch];
const copiedPath = copiedSketch.paths[copied.idMap.path];
assert.deepEqual(copiedPath.handleModes, { [copied.idMap.b]: 'smooth' });
assert.equal(annotated.sketches.sketch.paths.path.handleModes.b, 'smooth');

console.log(
  'PASS V4 path handle modes preserve stable vertex identity, bidirectional smooth/symmetric edits, topology maintenance, relation safety, locking, copy, and undo',
);
