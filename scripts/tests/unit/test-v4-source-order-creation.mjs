import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createAdvancedCommand } from '../../../src/lib/editing/commands/advanced.mjs';
import { createSourceCommand } from '../../../src/lib/editing/commands/source.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { orderedSourcePaths } from '../../../src/lib/geometry/source-order.mjs';

function fixture() {
  const document = createDocument({
    version: 4,
    id: 'source-order-creation-document',
    idFactory: () => 'source-order-creation-part',
  });
  for (const { suffix, nodeOrder, paths } of [
    {
      suffix: 'a',
      nodeOrder: 0,
      paths: [
        ['a-late', 2],
        ['a-first', 0],
      ],
    },
    {
      suffix: 'b',
      nodeOrder: 1,
      paths: [
        ['b-mid', 1],
        ['b-last', 3],
      ],
    },
  ]) {
    const nodeId = `shape-${suffix}`;
    const programId = `program-${suffix}`;
    const sketchId = `sketch-${suffix}`;
    document.nodes[nodeId] = {
      id: nodeId,
      kind: 'shape',
      name: nodeId,
      parentId: null,
      order: nodeOrder,
      pose: { translationMM: [nodeOrder, 0], rotationRad: 0 },
      visible: true,
      locked: false,
      programId,
    };
    document.programs[programId] = {
      id: programId,
      ownerNodeId: nodeId,
      operators: {},
      outputs: {},
    };
    document.sketches[sketchId] = {
      id: sketchId,
      ownerNodeId: nodeId,
      vertices: Object.fromEntries(
        paths.map(([pathId], index) => [
          `vertex-${pathId}`,
          {
            id: `vertex-${pathId}`,
            position: { kind: 'free', value: [nodeOrder, index] },
          },
        ]),
      ),
      edges: {},
      paths: Object.fromEntries(
        paths.map(([pathId, order]) => [
          pathId,
          {
            id: pathId,
            name: pathId,
            order,
            edges: [],
            startVertexId: `vertex-${pathId}`,
            visible: true,
          },
        ]),
      ),
    };
  }
  return document;
}

const editorFor = (document) => {
  let sequence = 0;
  return createEditorSession(document, {
    idFactory: () => `copy-order-${++sequence}`,
  });
};
const ordered = (document) =>
  orderedSourcePaths(document).map(({ sketch, path }) => ({
    sketchId: sketch.id,
    name: path.name,
    order: path.order,
  }));

const addDocument = fixture();
const addEditor = editorFor(addDocument);
addEditor.dispatch(
  createSourceCommand({
    kind: 'add-path',
    sketchId: 'sketch-a',
    pathId: 'added-path',
    name: 'added-path',
    edges: [],
    visible: true,
  }),
  { expectedRevision: addEditor.state.revision },
);
assert.deepEqual(
  ordered(addEditor.state.document).map((item) => item.name),
  ['a-first', 'b-mid', 'a-late', 'b-last', 'added-path'],
);
assert.equal(
  addEditor.state.document.sketches['sketch-a'].paths['added-path'].order,
  4,
);
addEditor.undo({ expectedRevision: addEditor.state.revision });
assert.deepEqual(addEditor.state.document, addDocument);

const copyDocument = fixture();
const originalSketches = structuredClone(copyDocument.sketches);
const copyEditor = editorFor(copyDocument);
copyEditor.dispatch(
  createAdvancedCommand({
    kind: 'copy-nodes',
    nodeIds: ['shape-a', 'shape-b'],
  }),
  { expectedRevision: copyEditor.state.revision },
);
const copiedOrder = ordered(copyEditor.state.document);
assert.deepEqual(
  copiedOrder.map(({ name, order }) => [name, order]),
  [
    ['a-first', 0],
    ['b-mid', 1],
    ['a-late', 2],
    ['b-last', 3],
    ['a-first', 4],
    ['b-mid', 5],
    ['a-late', 6],
    ['b-last', 7],
  ],
  'copied Paths append as one block in original global source order',
);
assert.deepEqual(
  copyEditor.state.document.sketches['sketch-a'],
  originalSketches['sketch-a'],
);
assert.deepEqual(
  copyEditor.state.document.sketches['sketch-b'],
  originalSketches['sketch-b'],
);
copyEditor.undo({ expectedRevision: copyEditor.state.revision });
assert.deepEqual(copyEditor.state.document, copyDocument);

const exhausted = fixture();
exhausted.sketches['sketch-b'].paths['b-last'].order = Number.MAX_VALUE;
const addExhausted = editorFor(exhausted);
const addBefore = addExhausted.state.document;
assert.throws(
  () =>
    addExhausted.dispatch(
      createSourceCommand({
        kind: 'add-path',
        sketchId: 'sketch-a',
        pathId: 'never-added',
        name: 'never-added',
        edges: [],
      }),
      { expectedRevision: addExhausted.state.revision },
    ),
  /超出可分配范围/,
);
assert.deepEqual(addExhausted.state.document, addBefore);
assert.equal(addExhausted.state.revision, 0);

const copyExhausted = editorFor(exhausted);
const copyBefore = copyExhausted.state.document;
assert.throws(
  () =>
    copyExhausted.dispatch(
      createAdvancedCommand({
        kind: 'copy-nodes',
        nodeIds: ['shape-a', 'shape-b'],
      }),
      { expectedRevision: copyExhausted.state.revision },
    ),
  /超出可分配范围/,
);
assert.deepEqual(copyExhausted.state.document, copyBefore);
assert.equal(copyExhausted.state.revision, 0);

console.log(
  'PASS add-path and multi-Sketch copy append stable source orders, undo once, and reject exhausted order allocation atomically',
);
