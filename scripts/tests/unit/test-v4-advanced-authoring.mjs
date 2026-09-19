import assert from 'node:assert/strict';
import {
  evaluatePlanar,
  evaluateProgram,
} from '../../../src/lib/construction/document-evaluation.mjs';
import { outputIdentity } from '../../../src/lib/construction/provenance.mjs';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import {
  ADVANCED_ACTIONS,
  createAdvancedCommand,
} from '../../../src/lib/editing/commands/advanced.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { readGeometry } from '../../../src/lib/region-engine.mjs';
import { sameOutputRef } from '../../../src/lib/relief/appearance.mjs';
import {
  transformPoint,
  worldMatrix,
} from '../../../src/lib/scene/transforms.mjs';

let serial = 0;
const idFactory = () => `advanced-${++serial}`;
const dispatch = (session, command) =>
  session.dispatch(command, { expectedRevision: session.state.revision });
const author = (session, action) =>
  dispatch(session, createAuthoringCommand(action));
const advanced = (session, action) =>
  dispatch(session, createAdvancedCommand(action));
const near = (actual, expected, tolerance = 1e-8) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, index) =>
    assert.ok(
      Math.abs(value - expected[index]) <= tolerance,
      `${value} != ${expected[index]}`,
    ),
  );
};
const square = (x, y, size) => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
];
const shapeIds = (document) =>
  Object.values(document.nodes)
    .filter((node) => node.kind === 'shape')
    .map((node) => node.id);
const publishedRegions = (document, shapeId) => {
  const stage = evaluatePlanar(document).published[`${shapeId}:regions`];
  assert.equal(stage.status, 'ready', JSON.stringify(stage.diagnostics));
  return stage.value.regions;
};
const firstCurveWorldPoint = (document, shapeId) => {
  const stage = evaluateProgram(document, shapeId).curves;
  assert.equal(stage.status, 'ready', JSON.stringify(stage.diagnostics));
  return transformPoint(
    worldMatrix(document, shapeId),
    stage.value.curves[0].edges[0].cubic[0],
  );
};

assert.equal(ADVANCED_ACTIONS.fillCurves, 'fill-curves');
assert.equal(ADVANCED_ACTIONS.repeatPattern, 'repeat-pattern');
assert.equal(ADVANCED_ACTIONS.cutReferenceRegions, 'cut-reference-regions');

const curveSession = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
author(curveSession, {
  kind: 'draw-path',
  points: [
    [1, 0],
    [0, 1],
  ],
  closed: false,
});
const curveShape = shapeIds(curveSession.state.document)[0];
const curveSketch = Object.values(curveSession.state.document.sketches)[0];
const curveEdge = Object.values(curveSketch.edges)[0];
const beforeMirror = structuredClone(curveSession.state.document);
advanced(curveSession, {
  kind: 'mirror-curves',
  ownerNodeId: curveShape,
  center: [0, 0],
  angleRad: 0,
});
assert.equal(
  evaluateProgram(curveSession.state.document, curveShape).curves.value.curves
    .length,
  2,
);
curveSession.undo({ expectedRevision: curveSession.state.revision });
assert.deepEqual(curveSession.state.document, beforeMirror);

advanced(curveSession, {
  kind: 'repeat-curves',
  ownerNodeId: curveShape,
  center: [0, 0],
  angleRad: Math.PI / 2,
  count: 4,
});
let curveProgram =
  curveSession.state.document.programs[
    curveSession.state.document.nodes[curveShape].programId
  ];
const arrayId = curveProgram.outputs.curves.operatorId;
assert.equal(
  evaluateProgram(curveSession.state.document, curveShape).curves.value.curves
    .length,
  4,
);
advanced(curveSession, {
  kind: 'set-operator',
  ownerNodeId: curveShape,
  operatorId: arrayId,
  params: { center: [0, 0], angleRad: Math.PI / 2, count: 3 },
});
assert.equal(
  evaluateProgram(curveSession.state.document, curveShape).curves.value.curves
    .length,
  3,
);
curveSession.undo({ expectedRevision: curveSession.state.revision });
assert.equal(
  evaluateProgram(curveSession.state.document, curveShape).curves.value.curves
    .length,
  4,
);
const beforeConnect = structuredClone(curveSession.state.document);
advanced(curveSession, {
  kind: 'connect-boundaries',
  ownerNodeId: curveShape,
  connections: [
    {
      a: {
        edgeEnd: {
          kind: 'edge-end',
          sketchId: curveSketch.id,
          edgeId: curveEdge.id,
          end: 'end',
        },
        selector: { operatorId: arrayId, index: 'each', wrap: true },
      },
      b: {
        edgeEnd: {
          kind: 'edge-end',
          sketchId: curveSketch.id,
          edgeId: curveEdge.id,
          end: 'start',
        },
        selector: { operatorId: arrayId, index: 'next', wrap: true },
      },
    },
  ],
});
curveProgram =
  curveSession.state.document.programs[
    curveSession.state.document.nodes[curveShape].programId
  ];
const joinId = curveProgram.outputs.curves.operatorId;
assert.equal(
  evaluateProgram(curveSession.state.document, curveShape).curves.value
    .junctions.length,
  4,
);
curveSession.undo({ expectedRevision: curveSession.state.revision });
assert.deepEqual(curveSession.state.document, beforeConnect);
advanced(curveSession, {
  kind: 'connect-boundaries',
  ownerNodeId: curveShape,
  connections: [
    {
      a: {
        edgeEnd: {
          kind: 'edge-end',
          sketchId: curveSketch.id,
          edgeId: curveEdge.id,
          end: 'end',
        },
        selector: { operatorId: arrayId, index: 'each', wrap: true },
      },
      b: {
        edgeEnd: {
          kind: 'edge-end',
          sketchId: curveSketch.id,
          edgeId: curveEdge.id,
          end: 'start',
        },
        selector: { operatorId: arrayId, index: 'next', wrap: true },
      },
    },
  ],
});
const activeJoinId =
  curveSession.state.document.programs[
    curveSession.state.document.nodes[curveShape].programId
  ].outputs.curves.operatorId;
advanced(curveSession, {
  kind: 'set-operator',
  ownerNodeId: curveShape,
  operatorId: activeJoinId,
  enabled: false,
});
assert.equal(
  evaluateProgram(curveSession.state.document, curveShape).curves.value
    .junctions.length,
  0,
);
curveSession.undo({ expectedRevision: curveSession.state.revision });
assert.equal(
  evaluateProgram(curveSession.state.document, curveShape).curves.value
    .junctions.length,
  4,
);
assert.notEqual(joinId, activeJoinId);

const blockedFillSession = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
author(blockedFillSession, {
  kind: 'draw-path',
  points: [
    [0, 0],
    [3, 0],
  ],
  closed: false,
});
const blockedFillShape = shapeIds(blockedFillSession.state.document)[0];
const beforeBlockedFill = structuredClone(blockedFillSession.state.document);
advanced(blockedFillSession, {
  kind: ADVANCED_ACTIONS.fillCurves,
  ownerNodeId: blockedFillShape,
});
assert.equal(
  evaluateProgram(blockedFillSession.state.document, blockedFillShape).regions
    .status,
  'blocked',
);
blockedFillSession.undo({
  expectedRevision: blockedFillSession.state.revision,
});
assert.deepEqual(blockedFillSession.state.document, beforeBlockedFill);
const emptyFillDocument = structuredClone(blockedFillSession.state.document);
const emptyFillProgram =
  emptyFillDocument.programs[
    emptyFillDocument.nodes[blockedFillShape].programId
  ];
emptyFillProgram.operators[
  emptyFillProgram.outputs.curves.operatorId
].inputs.paths[0].pathIds = [];
const emptyFillSession = createEditorSession(emptyFillDocument, { idFactory });
assert.equal(
  evaluateProgram(emptyFillSession.state.document, blockedFillShape).curves
    .status,
  'empty',
);
advanced(emptyFillSession, {
  kind: ADVANCED_ACTIONS.fillCurves,
  ownerNodeId: blockedFillShape,
});
assert.equal(
  evaluateProgram(emptyFillSession.state.document, blockedFillShape).regions
    .status,
  'empty',
);

const readyFillDocument = createDocument({ idFactory });
readyFillDocument.appearances.swatches['fill-red'] = {
  id: 'fill-red',
  name: '红色',
  color: '#ff0000',
};
const readyFillSession = createEditorSession(readyFillDocument, { idFactory });
author(readyFillSession, {
  kind: 'draw-path',
  points: square(0, 0, 4),
  closed: true,
});
const readyFillShape = shapeIds(readyFillSession.state.document)[0];
const oldFillId =
  readyFillSession.state.document.programs[
    readyFillSession.state.document.nodes[readyFillShape].programId
  ].outputs.regions.operatorId;
advanced(readyFillSession, {
  kind: ADVANCED_ACTIONS.fillCurves,
  ownerNodeId: readyFillShape,
});
const newFillProgram =
  readyFillSession.state.document.programs[
    readyFillSession.state.document.nodes[readyFillShape].programId
  ];
assert.notEqual(newFillProgram.outputs.regions.operatorId, oldFillId);
assert.equal(
  evaluateProgram(readyFillSession.state.document, readyFillShape).regions
    .status,
  'ready',
);
const filledTarget = publishedRegions(
  readyFillSession.state.document,
  readyFillShape,
)[0].ref;
author(readyFillSession, {
  kind: 'paint-region',
  target: filledTarget,
  swatchId: 'fill-red',
});
const beforeRejectedFill = structuredClone(readyFillSession.state.document);
const rejectedFillRevision = readyFillSession.state.revision;
assert.throws(
  () =>
    advanced(readyFillSession, {
      kind: ADVANCED_ACTIONS.fillCurves,
      ownerNodeId: readyFillShape,
    }),
  /存在赋值/,
);
assert.equal(readyFillSession.state.revision, rejectedFillRevision);
assert.deepEqual(readyFillSession.state.document, beforeRejectedFill);

const patternSession = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
const diagonal = Math.SQRT1_2;
author(patternSession, {
  kind: 'draw-path',
  points: [
    [1, 0],
    [diagonal, diagonal],
  ],
  closed: false,
});
const patternShape = shapeIds(patternSession.state.document)[0];
const patternSketch = Object.values(patternSession.state.document.sketches)[0];
const patternEdge = Object.values(patternSketch.edges)[0];
const patternEdgeEnd = (end) => ({
  kind: 'edge-end',
  sketchId: patternSketch.id,
  edgeId: patternEdge.id,
  end,
});
const beforePattern = structuredClone(patternSession.state.document);
const patternRevision = patternSession.state.revision;
advanced(patternSession, {
  kind: ADVANCED_ACTIONS.repeatPattern,
  ownerNodeId: patternShape,
  center: [0, 0],
  angleRad: Math.PI / 2,
  count: 4,
  mirror: { angleRad: 0 },
  connections: [
    {
      a: {
        edgeEnd: patternEdgeEnd('start'),
        index: 'each',
        mirrorIndex: 0,
      },
      b: {
        edgeEnd: patternEdgeEnd('start'),
        index: 'each',
        mirrorIndex: 1,
      },
    },
    {
      a: {
        edgeEnd: patternEdgeEnd('end'),
        index: 'each',
        mirrorIndex: 0,
      },
      b: {
        edgeEnd: patternEdgeEnd('end'),
        index: 'next',
        mirrorIndex: 1,
      },
    },
  ],
});
assert.equal(patternSession.state.revision, patternRevision + 1);
const patternResult = evaluateProgram(
  patternSession.state.document,
  patternShape,
);
assert.equal(patternResult.curves.status, 'ready');
assert.equal(patternResult.curves.value.curves.length, 8);
assert.equal(patternResult.curves.value.junctions.length, 8);
assert.equal(patternResult.regions.status, 'ready');
assert.ok(
  Math.abs(
    readGeometry(patternResult.regions.value.regions[0].geometry).getArea() -
      2 * Math.SQRT2,
  ) < 1e-8,
);
patternSession.undo({ expectedRevision: patternSession.state.revision });
assert.deepEqual(patternSession.state.document, beforePattern);

const referenceSession = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
author(referenceSession, {
  kind: 'draw-path',
  points: [
    [0, 0],
    [2, 0],
  ],
  closed: false,
});
const sourceShape = shapeIds(referenceSession.state.document)[0];
author(referenceSession, {
  kind: 'move-nodes',
  nodeIds: [sourceShape],
  deltaMM: [10, 0],
});
const sourceProgram =
  referenceSession.state.document.programs[
    referenceSession.state.document.nodes[sourceShape].programId
  ];
advanced(referenceSession, {
  kind: 'reference-source',
  source: sourceProgram.outputs.curves,
  space: 'local-result',
  name: '本地引用',
});
const localReference =
  referenceSession.state.lastChange.selectionIntent.activeRef.id;
advanced(referenceSession, {
  kind: 'reference-source',
  source: sourceProgram.outputs.curves,
  space: 'world-result',
  name: '世界引用',
});
const worldReference =
  referenceSession.state.lastChange.selectionIntent.activeRef.id;
near(
  firstCurveWorldPoint(referenceSession.state.document, localReference),
  [0, 0],
);
near(
  firstCurveWorldPoint(referenceSession.state.document, worldReference),
  [10, 0],
);

const referenceCutDocument = createDocument({ idFactory });
referenceCutDocument.appearances.swatches.red = {
  id: 'red',
  name: '红色',
  color: '#ff0000',
};
const referenceCutSession = createEditorSession(referenceCutDocument, {
  idFactory,
});
author(referenceCutSession, {
  kind: 'draw-path',
  points: square(0, 0, 10),
  closed: true,
});
const referenceCutShape = shapeIds(referenceCutSession.state.document)[0];
author(referenceCutSession, {
  kind: 'draw-path',
  ownerNodeId: referenceCutShape,
  points: square(20, 0, 10),
  closed: true,
});
const referenceCutRegions = publishedRegions(
  referenceCutSession.state.document,
  referenceCutShape,
)
  .slice()
  .sort(
    (left, right) =>
      readGeometry(left.geometry).getEnvelopeInternal().getMinX() -
      readGeometry(right.geometry).getEnvelopeInternal().getMinX(),
  );
const referenceCutTarget = referenceCutRegions[0].ref;
const referenceCutRetained = referenceCutRegions[1].ref;
author(referenceCutSession, {
  kind: 'paint-region',
  target: referenceCutTarget,
  swatchId: 'red',
});
author(referenceCutSession, {
  kind: 'draw-path',
  points: square(2, 2, 4),
  closed: true,
  name: '引用刀具',
});
const referenceCutterShape = shapeIds(referenceCutSession.state.document).find(
  (id) => id !== referenceCutShape,
);
author(referenceCutSession, {
  kind: 'move-nodes',
  nodeIds: [referenceCutterShape],
  deltaMM: [20, 0],
});
const referenceCutterProgram =
  referenceCutSession.state.document.programs[
    referenceCutSession.state.document.nodes[referenceCutterShape].programId
  ];
const beforeLocalReferenceCut = structuredClone(
  referenceCutSession.state.document,
);
advanced(referenceCutSession, {
  kind: ADVANCED_ACTIONS.cutReferenceRegions,
  targets: [referenceCutTarget],
  sourceRegionPort: referenceCutterProgram.outputs.regions,
  space: 'local-result',
});
let cutRegions = publishedRegions(
  referenceCutSession.state.document,
  referenceCutShape,
);
assert.ok(
  cutRegions.some((region) => sameOutputRef(region.ref, referenceCutRetained)),
);
let cutChild = cutRegions.find(
  (region) => !sameOutputRef(region.ref, referenceCutRetained),
);
assert.equal(readGeometry(cutChild.geometry).getArea(), 84);
assert.equal(readGeometry(cutChild.geometry).getNumInteriorRing(), 1);
assert.ok(
  Object.values(referenceCutSession.state.document.appearances.overrides).some(
    (item) => sameOutputRef(item.target, cutChild.ref),
  ),
);
referenceCutSession.undo({
  expectedRevision: referenceCutSession.state.revision,
});
assert.deepEqual(referenceCutSession.state.document, beforeLocalReferenceCut);
advanced(referenceCutSession, {
  kind: ADVANCED_ACTIONS.cutReferenceRegions,
  targets: [referenceCutTarget],
  sourceRegionPort: referenceCutterProgram.outputs.regions,
  space: 'world-result',
});
cutRegions = publishedRegions(
  referenceCutSession.state.document,
  referenceCutShape,
);
cutChild = cutRegions.find(
  (region) => !sameOutputRef(region.ref, referenceCutRetained),
);
assert.equal(readGeometry(cutChild.geometry).getArea(), 100);
assert.equal(readGeometry(cutChild.geometry).getNumInteriorRing(), 0);
referenceCutSession.undo({
  expectedRevision: referenceCutSession.state.revision,
});
const beforeStaleReferenceCut = structuredClone(
  referenceCutSession.state.document,
);
const staleReferenceCutRevision = referenceCutSession.state.revision;
assert.throws(
  () =>
    advanced(referenceCutSession, {
      kind: ADVANCED_ACTIONS.cutReferenceRegions,
      targets: [{ ...referenceCutTarget, key: 'stale' }],
      sourceRegionPort: referenceCutterProgram.outputs.regions,
      space: 'local-result',
    }),
  /失效/,
);
assert.equal(referenceCutSession.state.revision, staleReferenceCutRevision);
assert.deepEqual(referenceCutSession.state.document, beforeStaleReferenceCut);
author(referenceCutSession, {
  kind: 'draw-path',
  points: square(-1, -1, 12),
  closed: true,
  name: '完全切除刀具',
});
const completeCutterShape = shapeIds(referenceCutSession.state.document).find(
  (id) => id !== referenceCutShape && id !== referenceCutterShape,
);
const completeCutterProgram =
  referenceCutSession.state.document.programs[
    referenceCutSession.state.document.nodes[completeCutterShape].programId
  ];
const beforeCompleteCut = structuredClone(referenceCutSession.state.document);
advanced(referenceCutSession, {
  kind: ADVANCED_ACTIONS.cutReferenceRegions,
  targets: [referenceCutTarget],
  sourceRegionPort: completeCutterProgram.outputs.regions,
  space: 'local-result',
});
const completeCutRegions = publishedRegions(
  referenceCutSession.state.document,
  referenceCutShape,
);
assert.equal(completeCutRegions.length, 1);
assert.ok(sameOutputRef(completeCutRegions[0].ref, referenceCutRetained));
assert.equal(
  Object.keys(referenceCutSession.state.document.appearances.overrides).length,
  0,
);
assert.equal(
  Object.keys(referenceCutSession.state.document.reliefDefinitions.overrides)
    .length,
  0,
);
referenceCutSession.undo({
  expectedRevision: referenceCutSession.state.revision,
});
assert.deepEqual(referenceCutSession.state.document, beforeCompleteCut);

const manufacturingDocument = createDocument({ idFactory });
manufacturingDocument.appearances.swatches.red = {
  id: 'red',
  name: '红色',
  color: '#ff0000',
};
const layerId = idFactory();
manufacturingDocument.manufacturing.layers[layerId] = {
  id: layerId,
  name: '上层',
};
manufacturingDocument.manufacturing.layerOrder.push(layerId);
const manufacturingSession = createEditorSession(manufacturingDocument, {
  idFactory,
});
author(manufacturingSession, {
  kind: 'draw-path',
  points: square(0, 0, 5),
  closed: true,
});
const manufacturingShape = shapeIds(manufacturingSession.state.document)[0];
const manufacturingTarget = publishedRegions(
  manufacturingSession.state.document,
  manufacturingShape,
)[0].ref;
author(manufacturingSession, {
  kind: 'paint-region',
  target: manufacturingTarget,
  swatchId: 'red',
});
author(manufacturingSession, {
  kind: 'set-thickness',
  target: manufacturingTarget,
  thickness: { kind: 'mm', value: 2 },
});
advanced(manufacturingSession, {
  kind: 'set-manufacturing-part',
  target: manufacturingTarget,
  partId: manufacturingSession.state.document.manufacturing.defaultPartId,
});
advanced(manufacturingSession, {
  kind: 'set-manufacturing-excluded',
  target: manufacturingTarget,
  excluded: true,
});
advanced(manufacturingSession, {
  kind: 'set-manufacturing-layer',
  target: manufacturingTarget,
  layerId,
  offsetMM: 0.4,
});
assert.equal(
  Object.values(
    manufacturingSession.state.document.reliefDefinitions.overrides,
  )[0].value.placement.layerId,
  layerId,
);
const beforeStale = structuredClone(manufacturingSession.state.document);
const staleRevision = manufacturingSession.state.revision;
assert.throws(
  () =>
    advanced(manufacturingSession, {
      kind: 'set-manufacturing-excluded',
      target: { ...manufacturingTarget, key: 'stale' },
      excluded: true,
    }),
  /失效/,
);
assert.equal(manufacturingSession.state.revision, staleRevision);
assert.deepEqual(manufacturingSession.state.document, beforeStale);

const beforeCopy = structuredClone(manufacturingSession.state.document);
advanced(manufacturingSession, {
  kind: 'copy-nodes',
  nodeIds: [manufacturingShape],
});
const copiedShape =
  manufacturingSession.state.lastChange.selectionIntent.activeRef.id;
const copiedRegion = publishedRegions(
  manufacturingSession.state.document,
  copiedShape,
)[0].ref;
assert.notEqual(
  outputIdentity(copiedRegion),
  outputIdentity(manufacturingTarget),
);
assert.ok(
  Object.values(manufacturingSession.state.document.appearances.overrides).some(
    (item) => sameOutputRef(item.target, copiedRegion),
  ),
  'copy remaps appearance OutputRef to the live copied output',
);
assert.ok(
  Object.values(
    manufacturingSession.state.document.reliefDefinitions.overrides,
  ).some((item) => sameOutputRef(item.target, copiedRegion)),
  'copy remaps relief OutputRef to the live copied output',
);
assert.ok(
  Object.values(
    manufacturingSession.state.document.manufacturing.assignments,
  ).some((item) => sameOutputRef(item.target, copiedRegion)),
  'copy remaps Part OutputRef to the live copied output',
);
assert.ok(
  manufacturingSession.state.document.manufacturing.excluded.some((target) =>
    sameOutputRef(target, copiedRegion),
  ),
  'copy remaps manufacturing exclusion OutputRef',
);
manufacturingSession.undo({
  expectedRevision: manufacturingSession.state.revision,
});
assert.deepEqual(manufacturingSession.state.document, beforeCopy);

const sceneSession = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
author(sceneSession, {
  kind: 'draw-path',
  points: square(5, 0, 1),
  closed: true,
});
const sceneShape = shapeIds(sceneSession.state.document)[0];
const beforeRotate = structuredClone(sceneSession.state.document);
advanced(sceneSession, {
  kind: 'rotate-nodes',
  nodeIds: [sceneShape],
  centerMM: [0, 0],
  angleRad: Math.PI / 2,
});
near(firstCurveWorldPoint(sceneSession.state.document, sceneShape), [0, 5]);
sceneSession.undo({ expectedRevision: sceneSession.state.revision });
assert.deepEqual(sceneSession.state.document, beforeRotate);
author(sceneSession, {
  kind: 'group-nodes',
  nodeIds: [sceneShape],
  name: '组',
});
const groupId = Object.values(sceneSession.state.document.nodes).find(
  (node) => node.kind === 'group',
).id;
author(sceneSession, {
  kind: 'draw-path',
  points: square(20, 0, 1),
  closed: true,
});
const secondShape = shapeIds(sceneSession.state.document).find(
  (id) => id !== sceneShape,
);
const secondWorld = worldMatrix(sceneSession.state.document, secondShape);
const beforeReparent = structuredClone(sceneSession.state.document);
advanced(sceneSession, {
  kind: 'reparent-nodes',
  nodeIds: [secondShape],
  parentId: groupId,
  keepWorld: true,
});
near(worldMatrix(sceneSession.state.document, secondShape), secondWorld);
sceneSession.undo({ expectedRevision: sceneSession.state.revision });
assert.deepEqual(sceneSession.state.document, beforeReparent);
const worldPointBeforeRebase = firstCurveWorldPoint(
  sceneSession.state.document,
  sceneShape,
);
const beforeRebase = structuredClone(sceneSession.state.document);
advanced(sceneSession, {
  kind: 'rebase-node',
  nodeId: sceneShape,
  pose: { translationMM: [2, 3], rotationRad: 0.3 },
});
near(
  firstCurveWorldPoint(sceneSession.state.document, sceneShape),
  worldPointBeforeRebase,
);
sceneSession.undo({ expectedRevision: sceneSession.state.revision });
assert.deepEqual(sceneSession.state.document, beforeRebase);
const beforeDelete = structuredClone(sceneSession.state.document);
advanced(sceneSession, { kind: 'delete-nodes', nodeIds: [secondShape] });
assert.equal(sceneSession.state.document.nodes[secondShape], undefined);
sceneSession.undo({ expectedRevision: sceneSession.state.revision });
assert.deepEqual(sceneSession.state.document, beforeDelete);

console.log(
  'PASS: V4 advanced commands compose real curve tasks, framed references, scene ownership, exact manufacturing, copy remapping, and one-step undo.',
);
