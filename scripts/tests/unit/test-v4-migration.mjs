import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decodeProject } from '../../../src/lib/project-format.mjs';
import {
  importLegacy,
  LegacyImportError,
} from '../../../src/lib/document/import/legacy-import.mjs';
import { validateDocument } from '../../../src/lib/document/schema.mjs';
import {
  decodeDocument,
  encodeDocument,
} from '../../../src/lib/document/codec.mjs';
import { resolveSketch } from '../../../src/lib/geometry/sketch.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';
import { evaluateCreation } from '../../../src/lib/creation-engine.mjs';
import { projectCreationView } from '../../../src/lib/editor/creation-view.mjs';
import { sameOutputRef } from '../../../src/lib/relief/appearance.mjs';
import {
  transformPoint,
  worldMatrix,
} from '../../../src/lib/scene/transforms.mjs';
import {
  ambiguousPaintProject,
  unsupportedProject,
  v1Project,
  v2SharedProject,
  v3ProgramProject,
} from '../fixtures/v4-migration/legacy-projects.mjs';

for (const { version, make } of [
  { version: 1, make: v1Project },
  {
    version: 2,
    make: () => {
      const project = v2SharedProject();
      project.creation.objects[1].pathIds = [];
      return project;
    },
  },
  { version: 3, make: v3ProgramProject },
]) {
  const input = make();
  const migrated = importLegacy(input);
  assert.equal(migrated.documentV4.version, 4);
  assert.equal(migrated.report.sourceVersion, version);
  assert.equal(migrated.report.compiler, `v${version}-to-v4`);
  assert.equal(validateDocument(migrated.documentV4), migrated.documentV4);
  assert.deepEqual(input, make(), `V${version} input must not be mutated`);
  assert.ok(Object.keys(migrated.idMap).length > 0);
}

const singlePointProject = (version) => {
  const project = v1Project();
  project.version = version;
  project.paths = [
    {
      ...project.paths[0],
      id: 'point-path',
      name: '单节点',
      curves: [],
      start: { x: 0, y: 0 },
      anchors: [{ x: 0, y: 0 }],
      nodeModes: ['corner'],
      closed: false,
      visible: false,
    },
  ];
  return project;
};
for (const version of [1, 2, 3]) {
  const input = singlePointProject(version),
    migrated = importLegacy(input),
    pathRef = migrated.idMap['path:point-path'],
    vertexRef = migrated.idMap['vertex:point-path:0'],
    sketch = migrated.document.sketches[pathRef.sketchId],
    path = sketch.paths[pathRef.id];
  assert.equal(migrated.report.sourceVersion, version);
  assert.equal(path.name, '单节点');
  assert.equal(path.visible, false);
  assert.deepEqual(path.edges, []);
  assert.equal(path.handleModes, undefined);
  assert.equal(path.startVertexId, vertexRef.id);
  assert.equal(vertexRef.kind, 'vertex');
  assert.equal(vertexRef.sketchId, sketch.id);
  assert.deepEqual(sketch.vertices[vertexRef.id].position, {
    kind: 'free',
    value: [-25, 20],
  });
  assert.deepEqual(
    transformPoint(
      worldMatrix(migrated.document, sketch.ownerNodeId),
      sketch.vertices[vertexRef.id].position.value,
    ),
    [-25, 20],
  );
  assert.deepEqual(Object.keys(sketch.edges), []);
  const groupRef = migrated.idMap['group:legacy-group'];
  assert.deepEqual(migrated.document.collections[groupRef.id].members, [
    pathRef,
  ]);
  const roundtrip = decodeDocument(
    encodeDocument(migrated.document, { assets: migrated.assets }),
  );
  assert.deepEqual(roundtrip.document, migrated.document);
  assert.deepEqual(roundtrip.assets, migrated.assets);
  assert.deepEqual(input, singlePointProject(version));
}

const closedPoint = singlePointProject(3);
closedPoint.paths[0].closed = true;
assert.throws(
  () => importLegacy(closedPoint),
  (error) =>
    error instanceof LegacyImportError &&
    error.report.issues.some((entry) => entry.code === 'closed-empty-path'),
);

const v1 = importLegacy(v1Project());
assert.equal(Object.values(v1.document.nodes).length, 1);
assert.equal(Object.values(v1.document.collections)[0].origin, 'legacy');
const v1Sketch = Object.values(v1.document.sketches)[0];
const curveResult = resolveSketch(v1.document, v1Sketch.id);
assert.equal(curveResult.status, 'ready');
assert.deepEqual(curveResult.value.curves[0].edges[0].cubic, [
  [-20, 10],
  [-15, 10],
  [-10, 10],
  [-5, 10],
]);
assert.equal(curveResult.value.curves[0].closed, true);
assert.equal(Object.keys(v1.assets).length, 1);
assert.deepEqual(Object.keys(v1.assets), Object.keys(v1.document.assets));

let ambiguousOwner;
try {
  importLegacy(v2SharedProject());
} catch (error) {
  ambiguousOwner = error;
}
assert.ok(ambiguousOwner instanceof LegacyImportError);
assert.ok(
  ambiguousOwner.report.issues.some(
    (entry) =>
      entry.code === 'ambiguous-path-owner' &&
      entry.ref?.id === 'outline' &&
      entry.ownerIds.join(',') === 'left,right',
  ),
);

const v3 = importLegacy(v3ProgramProject());
const shape = Object.values(v3.document.nodes)[0];
const program = v3.document.programs[shape.programId];
assert.deepEqual(
  Object.values(program.operators).map((entry) => entry.type),
  ['source', 'path', 'offset'],
);
const importedPathRegion = Object.values(program.operators).find(
  (entry) => entry.type === 'path',
);
assert.deepEqual(importedPathRegion.params, {
  rule: 'even-odd',
  closure: 'straight',
});
assert.equal(Object.values(program.operators).at(-1).enabled, false);
assert.equal(v3.document.geometrySettings.curveToleranceMM, 0.02);
assert.equal(v3.document.manufacturing.layerHeightMM, 0.2);
assert.equal(v3.document.manufacturing.cleanupRadiusMM, 0);
assert.equal(Object.values(v3.document.manufacturing.parts)[0].name, '主零件');
assert.equal(v3.document.manufacturing.slicerTemplate.kind, 'bambu');
assert.ok(v3.idMap['feature-output:body']);
assert.ok(v3.idMap['surface-output:badge:surface:1']);
assert.equal(
  v3.document.reliefDefinitions.defaults[shape.id].placement.kind,
  'layer',
);
assert.equal(
  Object.values(v3.document.reliefDefinitions.overrides).some(
    (entry) => entry.value.thickness?.kind === 'layers',
  ),
  true,
);
const evaluated = evaluateProgram(v3.document, shape.id);
assert.equal(evaluated.regions.status, 'ready');
const liveKeys = new Set(
  evaluated.regions.value.regions.map((entry) => entry.ref.key),
);
for (const entry of Object.values(v3.document.reliefDefinitions.overrides))
  assert.ok(
    liveKeys.has(entry.target.key),
    'migrated per-output relief must bind a live V4 output',
  );

// Two features may use the same Region at different heights. Import must
// preserve both identities and a live attachment, including after save/reopen.
const sharedRegion = v3ProgramProject();
delete sharedRegion.creation.printStack;
const sharedOwner = sharedRegion.creation.objects[0];
delete sharedOwner.printLayerId;
delete sharedOwner.surfaceGraph;
sharedOwner.modifiers = [];
const attachedBody = sharedRegion.model.features[0];
delete attachedBody.heightLayers;
attachedBody.attachId = 'support';
const support = { ...attachedBody, id: 'support', zMM: 0, heightMM: 5 };
delete support.attachId;
sharedRegion.model.features.unshift(support);
sharedOwner.featureIds = ['support', 'body'];
const importedShared = importLegacy(sharedRegion);
assert.equal(importedShared.report.status, 'ok');
const sharedDocument = decodeDocument(
  encodeDocument(importedShared.document, { assets: importedShared.assets }),
).document;
assert.deepEqual(sharedDocument, importedShared.document);
const evaluateCells = async (document) => {
  const snapshot = await evaluateDocument(document, {
    requestedDomains: ['regions', 'relief', 'placed-relief'],
  });
  assert.equal(snapshot.placedRelief.status, 'ready');
  return projectCreationView(document, snapshot).cells;
};
const sharedCells = await evaluateCells(sharedDocument);
assert.equal(sharedCells.length, 2);
assert.notEqual(sharedCells[0].key, sharedCells[1].key);
assert.deepEqual(
  sharedCells.map(({ bottomMM, heightMM }) => [bottomMM, heightMM]),
  evaluateCreation(structuredClone(sharedRegion)).cells.map(
    ({ bottomMM, heightMM }) => [bottomMM, heightMM],
  ),
);
const supportRef = importedShared.idMap['feature-output:support'];
const supportOverride = Object.values(
  sharedDocument.reliefDefinitions.overrides,
).find((entry) => sameOutputRef(entry.target, supportRef));
supportOverride.value.thickness = { kind: 'mm', value: 7 };
const updatedCells = await evaluateCells(sharedDocument);
const updatedBody = updatedCells.find((cell) =>
  sameOutputRef(cell.outputRef, importedShared.idMap['feature-output:body']),
);
assert.ok(
  Math.abs(updatedBody.bottomMM - 7.4) < 1e-10,
  'attached feature must continue following its independently identified support',
);
const hiddenSupport = structuredClone(sharedRegion);
hiddenSupport.creation.objects[0].replacedFeatureIds = ['support'];
const importedHidden = importLegacy(hiddenSupport);
assert.equal(importedHidden.report.status, 'ok-with-warnings');
assert.ok(
  importedHidden.report.issues.some(
    (issue) => issue.code === 'attachment-flattened-unpublished-target',
  ),
);
assert.equal((await evaluateCells(importedHidden.document)).length, 1);

const cyclicAttachment = structuredClone(sharedRegion);
cyclicAttachment.model.features.find(
  (feature) => feature.id === 'body',
).attachId = 'body';
const importedCycle = importLegacy(cyclicAttachment);
assert.equal(importedCycle.report.status, 'ok-with-warnings');
assert.ok(
  importedCycle.report.issues.some(
    (issue) =>
      issue.code === 'imported-output-blocked' &&
      issue.domain === 'placed-relief',
  ),
  'schema-valid import must surface blocked final placement',
);

const sandrone = importLegacy(
  decodeProject(fs.readFileSync('scripts/tests/fixtures/legacy-sandrone.spl')),
);
assert.equal(sandrone.report.sourceVersion, 3);
assert.ok(Object.keys(sandrone.document.nodes).length > 1);
assert.ok(
  sandrone.report.issues.some(
    (entry) => entry.code === 'cross-owner-source-referenced',
  ),
);
assert.equal(validateDocument(sandrone.document), sandrone.document);

for (const [make, code] of [
  [unsupportedProject, 'unsupported-modifier'],
  [ambiguousPaintProject, 'spatial-paint-ambiguous'],
]) {
  let caught;
  try {
    importLegacy(make());
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof LegacyImportError);
  assert.equal(caught.report.status, 'failed');
  assert.ok(caught.report.issues.some((entry) => entry.code === code));
  assert.equal(
    'document' in caught,
    false,
    'failed imports must not expose a partial V4 document',
  );
}

assert.throws(
  () => importLegacy({ version: 4 }),
  (error) =>
    error instanceof LegacyImportError &&
    error.report.issues.some((entry) => entry.code === 'unsupported-version'),
);

console.log(
  'PASS: V1-V3 one-way import, cubic and point-path conversion, unique source ownership, program/style/manufacturing mapping, and structured refusal.',
);
