import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateCreation } from '../../../src/lib/creation-engine.mjs';
import { importLegacy } from '../../../src/lib/document/import/legacy-import.mjs';
import {
  defaultConstructionRegistry,
  evaluatePlanar,
} from '../../../src/lib/construction/document-evaluation.mjs';
import {
  buildDependencyGraph,
  topologicalComponents,
} from '../../../src/lib/construction/dependencies.mjs';
import {
  decodeDocument,
  encodeDocument,
} from '../../../src/lib/document/codec.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';
import { movePathHandle } from '../../../src/lib/geometry/path-handle-modes.mjs';
import { decodeProject } from '../../../src/lib/project-format.mjs';
import { readGeometry } from '../../../src/lib/region-engine.mjs';

const close = (actual, expected, tolerance, label) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} != ${expected}`,
  );
const refs = (value) => (Array.isArray(value) ? value : [value]);
const sameRef = (left, right) =>
  left.operatorId === right.operatorId && left.key === right.key;
const union = (geometries) =>
  geometries.reduce(
    (result, geometry) =>
      result ? result.union(readGeometry(geometry)) : readGeometry(geometry),
    null,
  );
const scaleGeometry = (geometry, factor) => {
  const coordinates = (value) =>
    typeof value[0] === 'number'
      ? value.map((coordinate) => coordinate * factor)
      : value.map(coordinates);
  return geometry.coordinates
    ? { ...geometry, coordinates: coordinates(geometry.coordinates) }
    : {
        ...geometry,
        geometries: geometry.geometries.map((item) =>
          scaleGeometry(item, factor),
        ),
      };
};
const handleModeCounts = (document) => {
  const counts = { smooth: 0, symmetric: 0 };
  for (const sketch of Object.values(document.sketches))
    for (const path of Object.values(sketch.paths))
      for (const mode of Object.values(path.handleModes || {})) counts[mode]++;
  return counts;
};

const verifyEvaluatedEquivalence = async (label, project, migrated) => {
  const roundtrip = decodeDocument(
    encodeDocument(migrated.document, { assets: migrated.assets }),
  );
  assert.deepEqual(roundtrip.document, migrated.document);
  assert.deepEqual(roundtrip.assets, migrated.assets);
  const legacy = evaluateCreation(project);
  assert.deepEqual(legacy.errors, [], `${label}: legacy evaluation failed`);
  const live = await evaluateDocument(migrated.document, {
    requestedDomains: ['regions', 'relief', 'placed-relief'],
  });
  for (const result of live.regions)
    assert.equal(
      result.status,
      'ready',
      `${label}: region evaluation ${result.ownerNodeId} is ${result.status}`,
    );
  assert.equal(live.relief.status, 'ready', `${label}: relief is not ready`);
  assert.equal(
    live.placedRelief.status,
    'ready',
    `${label}: placed relief is not ready`,
  );

  const liveRegions = live.regions.flatMap((result) => result.value.regions),
    liveReliefs = live.relief.value.reliefs,
    livePlaced = live.placedRelief.value.reliefs;
  let maxAreaDifferenceMM2 = 0;
  for (const legacyCell of legacy.cells) {
    const mappingKey = legacyCell.featureId
        ? `feature-output:${legacyCell.featureId}`
        : `surface-output:${legacyCell.key}`,
      targets = refs(migrated.idMap[mappingKey]).filter(Boolean),
      mappedRegions = targets.flatMap((target) =>
        liveRegions.filter((region) => sameRef(region.ref, target)),
      ),
      mappedReliefs = targets.flatMap((target) =>
        liveReliefs.filter((relief) => sameRef(relief.ref, target)),
      ),
      mappedPlaced = targets.flatMap((target) =>
        livePlaced.filter((relief) => sameRef(relief.ref, target)),
      );
    assert.ok(targets.length, `${label}: missing ${mappingKey}`);
    assert.equal(
      mappedRegions.length,
      targets.length,
      `${label}: incomplete region mapping for ${legacyCell.key}`,
    );
    assert.equal(
      mappedReliefs.length,
      targets.length,
      `${label}: incomplete relief mapping for ${legacyCell.key}`,
    );
    assert.equal(
      mappedPlaced.length,
      targets.length,
      `${label}: incomplete placement mapping for ${legacyCell.key}`,
    );
    const differenceMM2 = readGeometry(legacyCell.geometry)
      .symDifference(union(mappedRegions.map((region) => region.geometry)))
      .getArea();
    maxAreaDifferenceMM2 = Math.max(maxAreaDifferenceMM2, differenceMM2);
    assert.ok(
      differenceMM2 <= 0.001,
      `${label}: geometry drift ${differenceMM2} mm² for ${legacyCell.key}`,
    );
    for (const relief of mappedReliefs) {
      assert.equal(
        relief.color.toLowerCase(),
        legacyCell.color.toLowerCase(),
        `${label}: color mismatch for ${legacyCell.key}`,
      );
      if (Number.isInteger(legacyCell.heightLayers))
        assert.deepEqual(relief.thickness, {
          kind: 'layers',
          count: legacyCell.heightLayers,
        });
      else {
        assert.equal(relief.thickness.kind, 'mm');
        close(
          relief.thickness.value,
          legacyCell.heightMM,
          1e-6,
          `${label}: thickness ${legacyCell.key}`,
        );
      }
      assert.equal(relief.mode, legacyCell.mode ?? 'add');
      assert.equal(relief.enabled, legacyCell.enabled ?? true);
    }
    for (const placed of mappedPlaced) {
      close(
        placed.mm,
        legacyCell.heightMM,
        1e-6,
        `${label}: resolved thickness ${legacyCell.key}`,
      );
      if (Number.isInteger(legacyCell.heightLayers))
        assert.equal(
          placed.layers,
          legacyCell.heightLayers,
          `${label}: layer count mismatch for ${legacyCell.key}`,
        );
      close(
        placed.zBase,
        legacyCell.bottomMM,
        1e-6,
        `${label}: zBase ${legacyCell.key}`,
      );
    }
  }
  return {
    legacyCells: legacy.cells.length,
    liveRegions: liveRegions.length,
    maxAreaDifferenceMM2,
  };
};

// The real sample checks the legacy pixel frame against each uniquely owned V4
// path. Cross-object consumers reference that one writable source.
const sandroneProject = decodeProject(
  fs.readFileSync('public/sandrone-example.spl'),
);
const sandrone = importLegacy(sandroneProject);
const repeatedSandrone = importLegacy(sandroneProject);
assert.deepEqual(repeatedSandrone.document, sandrone.document);
assert.deepEqual(repeatedSandrone.idMap, sandrone.idMap);
const scale = sandroneProject.widthMM / sandroneProject.width;
let checkedCubics = 0;
for (const legacyPath of sandroneProject.paths) {
  const mapped = refs(sandrone.idMap[`path:${legacyPath.id}`]).filter(Boolean);
  assert.equal(
    mapped.length,
    1,
    `source owner is not unique: ${legacyPath.id}`,
  );
  const expected = legacyPath.curves.map((cubic) =>
    cubic.map((point) => [
      (point.x - sandroneProject.width / 2) * scale,
      (sandroneProject.height / 2 - point.y) * scale,
    ]),
  );
  for (const target of mapped) {
    const sketch = sandrone.document.sketches[target.sketchId],
      path = sketch.paths[target.id];
    assert.equal(path.edges.length, expected.length);
    path.edges.forEach((use, index) => {
      const edge = sketch.edges[use.edgeId],
        start = sketch.vertices[edge.startVertexId].position.value,
        end = sketch.vertices[edge.endVertexId].position.value,
        actual = [
          start,
          [
            start[0] + edge.startHandle.vector[0],
            start[1] + edge.startHandle.vector[1],
          ],
          [
            end[0] + edge.endHandle.vector[0],
            end[1] + edge.endHandle.vector[1],
          ],
          end,
        ];
      actual
        .flat()
        .forEach((value, coordinate) =>
          close(
            value,
            expected[index].flat()[coordinate],
            1e-9,
            `${legacyPath.id}:${index}:${coordinate}`,
          ),
        );
      checkedCubics++;
    });
  }
}
const sandroneModeCounts = handleModeCounts(sandrone.document);
assert.deepEqual(sandroneModeCounts, { smooth: 47, symmetric: 0 });
assert.deepEqual(sandrone.report.preserved.pathHandleModes, sandroneModeCounts);

// Stored modes preserve the old drag rule without normalizing the initial
// cubics. On the first real smooth node, a handle edit rotates the opposite
// handle while retaining its independent length.
const modeLegacyPath = sandroneProject.paths.find((path) =>
    path.nodeModes?.includes('smooth'),
  ),
  modeIndex = modeLegacyPath.nodeModes.indexOf('smooth'),
  modeDocument = structuredClone(sandrone.document),
  modePathRef = sandrone.idMap[`path:${modeLegacyPath.id}`],
  modeSketch = modeDocument.sketches[modePathRef.sketchId],
  modePath = modeSketch.paths[modePathRef.id],
  modeOutgoingEdge = modeSketch.edges[modePath.edges[modeIndex].edgeId],
  modeIncomingEdge =
    modeSketch.edges[
      modePath.edges[
        (modeIndex - 1 + modePath.edges.length) % modePath.edges.length
      ].edgeId
    ],
  modeVertexId = modeOutgoingEdge.startVertexId,
  originalIncomingLength = Math.hypot(...modeIncomingEdge.endHandle.vector),
  editedOutgoing = [
    modeOutgoingEdge.startHandle.vector[0] + 0.03,
    modeOutgoingEdge.startHandle.vector[1] - 0.02,
  ];
assert.equal(modePath.handleModes[modeVertexId], 'smooth');
movePathHandle(modeSketch, {
  pathId: modePath.id,
  edgeId: modeOutgoingEdge.id,
  end: 'start',
  vector: editedOutgoing,
});
const editedIncoming = modeIncomingEdge.endHandle.vector;
close(
  Math.hypot(...editedIncoming),
  originalIncomingLength,
  1e-9,
  'smooth opposite handle length',
);
close(
  editedIncoming[0] * editedOutgoing[1] - editedIncoming[1] * editedOutgoing[0],
  0,
  1e-9,
  'smooth handles remain collinear after edit',
);
assert.ok(
  editedIncoming[0] * editedOutgoing[0] +
    editedIncoming[1] * editedOutgoing[1] <
    0,
);
assert.equal(
  sandrone.report.copiedSources.length,
  sandroneProject.paths.length,
);
assert.ok(
  sandrone.report.copiedSources.every((entry) => entry.code === 'source-owned'),
);
const dependencyOrder = topologicalComponents(
  buildDependencyGraph(sandrone.document, defaultConstructionRegistry),
);
assert.deepEqual(
  dependencyOrder.cycles,
  [],
  'mutual object references to raw owned sources must remain acyclic',
);

// The outer source is consumed by ten other Shapes. Moving its single owned
// vertex must invalidate every reference without creating another writable Path.
const sharedOuterPathId = 'eff8e8cb-258f-4655-9773-544dd16604b2',
  sharedDocument = structuredClone(sandrone.document),
  sharedPathRef = sandrone.idMap[`path:${sharedOuterPathId}`],
  sharedSketch = sharedDocument.sketches[sharedPathRef.sketchId],
  sharedPath = sharedSketch.paths[sharedPathRef.id],
  sharedSource = Object.values(
    sharedDocument.programs[
      sharedDocument.nodes[sharedSketch.ownerNodeId].programId
    ].operators,
  ).find(
    (operator) =>
      operator.type === 'source' &&
      operator.inputs.paths.some((ref) =>
        ref.pathIds.includes(sharedPathRef.id),
      ),
  ),
  sharedReferences = Object.values(sharedDocument.programs)
    .flatMap((program) => Object.values(program.operators))
    .filter(
      (operator) =>
        operator.type === 'curve-reference' &&
        operator.inputs.input[0].operatorId === sharedSource.id,
    ),
  initialSharedEvaluation = evaluatePlanar(sharedDocument),
  initialSharedCurves = new Map(
    sharedReferences.map((operator) => [
      operator.id,
      structuredClone(
        initialSharedEvaluation.components[`operator:${operator.id}`].ports
          .curves.value.curves,
      ),
    ]),
  ),
  sharedEdge = sharedSketch.edges[sharedPath.edges[0].edgeId],
  sharedVertex = sharedSketch.vertices[sharedEdge.startVertexId];
assert.ok(sharedSource);
assert.equal(sharedReferences.length, 10);
assert.equal(
  Object.values(sharedDocument.sketches).filter((sketch) =>
    Object.hasOwn(sketch.paths, sharedPathRef.id),
  ).length,
  1,
);
sharedVertex.position.value[0] += 0.025;
sharedVertex.position.value[1] -= 0.015;
const editedSharedEvaluation = evaluatePlanar(sharedDocument);
for (const reference of sharedReferences) {
  const stage =
    editedSharedEvaluation.components[`operator:${reference.id}`].ports.curves;
  assert.equal(stage.status, 'ready');
  assert.notDeepEqual(
    stage.value.curves,
    initialSharedCurves.get(reference.id),
    `external source reference did not follow ${reference.id}`,
  );
}
const sandroneEquivalence = await verifyEvaluatedEquivalence(
  'built-in Sandrone',
  sandroneProject,
  sandrone,
);
assert.ok(
  !sandrone.report.issues.some(
    (issue) =>
      issue.code === 'multi-region-materialized' ||
      issue.code === 'surface-arrangement-materialized',
  ),
  'legacy MultiPolygon and surface arrangements must remain dynamic',
);
assert.equal(
  sandrone.report.issues.filter(
    (issue) => issue.code === 'surface-arrangement-compiled',
  ).length,
  3,
);
// The repaired between and both downstream intersections retain one stable
// OutputRef. Editing an owned source vertex must recompute that published
// feature instead of reading a frozen contour.
const dynamicSandroneDocument = structuredClone(sandrone.document),
  dynamicBandTarget = sandrone.idMap['feature-output:body-band-67'],
  dynamicBandPathId = 'b2e77804-53ea-44ac-a50f-f737a9cee455',
  dynamicBandPathRef = refs(sandrone.idMap[`path:${dynamicBandPathId}`]).find(
    (ref) =>
      dynamicSandroneDocument.sketches[ref.sketchId]?.ownerNodeId ===
      dynamicBandTarget.ownerNodeId,
  ),
  dynamicBandSketch =
    dynamicSandroneDocument.sketches[dynamicBandPathRef.sketchId],
  dynamicBandPath = dynamicBandSketch.paths[dynamicBandPathRef.id],
  dynamicBandEdge = dynamicBandSketch.edges[dynamicBandPath.edges[0].edgeId],
  dynamicBandVertex = dynamicBandSketch.vertices[dynamicBandEdge.endVertexId],
  dynamicBandRegion = () => {
    const stage = evaluatePlanar(dynamicSandroneDocument).components[
      `operator:${dynamicBandTarget.operatorId}`
    ].ports.regions;
    assert.equal(stage.status, 'ready');
    const region = stage.value.regions.find((item) =>
      sameRef(item.ref, dynamicBandTarget),
    );
    assert.ok(region);
    return region;
  },
  initialDynamicBand = dynamicBandRegion();
assert.ok(
  Object.values(dynamicSandroneDocument.programs)
    .flatMap((program) => Object.values(program.operators))
    .some(
      (operator) =>
        operator.type === 'between' && operator.params.repair === true,
    ),
);
dynamicBandVertex.position.value[0] += 0.02;
const editedDynamicBand = dynamicBandRegion();
assert.ok(
  readGeometry(initialDynamicBand.geometry)
    .symDifference(readGeometry(editedDynamicBand.geometry))
    .getArea() > 0.01,
  'editing a Sandrone band source vertex must recompute the MultiPolygon',
);

// The accepted legacy surface graph is compiled from its three unique base
// memberships. Its later hole modifier removes cell 0, while cell 1 keeps its
// stable style and follows edits to the right-eyebrow source.
const faceOwnerId = 'object-group-f69941cb-0b3b-45ef-b908-b0ca8ee3eff7',
  faceCell0Key = `${faceOwnerId}:cell:0`,
  faceCell1Key = `${faceOwnerId}:cell:1`,
  dynamicFaceDocument = structuredClone(sandrone.document),
  dynamicFaceTarget = sandrone.idMap[`surface-output:${faceCell1Key}`],
  removedFaceTarget = sandrone.idMap[`surface-output:${faceCell0Key}`],
  dynamicFacePathId = 'a0455790-6c2b-497d-93b5-988b751f7389',
  dynamicFacePathRef = refs(sandrone.idMap[`path:${dynamicFacePathId}`]).find(
    (ref) =>
      dynamicFaceDocument.sketches[ref.sketchId]?.ownerNodeId ===
      dynamicFaceTarget.ownerNodeId,
  ),
  dynamicFaceSketch = dynamicFaceDocument.sketches[dynamicFacePathRef.sketchId],
  dynamicFacePath = dynamicFaceSketch.paths[dynamicFacePathRef.id],
  dynamicFaceEdge = dynamicFaceSketch.edges[dynamicFacePath.edges[0].edgeId],
  dynamicFaceVertex = dynamicFaceSketch.vertices[dynamicFaceEdge.endVertexId],
  dynamicFaceRegion = () => {
    const stage =
      evaluatePlanar(dynamicFaceDocument).components[
        `operator:${dynamicFaceTarget.operatorId}`
      ].ports.regions;
    assert.equal(stage.status, 'ready');
    assert.equal(stage.value.regions.length, 2, 'hole must remove cell 0');
    assert.ok(
      !stage.value.regions.some((item) => sameRef(item.ref, removedFaceTarget)),
    );
    const region = stage.value.regions.find((item) =>
      sameRef(item.ref, dynamicFaceTarget),
    );
    assert.ok(region);
    return region;
  },
  initialDynamicFace = dynamicFaceRegion();
assert.ok(
  !Object.values(dynamicFaceDocument.programs)
    .flatMap((program) => Object.values(program.operators))
    .some((operator) => operator.id.includes('materialized-region')),
);
dynamicFaceVertex.position.value[0] += 0.02;
const editedDynamicFace = dynamicFaceRegion();
assert.ok(
  readGeometry(initialDynamicFace.geometry)
    .symDifference(readGeometry(editedDynamicFace.geometry))
    .getArea() > 0.01,
  'editing a face source vertex must recompute the surface arrangement',
);
const editedFaceEvaluation = await evaluateDocument(dynamicFaceDocument, {
    requestedDomains: ['relief'],
  }),
  editedFaceRelief = editedFaceEvaluation.relief.value.reliefs.find((item) =>
    sameRef(item.ref, dynamicFaceTarget),
  );
assert.equal(editedFaceEvaluation.relief.status, 'ready');
assert.equal(editedFaceRelief.color, '#e8cfbf');
assert.deepEqual(editedFaceRelief.thickness, { kind: 'layers', count: 8 });

// Open legacy path regions use Path's evaluated straight closure. It remains a
// derived boundary connection and does not add a hidden writable marker.
const closureDocument = structuredClone(sandrone.document),
  closureIssue = sandrone.report.issues.find(
    (issue) =>
      issue.code === 'implicit-region-closure-compiled' &&
      issue.ref?.id === 'source-39',
  ),
  closureProgram = Object.values(closureDocument.programs).find((program) =>
    Object.hasOwn(program.operators, closureIssue.operatorId),
  ),
  closureOperator = closureProgram.operators[closureIssue.operatorId],
  closurePathRef = refs(sandrone.idMap[`path:${dynamicFacePathId}`]).find(
    (ref) =>
      closureDocument.sketches[ref.sketchId]?.ownerNodeId ===
      dynamicFaceTarget.ownerNodeId,
  ),
  closureSketch = closureDocument.sketches[closurePathRef.sketchId],
  closurePath = closureSketch.paths[closurePathRef.id],
  closureFirstEdge = closureSketch.edges[closurePath.edges[0].edgeId],
  closureStartVertex = closureSketch.vertices[closureFirstEdge.startVertexId],
  closureStage = () =>
    evaluatePlanar(closureDocument).components[`operator:${closureOperator.id}`]
      .ports.regions,
  initialClosureStage = closureStage(),
  initialClosureGeometry = initialClosureStage.value.regions[0].geometry;
assert.equal(initialClosureStage.status, 'ready');
assert.equal(closureOperator.type, 'path');
assert.equal(closureOperator.params.closure, 'straight');
assert.equal('markerPathId' in closureIssue, false);
assert.ok(
  Object.values(closureDocument.sketches).every((sketch) =>
    Object.values(sketch.paths).every(
      (path) => !path.name.includes('动态直线封口标记'),
    ),
  ),
);
closureStartVertex.position.value[0] += 0.03;
closureStartVertex.position.value[1] -= 0.02;
const editedClosureEvaluation = evaluatePlanar(closureDocument),
  editedClosureStage =
    editedClosureEvaluation.components[`operator:${closureOperator.id}`].ports
      .regions,
  closureProvenance = editedClosureStage.value.provenance.find(
    (entry) => entry.kind === 'path' && entry.operatorId === closureOperator.id,
  ),
  movedEndpoint = closureStartVertex.position.value;
assert.equal(editedClosureStage.status, 'ready');
assert.ok(
  closureProvenance.boundaryConnections.every(
    (connection) => connection.kind === 'explicit-line',
  ),
);
assert.ok(
  closureProvenance.boundaryConnections.some(
    (connection) =>
      (connection.from[0] === movedEndpoint[0] &&
        connection.from[1] === movedEndpoint[1]) ||
      (connection.to[0] === movedEndpoint[0] &&
        connection.to[1] === movedEndpoint[1]),
  ),
);
assert.ok(
  readGeometry(initialClosureGeometry)
    .symDifference(readGeometry(editedClosureStage.value.regions[0].geometry))
    .getArea() > 0.001,
  'moving an open path endpoint must recompute its straight closure',
);

// This V1 fixture exercises legacy joinMM endpoint connections, partition
// topology, a paint spanning two cells, and per-output style/Z preservation.
const partitionProject = JSON.parse(
  fs.readFileSync('scripts/tests/fixtures/hair-partition.json', 'utf8'),
);
const oldPartition = evaluateCreation(partitionProject);
assert.deepEqual(oldPartition.errors, []);
const migratedPartition = importLegacy(partitionProject);
const livePartition = await evaluateDocument(migratedPartition.document, {
  requestedDomains: ['regions', 'relief', 'placed-relief'],
});
const owner = partitionProject.creation.objects[0],
  ownerNode = migratedPartition.idMap[`object:${owner.id}`],
  liveOwnerRegions = livePartition.regions.find((result) =>
    result.value?.regions?.some(
      (region) => region.ref.ownerNodeId === ownerNode.id,
    ),
  );
assert.ok(liveOwnerRegions);
assert.equal(liveOwnerRegions.status, 'ready');
assert.equal(
  liveOwnerRegions.value.regions.length,
  oldPartition.cells.filter((cell) => cell.objectId === owner.id).length,
);
assert.equal(livePartition.relief.status, 'ready');
assert.equal(livePartition.placedRelief.status, 'ready');

const oldCells = oldPartition.cells.filter((cell) =>
    cell.key.includes(':cell:'),
  ),
  swatches = new Map(
    partitionProject.creation.swatches.map((swatch) => [
      swatch.id,
      swatch.color.toLowerCase(),
    ]),
  );
for (const paint of owner.paints) {
  const frozen = readGeometry(
      scaleGeometry(paint.geometry, partitionProject.widthMM),
    ),
    oldMatches = oldCells.filter((cell) =>
      frozen.covers(readGeometry(cell.geometry).getInteriorPoint()),
    ),
    mapped = refs(migratedPartition.idMap[`paint-output:${paint.id}`]),
    newRegions = liveOwnerRegions.value.regions.filter((region) =>
      mapped.some((target) => sameRef(region.ref, target)),
    ),
    newReliefs = livePartition.relief.value.reliefs.filter((relief) =>
      mapped.some((target) => sameRef(relief.ref, target)),
    ),
    newPlaced = livePartition.placedRelief.value.reliefs.filter((relief) =>
      mapped.some((target) => sameRef(relief.ref, target)),
    );
  assert.ok(oldMatches.length);
  assert.equal(newRegions.length, mapped.length);
  assert.equal(newReliefs.length, mapped.length);
  assert.equal(newPlaced.length, mapped.length);
  const oldGeometry = union(oldMatches.map((cell) => cell.geometry)),
    newGeometry = union(newRegions.map((region) => region.geometry));
  assert.ok(
    oldGeometry.symDifference(newGeometry).getArea() <= 0.001,
    `partition geometry drift for paint ${paint.id}`,
  );
  for (const cell of oldMatches) {
    assert.equal(cell.swatchId, paint.swatchId);
    assert.equal(cell.heightMM, paint.heightMM);
  }
  for (const relief of newReliefs) {
    assert.equal(relief.color, swatches.get(paint.swatchId));
    assert.deepEqual(relief.thickness, { kind: 'mm', value: paint.heightMM });
  }
  for (const placed of newPlaced)
    close(
      placed.zBase,
      owner.zMM + paint.zOffsetMM,
      1e-6,
      `partition zBase ${paint.id}`,
    );
}

const point = (x, y) => ({ x, y });
const square = (id, low, high) => ({
  id,
  name: id,
  color: '#336699',
  curves: [
    [point(low, low), point(low, low), point(high, low), point(high, low)],
    [point(high, low), point(high, low), point(high, high), point(high, high)],
    [point(high, high), point(high, high), point(low, high), point(low, high)],
    [point(low, high), point(low, high), point(low, low), point(low, low)],
  ],
  start: point(low, low),
  closed: true,
  visible: true,
  quality: 1,
  anchors: [],
  groupId: 'group',
});
const holeProject = {
  version: 3,
  image: '',
  imageName: '',
  width: 100,
  height: 100,
  widthMM: 100,
  depthMM: 2,
  groups: [{ id: 'group', name: 'group' }],
  paths: [square('outer', 10, 90), square('hole', 35, 65)],
  model: {
    version: 1,
    toleranceMM: 0.01,
    regions: [
      {
        id: 'face',
        name: 'face',
        kind: 'path',
        pathId: 'outer',
        color: '#336699',
      },
    ],
    features: [
      {
        id: 'body',
        name: 'body',
        regionId: 'face',
        partId: 'main',
        mode: 'add',
        zMM: 1,
        heightMM: 2,
        attachId: '',
        enabled: true,
        color: '#336699',
      },
    ],
    parts: [{ id: 'main', name: 'main' }],
    manufacturingMM: 0,
  },
  creation: {
    version: 1,
    swatches: [{ id: 'blue', name: 'blue', color: '#336699' }],
    objects: [
      {
        id: 'object',
        name: 'object',
        pathIds: ['outer', 'hole'],
        roles: { hole: 'hole' },
        featureIds: ['body'],
        regionIds: [],
        featureSwatches: { body: 'blue' },
        swatchId: 'blue',
        heightMM: 2,
        zMM: 1,
        visible: true,
        printable: true,
        paints: [],
        modifiers: [
          {
            id: 'cut-hole',
            name: 'cut hole',
            type: 'boolean',
            operation: 'difference',
            input: { kind: 'path', id: 'hole' },
            enabled: true,
            targets: { kind: 'all' },
            rolePathId: 'hole',
          },
        ],
        sources: {},
      },
    ],
  },
};
const oldHole = evaluateCreation(holeProject);
assert.deepEqual(oldHole.errors, []);
assert.equal(oldHole.cells.length, 1);
assert.equal(oldHole.cells[0].holes, 1);
const migratedHole = importLegacy(holeProject),
  liveHole = await evaluateDocument(migratedHole.document, {
    requestedDomains: ['regions', 'relief', 'placed-relief'],
  }),
  holeRegion = liveHole.regions[0].value.regions[0],
  holeRelief = liveHole.relief.value.reliefs[0],
  placedHole = liveHole.placedRelief.value.reliefs[0];
assert.equal(holeRegion.geometry.coordinates.length, 2);
assert.ok(
  readGeometry(oldHole.cells[0].geometry)
    .symDifference(readGeometry(holeRegion.geometry))
    .getArea() <= 0.001,
);
assert.equal(holeRelief.color, oldHole.cells[0].color);
assert.deepEqual(holeRelief.thickness, {
  kind: 'mm',
  value: oldHole.cells[0].heightMM,
});
close(placedHole.zBase, oldHole.cells[0].bottomMM, 1e-6, 'hole zBase');

// Independent legacy features remain separate outputs in one collected
// RegionSet. A forward reference in the feature list also proves that
// attachment binding is deferred until every feature OutputRef is known.
const featureProject = {
  version: 3,
  image: '',
  imageName: '',
  width: 100,
  height: 100,
  widthMM: 100,
  depthMM: 2,
  groups: [{ id: 'group', name: 'group' }],
  paths: [
    square('base-path', 5, 25),
    square('child-path', 40, 60),
    square('free-path', 75, 95),
  ],
  model: {
    version: 1,
    toleranceMM: 0.01,
    regions: [
      { id: 'base-face', kind: 'path', pathId: 'base-path', color: '#aa0000' },
      {
        id: 'child-face',
        kind: 'path',
        pathId: 'child-path',
        color: '#00aa00',
      },
      { id: 'free-face', kind: 'path', pathId: 'free-path', color: '#0000aa' },
    ],
    features: [
      {
        id: 'base-feature',
        regionId: 'base-face',
        partId: 'main',
        mode: 'add',
        zMM: 1,
        heightMM: 2,
        attachId: '',
        enabled: true,
      },
      {
        id: 'child-feature',
        regionId: 'child-face',
        partId: 'main',
        mode: 'add',
        zMM: 0.5,
        heightMM: 1,
        attachId: 'base-feature',
        enabled: true,
      },
      {
        id: 'free-feature',
        regionId: 'free-face',
        partId: 'main',
        mode: 'add',
        zMM: 0.25,
        heightMM: 1.5,
        attachId: '',
        enabled: true,
      },
    ],
    parts: [{ id: 'main', name: 'main' }],
    manufacturingMM: 0,
  },
  creation: {
    version: 1,
    swatches: [
      { id: 'red', name: 'red', color: '#aa0000' },
      { id: 'green', name: 'green', color: '#00aa00' },
      { id: 'blue', name: 'blue', color: '#0000aa' },
    ],
    objects: [
      {
        id: 'feature-object',
        name: 'feature object',
        pathIds: ['base-path', 'child-path', 'free-path'],
        roles: {},
        featureIds: ['child-feature', 'free-feature', 'base-feature'],
        regionIds: [],
        featureSwatches: {
          'base-feature': 'red',
          'child-feature': 'green',
          'free-feature': 'blue',
        },
        swatchId: 'red',
        heightMM: 2,
        zMM: 0,
        visible: true,
        printable: true,
        paints: [],
        modifiers: [],
        sources: {},
      },
    ],
  },
};
const oldFeatures = evaluateCreation(featureProject);
assert.deepEqual(oldFeatures.errors, []);
const migratedFeatures = importLegacy(featureProject);
assert.ok(
  Object.values(migratedFeatures.document.programs)
    .flatMap((program) => Object.values(program.operators))
    .some((operator) => operator.type === 'region-collect'),
);
let liveFeatures = await evaluateDocument(migratedFeatures.document, {
  requestedDomains: ['regions', 'relief', 'placed-relief'],
});
assert.equal(liveFeatures.regions[0].status, 'ready');
assert.equal(liveFeatures.regions[0].value.regions.length, 3);
assert.equal(liveFeatures.relief.status, 'ready');
assert.equal(liveFeatures.placedRelief.status, 'ready');
for (const oldCell of oldFeatures.cells) {
  const target = migratedFeatures.idMap[`feature-output:${oldCell.featureId}`],
    nextRegion = liveFeatures.regions[0].value.regions.find((item) =>
      sameRef(item.ref, target),
    ),
    nextRelief = liveFeatures.relief.value.reliefs.find((item) =>
      sameRef(item.ref, target),
    ),
    nextPlaced = liveFeatures.placedRelief.value.reliefs.find((item) =>
      sameRef(item.ref, target),
    );
  assert.ok(nextRegion);
  assert.ok(nextRelief);
  assert.ok(nextPlaced);
  assert.ok(
    readGeometry(oldCell.geometry)
      .symDifference(readGeometry(nextRegion.geometry))
      .getArea() <= 0.001,
  );
  assert.equal(nextRelief.color, oldCell.color);
  assert.deepEqual(nextRelief.thickness, {
    kind: 'mm',
    value: oldCell.heightMM,
  });
  close(nextPlaced.zBase, oldCell.bottomMM, 1e-6, `${oldCell.featureId} zBase`);
}
const baseTarget = migratedFeatures.idMap['feature-output:base-feature'],
  baseOverride = Object.values(
    migratedFeatures.document.reliefDefinitions.overrides,
  ).find((item) => sameRef(item.target, baseTarget));
assert.ok(baseOverride);
baseOverride.value.thickness = { kind: 'mm', value: 4 };
liveFeatures = await evaluateDocument(migratedFeatures.document, {
  requestedDomains: ['placed-relief'],
});
const childTarget = migratedFeatures.idMap['feature-output:child-feature'],
  movedChild = liveFeatures.placedRelief.value.reliefs.find((item) =>
    sameRef(item.ref, childTarget),
  );
close(movedChild.zBase, 5.5, 1e-6, 'dynamic attached child zBase');

const optionalProjectPath =
  process.env.SPLINELET_LEGACY_EQUIVALENCE_PROJECT || process.argv[2];
let optionalEquivalence = null;
if (optionalProjectPath) {
  assert.ok(
    fs.existsSync(optionalProjectPath),
    `optional legacy project does not exist: ${optionalProjectPath}`,
  );
  const optionalProject = decodeProject(fs.readFileSync(optionalProjectPath)),
    optionalMigration = importLegacy(optionalProject);
  assert.deepEqual(handleModeCounts(optionalMigration.document), {
    smooth: 48,
    symmetric: 0,
  });
  optionalEquivalence = await verifyEvaluatedEquivalence(
    optionalProjectPath,
    optionalProject,
    optionalMigration,
  );
  const curveOwner = optionalProject.creation.objects.find(
      (object) =>
        object.modifiers?.some(
          (modifier) => modifier.type === 'curve_mirror',
        ) &&
        object.modifiers?.some((modifier) => modifier.type === 'curve_array') &&
        object.modifiers?.some((modifier) => modifier.type === 'fill'),
    ),
    shapeRef = optionalMigration.idMap[`object:${curveOwner.id}`],
    program = Object.values(optionalMigration.document.programs).find(
      (candidate) => candidate.ownerNodeId === shapeRef.id,
    ),
    join = Object.values(program.operators).find(
      (operator) => operator.type === 'join',
    ),
    array = Object.values(program.operators).find(
      (operator) => operator.type === 'curve-array',
    ),
    fill = Object.values(program.operators).find(
      (operator) => operator.type === 'fill',
    ),
    fillKey = curveOwner.modifiers.find((modifier) => modifier.type === 'fill')
      .outputContract[0].key,
    fillTarget = optionalMigration.idMap[`surface-output:${fillKey}`],
    sketch = Object.values(optionalMigration.document.sketches).find(
      (candidate) => candidate.ownerNodeId === shapeRef.id,
    );
  assert.ok(join, 'gold curve pipeline must compile an explicit Join');
  assert.equal(join.params.connections.length, 6);
  assert.deepEqual(
    new Set(Object.values(program.operators).map((operator) => operator.type)),
    new Set(['source', 'curve-mirror', 'curve-array', 'join', 'fill']),
  );
  assert.ok(
    join.params.connections.every(
      (connection) =>
        connection.a.selector.index === 'each' &&
        ['each', 'next', 'previous'].includes(connection.b.selector.index),
    ),
  );
  assert.ok(
    !optionalMigration.report.issues.some(
      (issue) => issue.code === 'tolerance-fill-materialized',
    ),
  );
  const fillStage = () =>
      evaluatePlanar(optionalMigration.document).components[
        `operator:${fill.id}`
      ].ports.regions,
    initialStage = fillStage(),
    initialRegion = initialStage.value.regions.find((region) =>
      sameRef(region.ref, fillTarget),
    ),
    sourcePath =
      sketch.paths[
        refs(optionalMigration.idMap[`path:${curveOwner.pathIds[0]}`]).find(
          (ref) => ref.sketchId === sketch.id,
        ).id
      ],
    firstEdge = sketch.edges[sourcePath.edges[0].edgeId],
    interiorVertex = sketch.vertices[firstEdge.endVertexId];
  assert.equal(initialStage.status, 'ready');
  assert.ok(initialRegion);
  interiorVertex.position.value[0] += 0.05;
  const editedStage = fillStage(),
    editedRegion = editedStage.value.regions.find((region) =>
      sameRef(region.ref, fillTarget),
    );
  assert.equal(editedStage.status, 'ready');
  assert.ok(editedRegion);
  assert.ok(
    readGeometry(initialRegion.geometry)
      .symDifference(readGeometry(editedRegion.geometry))
      .getArea() > 0.0001,
    'editing a gold source vertex must recompute the filled result',
  );
  array.params.count = 3;
  const changedArrayEvaluation = evaluatePlanar(optionalMigration.document),
    changedArrayStage =
      changedArrayEvaluation.components[`operator:${fill.id}`].ports.regions,
    changedJoinStage =
      changedArrayEvaluation.components[`operator:${join.id}`].ports.curves;
  assert.equal(changedArrayStage.status, 'blocked');
  assert.ok(
    changedJoinStage.diagnostics.some(
      (diagnostic) => diagnostic.code === 'join-gap',
    ),
    'changed array count must re-run the repeated Join selectors',
  );
  assert.ok(
    changedArrayStage.diagnostics.some(
      (diagnostic) => diagnostic.code === 'fill-blocked',
    ),
    'changing the gold array count must re-evaluate its repeated Join',
  );
}

console.log(
  `v4 legacy equivalence: ${checkedCubics} cubics; built-in Sandrone ${sandroneEquivalence.legacyCells} legacy cells -> ${sandroneEquivalence.liveRegions} V4 regions (max drift ${sandroneEquivalence.maxAreaDifferenceMM2} mm²); ${owner.paints.length} partition paints, hole/style/Z and 3 collected features passed${optionalEquivalence ? `; optional project ${optionalEquivalence.legacyCells} legacy cells -> ${optionalEquivalence.liveRegions} V4 regions (max drift ${optionalEquivalence.maxAreaDifferenceMM2} mm²)` : ''}`,
);
