import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluatePlanar } from '../../../src/lib/construction/document-evaluation.mjs';
import { regionSources } from '../../../src/lib/creation-schema.mjs';
import { importLegacy } from '../../../src/lib/document/import/legacy-import.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';
import {
  ADVANCED_ACTIONS,
  createAdvancedCommand,
} from '../../../src/lib/editing/commands/advanced.mjs';
import { readGeometry } from '../../../src/lib/region-engine.mjs';

const project = JSON.parse(
  fs.readFileSync('scripts/tests/fixtures/hair-partition.json', 'utf8'),
);
const migration = importLegacy(project);
const owner = project.creation.objects[0];
const ownerNodeId = migration.idMap[`object:${owner.id}`].id;
const program = Object.values(migration.document.programs).find(
  (candidate) => candidate.ownerNodeId === ownerNodeId,
);
const partition = Object.values(program.operators).find(
  (candidate) =>
    candidate.type === 'partition' && candidate.params.endpointJoin,
);
assert.ok(partition, 'legacy partition must compile an endpointJoin policy');

const partitionStage = (document) =>
  evaluatePlanar(document).components[`operator:${partition.id}`].ports.regions;
const connectionProvenance = (stage) =>
  stage.value.provenance.find(
    (item) => item.kind === 'partition-endpoint-join',
  );
const refIdentity = (ref) =>
  JSON.stringify([
    ref.ownerNodeId,
    ref.operatorId,
    ref.port,
    ref.key,
    ref.lineage,
    ref.instances,
  ]);
const geometryDifference = (left, right) => {
  const previous = new Map(
    left.value.regions.map((item) => [refIdentity(item.ref), item.geometry]),
  );
  return right.value.regions.reduce((sum, item) => {
    const geometry = previous.get(refIdentity(item.ref));
    return (
      sum +
      (geometry
        ? readGeometry(geometry)
            .symDifference(readGeometry(item.geometry))
            .getArea()
        : readGeometry(item.geometry).getArea())
    );
  }, 0);
};
const sketchPath = (document, pathId) => {
  const sketch = Object.values(document.sketches).find((candidate) =>
    Object.hasOwn(candidate.paths, pathId),
  );
  assert.ok(sketch, `Path ${pathId} must have one owning Sketch`);
  return { sketch, path: sketch.paths[pathId] };
};
const endpointVertex = (document, pathId, endpoint) => {
  const { sketch, path } = sketchPath(document, pathId);
  const use = endpoint === 0 ? path.edges[0] : path.edges.at(-1);
  const edge = sketch.edges[use.edgeId];
  const vertexId =
    endpoint === 0
      ? use.reversed
        ? edge.endVertexId
        : edge.startVertexId
      : use.reversed
        ? edge.startVertexId
        : edge.endVertexId;
  return sketch.vertices[vertexId];
};

const initial = partitionStage(migration.document);
assert.equal(initial.status, 'ready', JSON.stringify(initial.diagnostics));
const initialConnections = connectionProvenance(initial).connections;
assert.ok(initialConnections.length > 0);
const canonicalPathIds = new Set(
  Object.values(migration.document.sketches).flatMap((sketch) =>
    Object.keys(sketch.paths),
  ),
);
for (const pathId of [
  ...partition.params.endpointJoin.cohorts.flat(),
  ...partition.params.endpointJoin.disabled.map((item) => item.pathId),
])
  assert.ok(
    canonicalPathIds.has(pathId),
    'endpointJoin persists only canonical V4 Path IDs',
  );

const connection = initialConnections[0];
const dividerDocument = structuredClone(migration.document);
const dividerVertex = endpointVertex(
  dividerDocument,
  connection.pathId,
  connection.endpoint,
);
dividerVertex.position.value[0] += 0.01;
dividerVertex.position.value[1] += 0.01;
const movedDivider = partitionStage(dividerDocument);
assert.equal(
  movedDivider.status,
  'ready',
  JSON.stringify(movedDivider.diagnostics),
);
assert.deepEqual(
  movedDivider.value.regions.map((item) => item.ref),
  initial.value.regions.map((item) => item.ref),
  'moving a divider keeps the bound output contract',
);
const movedConnection = connectionProvenance(movedDivider).connections.find(
  (item) =>
    item.pathId === connection.pathId && item.endpoint === connection.endpoint,
);
assert.ok(movedConnection);
assert.notDeepEqual(movedConnection.from, connection.from);
assert.notDeepEqual(movedConnection.to, connection.to);
assert.ok(geometryDifference(initial, movedDivider) > 1e-7);

const baseLegacyPathId = regionSources(
  project.model,
  owner.baseRegionIds[0],
)[0];
const baseRef = migration.idMap[`path:${baseLegacyPathId}`];
const baseDocument = structuredClone(migration.document);
const { sketch: baseSketch, path: basePath } = sketchPath(
  baseDocument,
  baseRef.id,
);
const baseUse = basePath.edges[0];
const baseEdge = baseSketch.edges[baseUse.edgeId];
const baseVertex =
  baseSketch.vertices[
    baseUse.reversed ? baseEdge.endVertexId : baseEdge.startVertexId
  ];
baseVertex.position.value[0] += 0.01;
baseVertex.position.value[1] += 0.01;
const movedBase = partitionStage(baseDocument);
assert.equal(movedBase.status, 'ready', JSON.stringify(movedBase.diagnostics));
assert.deepEqual(
  movedBase.value.regions.map((item) => item.ref),
  initial.value.regions.map((item) => item.ref),
  'moving the base keeps the bound output contract',
);
assert.ok(geometryDifference(initial, movedBase) > 1e-7);

for (const edited of [dividerDocument, baseDocument]) {
  const evaluated = await evaluateDocument(edited, {
    requestedDomains: ['regions', 'relief'],
  });
  assert.equal(evaluated.relief.status, 'ready');
  assert.ok(
    evaluated.relief.value.reliefs.some(
      (item) => item.ref.ownerNodeId === ownerNodeId,
    ),
    'style and thickness assignments remain bound after dynamic edits',
  );
}

let nextCopyId = 0;
const copied = createAdvancedCommand({
  kind: ADVANCED_ACTIONS.copyNodes,
  nodeIds: [ownerNodeId],
})(structuredClone(migration.document), {
  idFactory: () => `partition-copy-${++nextCopyId}`,
});
const copiedOwnerId = copied.changedRefs[0].id;
const copiedProgram = Object.values(copied.document.programs).find(
  (candidate) => candidate.ownerNodeId === copiedOwnerId,
);
const copiedPartition = Object.values(copiedProgram.operators).find(
  (candidate) => candidate.type === 'partition',
);
const copiedInitial = evaluatePlanar(copied.document).components[
  `operator:${copiedPartition.id}`
].ports.regions;
assert.equal(
  copiedInitial.status,
  'ready',
  JSON.stringify(copiedInitial.diagnostics),
);
assert.ok(
  copiedInitial.value.regions.every(
    (region) => region.ref.ownerNodeId === copiedOwnerId,
  ),
  'copied output refs must use the copied owner identity',
);
const copiedPathIds = new Set(
  Object.values(copied.document.sketches)
    .filter((sketch) => sketch.ownerNodeId === copiedOwnerId)
    .flatMap((sketch) => Object.keys(sketch.paths)),
);
for (const pathId of [
  ...copiedPartition.params.endpointJoin.cohorts.flat(),
  ...copiedPartition.params.endpointJoin.disabled.map((item) => item.pathId),
])
  assert.ok(
    copiedPathIds.has(pathId),
    'copied endpointJoin policy must use copied canonical Path IDs',
  );

const copiedConnection = connectionProvenance(copiedInitial).connections[0];
const editedCopy = structuredClone(copied.document);
const copiedDividerVertex = endpointVertex(
  editedCopy,
  copiedConnection.pathId,
  copiedConnection.endpoint,
);
copiedDividerVertex.position.value[0] += 0.01;
copiedDividerVertex.position.value[1] += 0.01;
const copiedMoved =
  evaluatePlanar(editedCopy).components[`operator:${copiedPartition.id}`].ports
    .regions;
assert.equal(
  copiedMoved.status,
  'ready',
  JSON.stringify(copiedMoved.diagnostics),
);
assert.deepEqual(
  copiedMoved.value.regions.map((item) => item.ref),
  copiedInitial.value.regions.map((item) => item.ref),
  'copied partition keeps its remapped contract after a divider edit',
);
assert.ok(geometryDifference(copiedInitial, copiedMoved) > 1e-7);
const copiedEvaluation = await evaluateDocument(editedCopy, {
  requestedDomains: ['regions', 'relief'],
});
assert.equal(
  copiedEvaluation.relief.status,
  'ready',
  JSON.stringify(copiedEvaluation.relief.diagnostics),
);
assert.ok(
  copiedEvaluation.relief.value.reliefs.some(
    (item) => item.ref.ownerNodeId === copiedOwnerId,
  ),
  'copied appearance and relief refs must follow the remapped partition identity',
);

const selectedSource = structuredClone(migration.document);
const selectedProgram = selectedSource.programs[program.id];
const selectedPartition = selectedProgram.operators[partition.id];
const selectedInput = selectedPartition.inputs.input[0];
const selectedInputStage =
  evaluatePlanar(selectedSource).components[
    `operator:${selectedInput.operatorId}`
  ].ports[selectedInput.port];
selectedPartition.params.scope = {
  kind: 'selected',
  refs: [selectedInputStage.value.regions[0].ref],
};
delete selectedPartition.params.endpointJoin.disabled;
delete selectedPartition.outputContract;
const selectedProposalStage =
  evaluatePlanar(selectedSource).components[`operator:${selectedPartition.id}`]
    .ports.regions;
assert.equal(selectedProposalStage.status, 'ready');
selectedPartition.outputContract = {
  version: 1,
  members: selectedProposalStage.value.provenance.find(
    (item) => item.kind === 'output-contract-proposal',
  ).members,
};
let nextSelectedCopyId = 0;
const selectedCopy = createAdvancedCommand({
  kind: ADVANCED_ACTIONS.copyNodes,
  nodeIds: [ownerNodeId],
})(selectedSource, {
  idFactory: () => `selected-partition-copy-${++nextSelectedCopyId}`,
});
const selectedCopyOwnerId = selectedCopy.changedRefs[0].id;
const selectedCopyProgram = Object.values(selectedCopy.document.programs).find(
  (candidate) => candidate.ownerNodeId === selectedCopyOwnerId,
);
const selectedCopyPartition = Object.values(selectedCopyProgram.operators).find(
  (candidate) => candidate.type === 'partition',
);
assert.equal(selectedCopyPartition.params.endpointJoin.disabled, undefined);
assert.equal(
  selectedCopyPartition.params.scope.refs[0].ownerNodeId,
  selectedCopyOwnerId,
  'selected scope OutputRef must use the copied owner',
);
assert.notEqual(
  selectedCopyPartition.params.scope.refs[0].operatorId,
  selectedPartition.params.scope.refs[0].operatorId,
  'selected scope OutputRef must use the copied upstream operator',
);
const selectedCopyStage = evaluatePlanar(selectedCopy.document).components[
  `operator:${selectedCopyPartition.id}`
].ports.regions;
assert.equal(
  selectedCopyStage.status,
  'ready',
  JSON.stringify(selectedCopyStage.diagnostics),
);

console.log(
  'PASS imported and copied partition endpoint connections recompute after divider/base edits while output, style, and thickness identities stay bound',
);
