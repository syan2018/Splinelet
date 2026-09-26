import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { readGeometry } from '../../../src/lib/region-engine.mjs';

let serial = 0;
const idFactory = () => `region-topology-v5-${++serial}`;
const editor = createEditorSession(createDocument({ version: 5, idFactory }), {
  idFactory,
});
const run = (action) =>
  editor.dispatch(createAuthoringCommand(action), {
    expectedRevision: editor.state.revision,
  });

run({
  kind: 'draw-path',
  points: [
    [0, 0],
    [12, 0],
    [12, 12],
    [0, 12],
  ],
  closed: true,
});
const ownerNodeId = Object.keys(editor.state.document.nodes)[0];
const regions = () => {
  const result = evaluateProgram(editor.state.document, ownerNodeId).regions;
  assert.equal(result.status, 'ready', JSON.stringify(result.diagnostics));
  return result.value.regions;
};
const geometry = (region) => readGeometry(region.geometry);
const centroid = (region) => {
  const point = geometry(region).getCentroid();
  return [point.getX(), point.getY()];
};
const sameGeometry = (left, right) =>
  geometry(left).symDifference(geometry(right)).getArea() < 1e-8;
const appearanceFor = (ref) =>
  Object.values(editor.state.document.appearances.overrides).find(
    (item) => item.target.key === ref.key,
  );
const reliefFor = (ref) =>
  Object.values(editor.state.document.reliefDefinitions.overrides).find(
    (item) => item.target.key === ref.key,
  );

run({ kind: 'create-swatch', name: 'base', color: '#111111' });
run({ kind: 'create-swatch', name: 'left', color: '#cc2233' });
run({ kind: 'create-swatch', name: 'middle', color: '#2277cc' });
run({ kind: 'create-swatch', name: 'right', color: '#22aa66' });
const swatches = Object.values(editor.state.document.appearances.swatches);
const [baseSwatch, leftSwatch, middleSwatch, rightSwatch] = swatches;
const initialBase = regions()[0].ref;
run({ kind: 'paint-region', target: initialBase, swatchId: baseSwatch.id });
run({
  kind: 'set-thickness',
  target: regions()[0].ref,
  thickness: { kind: 'mm', value: 0.8 },
});
let base = regions()[0].ref;
run({
  kind: 'draw-hole',
  targets: [base],
  points: [
    [4, 4],
    [8, 4],
    [8, 8],
    [4, 8],
  ],
  closed: true,
});
assert.equal(regions().length, 1, 'a declared hole remains one material face');
base = regions()[0].ref;
assert.equal(appearanceFor(base)?.value.swatchId, baseSwatch.id);
assert.equal(reliefFor(base)?.value.thickness?.value, 0.8);

const knownSketches = new Set(Object.keys(editor.state.document.sketches));
run({
  kind: 'start-path',
  role: 'divider',
  point: [-1, 2],
  ownerNodeId,
  targets: [base],
});
const cutterSketch = Object.values(editor.state.document.sketches).find(
  (sketch) => !knownSketches.has(sketch.id),
);
assert.ok(cutterSketch, 'divider must create a source sketch');
const cutterPathId = Object.keys(cutterSketch.paths)[0];
for (const [from, to] of [
  [
    [-1, 2],
    [13, 2],
  ],
  [
    [13, 2],
    [-1, 6],
  ],
  [
    [-1, 6],
    [13, 10],
  ],
])
  run({
    kind: 'extend-path',
    sketchId: cutterSketch.id,
    pathId: cutterPathId,
    cubic: [from, from, to, to],
  });
run({ kind: 'finish-path', sketchId: cutterSketch.id, pathId: cutterPathId });

assert.ok(
  regions().length >= 3,
  'one zigzag cutter must create at least three material regions',
);
const assignments = [leftSwatch, middleSwatch, rightSwatch];
regions()
  .slice()
  .sort((left, right) => centroid(left)[1] - centroid(right)[1])
  .forEach((region, index) => {
    run({
      kind: 'paint-region',
      target: region.ref,
      swatchId: assignments[index % assignments.length].id,
    });
    run({
      kind: 'set-thickness',
      target: region.ref,
      thickness: { kind: 'mm', value: index + 1.25 },
    });
  });

const physicalAssignments = () =>
  regions().map((region) => ({
    region,
    swatchId: appearanceFor(region.ref)?.value.swatchId,
    thickness: reliefFor(region.ref)?.value.thickness?.value,
  }));
const beforeTopologyPreservingEdits = physicalAssignments();
const assertPhysicalAssignments = (label) => {
  const after = physicalAssignments();
  assert.equal(after.length, beforeTopologyPreservingEdits.length, label);
  for (const previous of beforeTopologyPreservingEdits) {
    const current = after.find((item) =>
      sameGeometry(item.region, previous.region),
    );
    assert.ok(current, `${label}: physical face must remain present`);
    assert.equal(
      current.swatchId,
      previous.swatchId,
      `${label}: colour follows face`,
    );
    assert.equal(
      current.thickness,
      previous.thickness,
      `${label}: thickness follows face`,
    );
  }
};

run({ kind: 'reverse-path', sketchId: cutterSketch.id, pathId: cutterPathId });
assertPhysicalAssignments('reverse');

let cutterPath =
  editor.state.document.sketches[cutterSketch.id].paths[cutterPathId];
const splitEdgeId = cutterPath.edges[0].edgeId;
run({
  kind: 'split-edge',
  sketchId: cutterSketch.id,
  edgeId: splitEdgeId,
  t: 0.5,
});
assertPhysicalAssignments('split');

cutterPath =
  editor.state.document.sketches[cutterSketch.id].paths[cutterPathId];
const splitVertexId =
  editor.state.document.sketches[cutterSketch.id].edges[splitEdgeId]
    .endVertexId;
run({
  kind: 'delete-path-vertices',
  pathRef: { kind: 'path', sketchId: cutterSketch.id, id: cutterPathId },
  expectedEdges: cutterPath.edges,
  vertexIds: [splitVertexId],
  toleranceMM: 0.01,
});
assertPhysicalAssignments('delete split vertex');

const topologyPath =
  editor.state.document.sketches[cutterSketch.id].paths[cutterPathId];
const topologyVertexId =
  editor.state.document.sketches[cutterSketch.id].edges[
    topologyPath.edges[1].edgeId
  ].startVertexId;
const beforeTopologyBreak = regions();
run({
  kind: 'set-vertex',
  sketchId: cutterSketch.id,
  vertexId: topologyVertexId,
  value: [-1, 2],
});
const changed = evaluateProgram(editor.state.document, ownerNodeId).regions;
assert.equal(changed.status, 'ready', JSON.stringify(changed.diagnostics));
assert.ok(
  changed.value.regions.length !== beforeTopologyBreak.length ||
    beforeTopologyBreak.some(
      (region) =>
        !changed.value.regions.some((next) => sameGeometry(next, region)),
    ),
  'the authoring edit must change the cutter topology, not merely its traversal order',
);
assert.ok(
  changed.diagnostics.some((item) =>
    ['region-definition-missing', 'region-definition-ambiguous'].includes(
      item.code,
    ),
  ),
  `topology replacement must expose stale region definitions: ${JSON.stringify(changed.diagnostics)}`,
);

console.log(
  'PASS V5 declarative regions retain physical assignments through zigzag reverse/split/delete and expose changed topology bindings',
);
