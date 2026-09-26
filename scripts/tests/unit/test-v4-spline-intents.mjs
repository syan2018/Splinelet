import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createStudioSession } from '../../../src/lib/editor/studio-session.mjs';
import { inspectSplines } from '../../../src/lib/source-editor/spline-edit.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { regionPathUses } from '../../../src/lib/editing/region-drawing.mjs';

let serial = 0;
const idFactory = () => `spline-${++serial}`;
const session = createStudioSession({
  opened: {
    kind: 'v4',
    document: createDocument({ version: 4, idFactory }),
    assets: {},
    target: null,
  },
  presentation: {
    reference: null,
    frame: { width: 800, height: 600, widthMM: 100 },
    fileName: null,
    blenderExtrusionMM: 2,
  },
  persistence: { writeFile: async () => {} },
  idFactory,
});
const snapshot = () => session.getSnapshot();
const run = (request) => {
  const captured = snapshot();
  const result = captured.runtime
    .commandSplines(request, { project: captured.project })
    .commit();
  assert.equal(
    snapshot().editorState.revision,
    captured.editorState.revision + 1,
  );
  return result;
};
const square = (size) =>
  [
    [-size, -size],
    [size, -size],
    [size, size],
    [-size, size],
  ].map(([x, y]) => ({ co: { x, y } }));
const empty = snapshot().editorState.document;
const first = run({
  units: 'model',
  splines: [
    { closed: true, nodes: square(20), name: '边界' },
    {
      closed: false,
      nodes: [
        { co: { x: 1, y: 2 }, handleRight: { x: -4, y: 8 } },
        { co: { x: 9, y: 6 }, handleLeft: { x: 12, y: -3 } },
      ],
    },
  ],
});
assert.equal(first.pathIds.length, 2);
const owner = first.project.paths.find(
  (p) => p.id === first.pathIds[0],
).ownerNodeId;
const original = snapshot().editorState.document;
const request = {
  units: 'model',
  splines: [{ id: first.pathIds[1], matrix: [0, 1, -1, 0, 2, 3] }],
};
const expectedNodes = inspectSplines(first.project, {
  pathIds: [first.pathIds[1]],
  units: 'model',
}).splines[0].nodes.map((node) =>
  Object.fromEntries(
    Object.entries(node).map(([key, p]) => [key, { x: -p.y + 2, y: p.x + 3 }]),
  ),
);
const moved = run(request);
assert.deepEqual(moved.pathIds, [first.pathIds[1]]);
const actualNodes = inspectSplines(moved.project, {
  pathIds: moved.pathIds,
  units: 'model',
}).splines[0].nodes;
actualNodes.forEach((n, i) =>
  Object.keys(n).forEach((key) => {
    assert.ok(Math.abs(n[key].x - expectedNodes[i][key].x) < 1e-8);
    assert.ok(Math.abs(n[key].y - expectedNodes[i][key].y) < 1e-8);
  }),
);
session.undo();
assert.deepEqual(snapshot().editorState.document, original);
const initialRegions = evaluateProgram(original, owner).regions;
const guide = run({
  units: 'model',
  objectId: owner,
  splines: [{ closed: true, nodes: square(30), role: 'guide' }],
});
assert.deepEqual(
  evaluateProgram(snapshot().editorState.document, owner).regions,
  initialRegions,
);
const beforeHole = snapshot().editorState.document;
const hole = run({
  units: 'model',
  objectId: owner,
  splines: [{ closed: true, nodes: square(5), role: 'hole' }],
});
assert.equal(hole.pathIds.length, 1);
assert.equal(hole.project.paths.length, 4);
const afterHole = evaluateProgram(
  snapshot().editorState.document,
  owner,
).regions;
assert.equal(afterHole.status, 'ready');
assert.notDeepEqual(afterHole.value, initialRegions.value);
session.undo();
assert.deepEqual(snapshot().editorState.document, beforeHole);

// A boundary added after a closed guide must not implicitly fill that guide.
const extra = run({
  units: 'model',
  objectId: owner,
  splines: [{ closed: true, nodes: square(10), role: 'boundary' }],
});
assert.equal(extra.pathIds.length, 1);
const guideView = snapshot().runtime.readSourceView(snapshot().project);
assert.deepEqual(
  regionPathUses(
    snapshot().editorState.document,
    guideView.source.identities.byId[guide.pathIds[0]],
  ),
  [],
);
assert.equal(
  evaluateProgram(snapshot().editorState.document, owner).regions.status,
  'ready',
);
session.undo();
const captured = snapshot();
const stale = captured.runtime.commandSplines(
  { splines: [{ id: guide.pathIds[0], name: '改名' }] },
  { project: captured.project },
);
run({ splines: [{ id: first.pathIds[1], name: '另一条' }] });
assert.throws(() => stale.commit(), /过期/);
session.undo();
const beforeFailure = snapshot().editorState.document;
const noOpCapture = snapshot();
const noOpId = first.pathIds[0];
const noOp = noOpCapture.runtime
  .commandSplines(
    { splines: [{ id: noOpId }] },
    { project: noOpCapture.project },
  )
  .commit();
assert.deepEqual(noOp.pathIds, [noOpId]);
assert.deepEqual(snapshot().editorState.document, beforeFailure);
assert.throws(
  () =>
    run({
      units: 'model',
      splines: [{ nodes: square(2), closed: true }, { id: 'missing' }],
    }),
  /不存在/,
);
assert.deepEqual(snapshot().editorState.document, beforeFailure);
assert.throws(
  () => run({ objectId: owner, splines: [{ id: first.pathIds[1] }] }),
  /转移/,
);
assert.deepEqual(snapshot().editorState.document, beforeFailure);
// Initial mixed create batch remains one history entry.
const metadataView = snapshot().runtime.readSourceView(snapshot().project);
const metadataRef = metadataView.source.identities.byId[first.pathIds[0]];
session.dispatch((document) => {
  const sketch = document.sketches[metadataRef.sketchId];
  const [target, source] = Object.values(sketch.vertices);
  document.relations.metadataTest = {
    id: 'metadataTest',
    kind: 'coincident',
    target: { kind: 'vertex', sketchId: sketch.id, id: target.id },
    source: { kind: 'vertex', sketchId: sketch.id, id: source.id },
    offset: target.position.value.map(
      (value, i) => value - source.position.value[i],
    ),
    frame: { space: 'owner-local', transform: [1, 0, 0, 1, 0, 0] },
  };
  target.position = { kind: 'relation', relationId: 'metadataTest' };
  return { document };
});
const beforeRename = snapshot().editorState.document;
run({ splines: [{ id: first.pathIds[0], name: '只改名称' }] });
assert.deepEqual(
  snapshot().editorState.document.sketches[metadataRef.sketchId].vertices,
  beforeRename.sketches[metadataRef.sketchId].vertices,
);
assert.deepEqual(
  snapshot().editorState.document.relations,
  beforeRename.relations,
);
session.undo();
assert.deepEqual(snapshot().editorState.document, beforeRename);
session.undo();
assert.deepEqual(snapshot().editorState.document, beforeFailure);
session.dispatch((document) => {
  document.nodes[owner].locked = true;
  return { document };
});
const locked = snapshot().editorState.document;
assert.throws(
  () =>
    run({
      units: 'model',
      splines: [
        { nodes: square(3), closed: true },
        { id: first.pathIds[0], matrix: [1, 0, 0, 1, 1, 0] },
      ],
    }),
  /锁定/,
);
assert.deepEqual(snapshot().editorState.document, locked);
session.undo();
assert.deepEqual(snapshot().editorState.document, beforeFailure);
session.undo();
assert.deepEqual(snapshot().editorState.document, original);
session.undo();
assert.deepEqual(snapshot().editorState.document, empty);
console.log(
  'PASS original exact spline batches create, transform, assign roles and preserve canonical history, guide separation and stale guards',
);
