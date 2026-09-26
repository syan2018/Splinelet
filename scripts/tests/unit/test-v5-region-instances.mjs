import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { compileModifierAdd } from '../../../src/lib/editor/modifier-intents.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { stableIdentityValue } from '../../../src/lib/construction/output-identity.mjs';
import { readGeometry } from '../../../src/lib/region-engine.mjs';
import {
  encodeDocument,
  decodeDocument,
} from '../../../src/lib/document/codec.mjs';

let serial = 0;
const idFactory = () => `region-instance-v5-${++serial}`;
let editor = createEditorSession(createDocument({ version: 5, idFactory }), {
  idFactory,
});
const run = (action) =>
  editor.dispatch(createAuthoringCommand(action), {
    expectedRevision: editor.state.revision,
  });

run({
  kind: 'draw-path',
  closed: true,
  points: [
    [18, 3],
    [22, 3],
    [22, 5],
    [18, 5],
  ],
});
const ownerNodeId = Object.keys(editor.state.document.nodes)[0];
const sketchId = Object.keys(editor.state.document.sketches)[0];
const pathId = Object.keys(editor.state.document.sketches[sketchId].paths)[0];

const addCurveTransform = (request) => {
  const action = compileModifierAdd(editor.state.document, {
    objectId: ownerNodeId,
    targets: { kind: 'all' },
    ...request,
  });
  run(action);
  return Object.values(
    editor.state.document.programs[
      editor.state.document.nodes[ownerNodeId].programId
    ].operators,
  ).find((operator) => operator.name === request.name).id;
};
const firstMirrorId = addCurveTransform({
  type: 'curve_mirror',
  name: 'mirror-horizontal',
  centerMM: { x: 0, y: 0 },
  angleDeg: 0,
});
const secondMirrorId = addCurveTransform({
  type: 'curve_mirror',
  name: 'mirror-vertical',
  centerMM: { x: 0, y: 0 },
  angleDeg: 90,
});
const arrayId = addCurveTransform({
  type: 'curve_array',
  name: 'array-120',
  centerMM: { x: 0, y: 0 },
  angleDeg: 120,
  count: 3,
});

const identity = (value) => stableIdentityValue(value || []);
const instancesOfRegion = (region) => {
  const uses = [
    region.selector.outer,
    ...(region.selector.holes || []),
  ].flatMap((ring) =>
    ring.flatMap((run) => run.sources.map((source) => source.use)),
  );
  assert.ok(uses.length, 'a declarative cell must retain its source use');
  const instances = uses[0].instances || [];
  assert.ok(
    uses.every((use) => identity(use.instances) === identity(instances)),
    'each boundary of this face must have one transform instance chain',
  );
  return instances;
};
const programResult = () => evaluateProgram(editor.state.document, ownerNodeId);
const regions = () => {
  const stage = programResult().regions;
  assert.equal(stage.status, 'ready', JSON.stringify(stage.diagnostics));
  return stage.value.regions;
};
const transformedCurves = () => {
  const stage = programResult().components[`operator:${arrayId}`].ports.curves;
  assert.equal(stage.status, 'ready', JSON.stringify(stage.diagnostics));
  return stage.value.curves;
};
const centerOfCurve = (curve) => {
  const points = curve.edges.map((edge) => edge.cubic[0]);
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    const cross = point[0] * next[1] - next[0] * point[1];
    twiceArea += cross;
    x += (point[0] + next[0]) * cross;
    y += (point[1] + next[1]) * cross;
  }
  return [x / (3 * twiceArea), y / (3 * twiceArea)];
};
const centerOfRegion = (region) => {
  const center = readGeometry(region.geometry).getCentroid();
  return [center.getX(), center.getY()];
};
const appearanceFor = (ref) =>
  Object.values(editor.state.document.appearances.overrides).find(
    (item) => item.target.key === ref.key,
  );
const reliefFor = (ref) =>
  Object.values(editor.state.document.reliefDefinitions.overrides).find(
    (item) => item.target.key === ref.key,
  );

const initialRegions = regions();
assert.equal(initialRegions.length, 12, 'two mirrors and a three-copy array');
const curveByInstance = new Map(
  transformedCurves().map((curve) => [
    identity(curve.edges[0].instances),
    curve,
  ]),
);
assert.equal(
  curveByInstance.size,
  12,
  'each curve transform instance is distinct',
);
for (const region of initialRegions) {
  const instances = instancesOfRegion(region);
  const curve = curveByInstance.get(identity(instances));
  assert.ok(
    curve,
    `a region retains its curve transform instance chain: ${identity(instances)}; curves=${JSON.stringify([...curveByInstance.keys()])}`,
  );
  assert.deepEqual(
    curve.edges[0].instances.slice(-3).map((item) => item.operatorId),
    [firstMirrorId, secondMirrorId, arrayId],
  );
  const curveCenter = centerOfCurve(curve);
  const regionCenter = centerOfRegion(region);
  assert.ok(
    Math.hypot(
      curveCenter[0] - regionCenter[0],
      curveCenter[1] - regionCenter[1],
    ) < 1e-8,
    'filled region geometry follows the transformed curve instance',
  );
}

const expected = new Map();
for (const [index, region] of initialRegions.entries()) {
  const color = `#${(0x110000 + index * 0x000a0b).toString(16).padStart(6, '0')}`;
  run({ kind: 'create-swatch', name: `instance-${index}`, color });
  const swatchId = Object.keys(editor.state.document.appearances.swatches).at(
    -1,
  );
  const thickness = index + 0.75;
  const instances = instancesOfRegion(region);
  const current = regions().find(
    (item) => identity(instancesOfRegion(item)) === identity(instances),
  );
  assert.ok(current, 'creating a swatch cannot invalidate an instance face');
  run({ kind: 'paint-region', target: current.ref, swatchId });
  const painted = regions().find(
    (item) => identity(instancesOfRegion(item)) === identity(instances),
  );
  assert.ok(painted, 'painting another instance cannot retarget this face');
  run({
    kind: 'set-thickness',
    target: painted.ref,
    thickness: { kind: 'mm', value: thickness },
  });
  const assigned = regions().find(
    (item) => identity(instancesOfRegion(item)) === identity(instances),
  );
  assert.ok(assigned, 'thickness cannot invalidate an instance face');
  expected.set(assigned.ref.key, {
    geometry: readGeometry(assigned.geometry),
    instances: structuredClone(instances),
    swatchId,
    thickness,
  });
}

const assertEveryFace = (label) => {
  const current = regions();
  assert.equal(
    current.length,
    expected.size,
    `${label}: every face remains present`,
  );
  const currentCurves = new Map(
    transformedCurves().map((curve) => [
      identity(curve.edges[0].instances),
      curve,
    ]),
  );
  for (const region of current) {
    const previous = expected.get(region.ref.key);
    assert.ok(previous, `${label}: no new reference may take an assignment`);
    assert.deepEqual(
      instancesOfRegion(region),
      previous.instances,
      `${label}: instance chain`,
    );
    assert.ok(
      readGeometry(region.geometry).symDifference(previous.geometry).getArea() <
        1e-8,
      `${label}: region ID retains its physical face`,
    );
    assert.equal(appearanceFor(region.ref)?.value.swatchId, previous.swatchId);
    assert.equal(
      reliefFor(region.ref)?.value.thickness?.value,
      previous.thickness,
    );
    const curve = currentCurves.get(identity(instancesOfRegion(region)));
    assert.ok(curve, `${label}: region still has its source curve instance`);
    const curveCenter = centerOfCurve(curve);
    const regionCenter = centerOfRegion(region);
    assert.ok(
      Math.hypot(
        curveCenter[0] - regionCenter[0],
        curveCenter[1] - regionCenter[1],
      ) < 1e-8,
      `${label}: curve transform parity`,
    );
  }
};

const beforeEdits = structuredClone(editor.state.document);
run({ kind: 'reverse-path', sketchId, pathId });
assertEveryFace('reverse');

let path = editor.state.document.sketches[sketchId].paths[pathId];
const splitEdgeId = path.edges[0].edgeId;
run({ kind: 'split-edge', sketchId, edgeId: splitEdgeId, t: 0.5 });
assertEveryFace('split');

path = editor.state.document.sketches[sketchId].paths[pathId];
const insertedVertexId =
  editor.state.document.sketches[sketchId].edges[splitEdgeId].endVertexId;
run({
  kind: 'delete-path-vertices',
  pathRef: { kind: 'path', sketchId, id: pathId },
  expectedEdges: path.edges,
  vertexIds: [insertedVertexId],
  toleranceMM: 0.01,
});
assertEveryFace('delete inserted vertex');
const afterEdits = structuredClone(editor.state.document);

for (let step = 0; step < 3; step++)
  editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, beforeEdits, 'edits undo atomically');
for (let step = 0; step < 3; step++)
  editor.redo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, afterEdits, 'edits redo atomically');
assertEveryFace('redo');

const reopened = decodeDocument(encodeDocument(editor.state.document)).document;
editor = createEditorSession(reopened, { idFactory });
assertEveryFace('cold reopen');

console.log(
  'PASS V5 mirrored and arrayed region instances keep geometry, instance chains, colours, and thickness through source edits, history, and reopen',
);
