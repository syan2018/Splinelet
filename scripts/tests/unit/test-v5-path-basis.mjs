import assert from 'node:assert/strict';
import {
  createDocument,
  validateDocument,
} from '../../../src/lib/document/schema.mjs';
import { createPathMergeCommand } from '../../../src/lib/editing/commands/path-merge.mjs';
import { createPathNodeDeletionCommand } from '../../../src/lib/editing/commands/path-node-deletion.mjs';
import { createPathReplacementCommand } from '../../../src/lib/editing/commands/path-replacement.mjs';
import { extendPath } from '../../../src/lib/geometry/extend-path.mjs';
import {
  initializeDocumentBasis,
  initializePathBasis,
  withBasisPieces,
} from '../../../src/lib/geometry/path-basis.mjs';
import { editSketch } from '../../../src/lib/geometry/sketch-edit.mjs';
import { resolveSketch } from '../../../src/lib/geometry/sketch.mjs';
import { createPathIntent } from '../../../src/lib/editor/path-intents.mjs';
import { projectSourceView } from '../../../src/lib/editor/source-view.mjs';

const edge = (id, startVertexId, endVertexId) => ({
  id,
  startVertexId,
  endVertexId,
  startHandle: { kind: 'free', vector: [0, 0] },
  endHandle: { kind: 'free', vector: [0, 0] },
});

const documentWithPaths = (paths) => {
  const document = createDocument({ version: 5 });
  document.nodes.owner = {
    id: 'owner',
    kind: 'shape',
    name: 'basis',
    parentId: null,
    order: 0,
    pose: { translationMM: [0, 0], rotationRad: 0 },
    visible: true,
    locked: false,
    programId: 'program',
  };
  document.programs.program = {
    id: 'program',
    ownerNodeId: 'owner',
    operators: {},
    outputs: {},
  };
  const vertices = {};
  const edges = {};
  for (const path of paths) {
    for (const [id, point] of Object.entries(path.vertices))
      vertices[id] = {
        id,
        position: { kind: 'free', value: [...point] },
      };
    for (const [id, [start, end]] of Object.entries(path.edges))
      edges[id] = edge(id, start, end);
  }
  document.sketches.sketch = {
    id: 'sketch',
    ownerNodeId: 'owner',
    vertices,
    edges,
    paths: Object.fromEntries(
      paths.map((path) => [
        path.id,
        {
          id: path.id,
          name: path.id,
          edges: path.uses.map(([edgeId, reversed]) => ({ edgeId, reversed })),
          visible: true,
        },
      ]),
    ),
  };
  initializeDocumentBasis(document);
  validateDocument(document);
  return document;
};

assert.deepEqual(
  withBasisPieces(
    { version: 5 },
    { id: 'affine' },
    { edgeId: 'affine-edge', reversed: false },
    [
      { t: [0, 0.5], basisId: 'affine', span: [0, 1] },
      { t: [0.5, 1], basisId: 'affine', span: [1, 2] },
    ],
  ),
  { edgeId: 'affine-edge', reversed: false, basisSpan: [0, 2] },
  'adjacent pieces compact only when they are the same affine map',
);

const line = documentWithPaths([
  {
    id: 'path',
    vertices: { v0: [0, 0], v1: [10, 0], v2: [20, 0] },
    edges: { e0: ['v0', 'v1'], e1: ['v1', 'v2'] },
    uses: [
      ['e0', false],
      ['e1', false],
    ],
  },
]);
const path = () => line.sketches.sketch.paths.path;
assert.deepEqual(
  path().edges.map((use) => use.basisSpan),
  [
    [0, 1],
    [1, 2],
  ],
);

const reversed = editSketch(line, {
  kind: 'reverse-path',
  sketchId: 'sketch',
  pathId: 'path',
});
assert.deepEqual(reversed.document.sketches.sketch.paths.path.edges, [
  { edgeId: 'e1', reversed: true, basisSpan: [2, 1] },
  { edgeId: 'e0', reversed: true, basisSpan: [1, 0] },
]);
const resolved = resolveSketch(reversed.document, 'sketch');
assert.equal(resolved.status, 'ready');
assert.deepEqual(resolved.value.curves[0].edges[0].logicalSource, {
  sketchId: 'sketch',
  pathId: 'path',
});
assert.deepEqual(resolved.value.curves[0].edges[0].basisSpan, [2, 1]);
assert.equal('basisPeriod' in resolved.value.curves[0].edges[0], false);

const split = editSketch(reversed.document, {
  kind: 'split-edge',
  sketchId: 'sketch',
  edgeId: 'e1',
  t: 0.25,
  vertexId: 'split-v',
  secondEdgeId: 'split-e',
});
assert.deepEqual(split.document.sketches.sketch.paths.path.edges.slice(0, 2), [
  { edgeId: 'split-e', reversed: true, basisSpan: [2, 1.25] },
  { edgeId: 'e1', reversed: true, basisSpan: [1.25, 1] },
]);

const extended = documentWithPaths([
  {
    id: 'open',
    vertices: { a: [0, 0], b: [10, 0] },
    edges: { ab: ['a', 'b'] },
    uses: [['ab', false]],
  },
]);
let extensionId = 0;
const extendId = () => 'extension-' + ++extensionId;
extendPath(
  extended,
  {
    sketchId: 'sketch',
    pathId: 'open',
    end: 'end',
    cubic: [
      [10, 0],
      [13, 0],
      [17, 0],
      [20, 0],
    ],
  },
  { idFactory: extendId },
);
assert.deepEqual(
  extended.sketches.sketch.paths.open.edges.at(-1).basisSpan,
  [1, 2],
);
extendPath(
  extended,
  { sketchId: 'sketch', pathId: 'open', end: 'end', close: true },
  { idFactory: extendId },
);
assert.deepEqual(
  extended.sketches.sketch.paths.open.edges.at(-1).basisSpan,
  [2, 3],
);
assert.equal(extended.sketches.sketch.paths.open.basisPeriod, 3);
validateDocument(extended);

const closed = documentWithPaths([
  {
    id: 'ring',
    vertices: { p0: [0, 0], p1: [1, 0], p2: [1, 1], p3: [0, 1] },
    edges: {
      r0: ['p0', 'p1'],
      r1: ['p1', 'p2'],
      r2: ['p2', 'p3'],
      r3: ['p3', 'p0'],
    },
    uses: [
      ['r0', false],
      ['r1', false],
      ['r2', false],
      ['r3', false],
    ],
  },
]);
assert.equal(closed.sketches.sketch.paths.ring.basisPeriod, 4);
const deleted = createPathNodeDeletionCommand({
  kind: 'delete-path-vertices',
  pathRef: { kind: 'path', sketchId: 'sketch', id: 'ring' },
  vertexIds: ['p0'],
  expectedEdges: structuredClone(closed.sketches.sketch.paths.ring.edges),
  toleranceMM: 1,
})(closed, { idFactory: () => 'merged' }).document;
assert.deepEqual(
  deleted.sketches.sketch.paths.ring.edges.map((use) => use.basisSpan),
  [
    [1, 2],
    [2, 3],
    [3, 5],
  ],
);
assert.equal(deleted.sketches.sketch.paths.ring.basisPeriod, 4);
validateDocument(deleted);

const replacement = documentWithPaths([
  {
    id: 'replace',
    vertices: { x0: [0, 0], x1: [5, 0], x2: [10, 0] },
    edges: { x01: ['x0', 'x1'], x12: ['x1', 'x2'] },
    uses: [
      ['x01', false],
      ['x12', false],
    ],
  },
]);
let replacementId = 0;
const replaced = createPathReplacementCommand({
  kind: 'replace-path-geometry',
  pathRef: { kind: 'path', sketchId: 'sketch', id: 'replace' },
  expectedEdges: structuredClone(
    replacement.sketches.sketch.paths.replace.edges,
  ),
  cubics: [
    [
      [0, 0],
      [10 / 3, 0],
      [20 / 3, 0],
      [10, 0],
    ],
  ],
  closed: false,
  basisPieceMapping: [
    [
      { sourceUseIndex: 0, sourceT: [0, 1], t: [0, 0.25] },
      { sourceUseIndex: 1, sourceT: [0, 1], t: [0.25, 1] },
    ],
  ],
})(replacement, { idFactory: () => 'replacement-' + ++replacementId }).document;
assert.deepEqual(replaced.sketches.sketch.paths.replace.edges[0].basisPieces, [
  { t: [0, 0.25], basisId: 'replace', span: [0, 1] },
  { t: [0.25, 1], basisId: 'replace', span: [1, 2] },
]);
validateDocument(replaced);
const nonUniformUse = replaced.sketches.sketch.paths.replace.edges[0];
const splitNonUniform = editSketch(replaced, {
  kind: 'split-edge',
  sketchId: 'sketch',
  edgeId: nonUniformUse.edgeId,
  t: 0.5,
  vertexId: 'non-uniform-split-vertex',
  secondEdgeId: 'non-uniform-split-edge',
}).document;
assert.deepEqual(
  splitNonUniform.sketches.sketch.paths.replace.edges[0].basisPieces,
  [
    { t: [0, 0.5], basisId: 'replace', span: [0, 1] },
    { t: [0.5, 1], basisId: 'replace', span: [1, 4 / 3] },
  ],
);
const deletedNonUniform = createPathNodeDeletionCommand({
  kind: 'delete-path-vertices',
  pathRef: { kind: 'path', sketchId: 'sketch', id: 'replace' },
  vertexIds: ['non-uniform-split-vertex'],
  expectedEdges: structuredClone(
    splitNonUniform.sketches.sketch.paths.replace.edges,
  ),
  toleranceMM: 1,
})(splitNonUniform, { idFactory: () => 'non-uniform-delete' }).document;
assert.deepEqual(
  deletedNonUniform.sketches.sketch.paths.replace.edges[0].basisPieces,
  [
    { t: [0, 0.25], basisId: 'replace', span: [0, 1] },
    { t: [0.25, 0.5], basisId: 'replace', span: [1, 4 / 3] },
    { t: [0.5, 1], basisId: 'replace', span: [4 / 3, 2] },
  ],
  'deleting a split node retains the explicit non-uniform source map without rewriting it linearly',
);
validateDocument(deletedNonUniform);

const merge = documentWithPaths([
  {
    id: 'first',
    vertices: { f0: [0, 0], f1: [1, 0] },
    edges: { f: ['f0', 'f1'] },
    uses: [['f', false]],
  },
  {
    id: 'second',
    vertices: { s0: [3, 0], s1: [4, 0] },
    edges: { s: ['s0', 's1'] },
    uses: [['s', false]],
  },
]);
let mergeId = 0;
const merged = createPathMergeCommand({
  kind: 'merge-paths',
  firstPathRef: { kind: 'path', sketchId: 'sketch', id: 'first' },
  firstEnd: 'end',
  secondPathRef: { kind: 'path', sketchId: 'sketch', id: 'second' },
  secondEnd: 'start',
})(merge, {
  idFactory: () => ['bridge-edge', 'bridge-basis'][mergeId++],
}).document;
const mergedPath = merged.sketches.sketch.paths.first;
assert.deepEqual(
  mergedPath.edges.map((use) => [use.edgeId, use.basisId, use.basisSpan]),
  [
    ['f', 'first', [0, 1]],
    ['bridge-edge', 'bridge-basis', [0, 1]],
    ['s', 'second', [0, 1]],
  ],
);
assert.deepEqual(mergedPath.basisCatalog, {
  first: {},
  'bridge-basis': {},
  second: {},
});
assert.equal('basisPeriod' in mergedPath, false);
const mergedResolved = resolveSketch(merged, 'sketch');
assert.deepEqual(
  mergedResolved.value.curves[0].edges.map((item) => item.logicalSource.pathId),
  ['first', 'bridge-basis', 'second'],
);
const deletedComposite = createPathNodeDeletionCommand({
  kind: 'delete-path-vertices',
  pathRef: { kind: 'path', sketchId: 'sketch', id: 'first' },
  vertexIds: ['f1'],
  expectedEdges: structuredClone(mergedPath.edges),
  toleranceMM: 1,
})(merged, { idFactory: () => 'composite-delete' }).document;
const compositeUse = deletedComposite.sketches.sketch.paths.first.edges[0];
assert.deepEqual(compositeUse.basisPieces, [
  { t: [0, 0.5], basisId: 'first', span: [0, 1] },
  { t: [0.5, 1], basisId: 'bridge-basis', span: [0, 1] },
]);
const deletedResolved = resolveSketch(deletedComposite, 'sketch');
assert.equal(
  deletedResolved.status,
  'ready',
  JSON.stringify(deletedResolved.diagnostics),
);
assert.deepEqual(
  deletedResolved.value.curves[0].edges.map((item) => [
    item.source,
    item.logicalSource.pathId,
    item.basisSpan,
  ]),
  [
    [
      { kind: 'edge', sketchId: 'sketch', id: 'composite-delete' },
      'first',
      [0, 1],
    ],
    [
      { kind: 'edge', sketchId: 'sketch', id: 'composite-delete' },
      'bridge-basis',
      [0, 1],
    ],
    [{ kind: 'edge', sketchId: 'sketch', id: 's' }, 'second', [0, 1]],
  ],
);
const source = projectSourceView(deletedComposite, {
  width: 100,
  height: 100,
  widthMM: 10,
});
const sourcePath = source.paths.find((item) => item.id.includes(':first'));
const replacementIntent = createPathIntent(
  {
    kind: 'replace-path-geometry',
    pathId: sourcePath.id,
    pixelCubics: [
      [
        sourcePath.curves[0][0],
        sourcePath.curves[0][1],
        sourcePath.curves.at(-1)[2],
        sourcePath.curves.at(-1)[3],
      ],
    ],
    closed: false,
  },
  { epoch: 'basis', revision: 1, previewId: null, source },
);
let intentReplacementId = 0;
const intentReplaced = replacementIntent(deletedComposite, {
  epoch: 'basis',
  revision: 1,
  idFactory: () => `intent-replacement-${++intentReplacementId}`,
}).document;
assert.deepEqual(
  intentReplaced.sketches.sketch.paths.first.edges[0].basisPieces,
  [
    { t: [0, 0.25], basisId: 'first', span: [0, 1] },
    { t: [0.25, 0.5], basisId: 'bridge-basis', span: [0, 1] },
    { t: [0.5, 1], basisId: 'second', span: [0, 1] },
  ],
);
const reverseDeletedComposite = editSketch(deletedComposite, {
  kind: 'reverse-path',
  sketchId: 'sketch',
  pathId: 'first',
});
assert.deepEqual(
  reverseDeletedComposite.document.sketches.sketch.paths.first.edges.at(-1)
    .basisPieces,
  [
    { t: [0, 0.5], basisId: 'bridge-basis', span: [1, 0] },
    { t: [0.5, 1], basisId: 'first', span: [1, 0] },
  ],
);
const splitComposite = editSketch(deletedComposite, {
  kind: 'split-edge',
  sketchId: 'sketch',
  edgeId: 'composite-delete',
  t: 0.5,
  vertexId: 'composite-split-vertex',
  secondEdgeId: 'composite-split-edge',
});
assert.deepEqual(
  splitComposite.document.sketches.sketch.paths.first.edges.slice(0, 2),
  [
    { edgeId: 'composite-delete', reversed: false, basisSpan: [0, 1] },
    {
      edgeId: 'composite-split-edge',
      reversed: false,
      basisSpan: [0, 1],
      basisId: 'bridge-basis',
    },
  ],
);
let closeId = 0;
const closedComposite = structuredClone(merged);
extendPath(
  closedComposite,
  { sketchId: 'sketch', pathId: 'first', end: 'end', close: true },
  {
    idFactory: () =>
      ['composite-close-edge', 'composite-close-basis'][closeId++],
  },
);
const compositeCloseUse =
  closedComposite.sketches.sketch.paths.first.edges.at(-1);
assert.deepEqual(compositeCloseUse, {
  edgeId: 'composite-close-edge',
  reversed: false,
  basisId: 'composite-close-basis',
  basisSpan: [0, 1],
});
assert.equal(
  closedComposite.sketches.sketch.paths.first.basisCatalog[
    'composite-close-basis'
  ].period,
  undefined,
);
assert.equal(
  'basisPeriod' in closedComposite.sketches.sketch.paths.first,
  false,
);
validateDocument(closedComposite);
const reverseComposite = editSketch(merged, {
  kind: 'reverse-path',
  sketchId: 'sketch',
  pathId: 'first',
});
assert.deepEqual(
  reverseComposite.document.sketches.sketch.paths.first.edges.map((use) => [
    use.basisId,
    use.basisSpan,
  ]),
  [
    ['second', [1, 0]],
    ['bridge-basis', [1, 0]],
    ['first', [1, 0]],
  ],
);

const initialized = {
  edges: [
    { edgeId: 'left', reversed: false },
    { edgeId: 'right', reversed: false },
  ],
};
initializePathBasis(
  {
    edges: {
      left: edge('left', 'a', 'b'),
      right: edge('right', 'b', 'a'),
    },
  },
  initialized,
);
assert.deepEqual(
  initialized.edges.map((use) => use.basisSpan),
  [
    [0, 1],
    [1, 2],
  ],
);
assert.equal(initialized.basisPeriod, 2);

console.log(
  'PASS: V5 path basis persists deterministic source spans through reverse, split, extend, close, delete, replacement, resolve, and composite merge.',
);
