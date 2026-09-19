import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decodeProject } from '../../../src/lib/project-format.mjs';
import {
  importLegacy,
  LegacyImportError,
} from '../../../src/lib/document/import/legacy-import.mjs';
import { validateDocument } from '../../../src/lib/document/schema.mjs';
import { resolveSketch } from '../../../src/lib/geometry/sketch.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import {
  ambiguousPaintProject,
  unsupportedProject,
  v1Project,
  v2SharedProject,
  v3ProgramProject,
} from '../fixtures/v4-migration/legacy-projects.mjs';

for (const { version, make } of [
  { version: 1, make: v1Project },
  { version: 2, make: v2SharedProject },
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

const v1 = importLegacy(v1Project());
assert.equal(Object.values(v1.document.nodes).length, 1);
assert.equal(Object.values(v1.document.collections)[0].origin, 'legacy');
const v1Sketch = Object.values(v1.document.sketches)[0];
const curveResult = resolveSketch(v1.document, v1Sketch.id);
assert.equal(curveResult.status, 'ready');
assert.deepEqual(curveResult.value.curves[0].edges[0].cubic, [
  [5, 30],
  [10, 30],
  [15, 30],
  [20, 30],
]);
assert.equal(curveResult.value.curves[0].closed, true);
assert.equal(Object.keys(v1.assets).length, 1);
assert.deepEqual(Object.keys(v1.assets), Object.keys(v1.document.assets));

const shared = importLegacy(v2SharedProject());
assert.equal(Object.values(shared.document.nodes).length, 2);
assert.equal(
  shared.report.copiedSources.filter((entry) => entry.pathId === 'outline')
    .length,
  2,
);
assert.ok(
  shared.report.issues.some((entry) => entry.code === 'shared-source-copied'),
);
const sharedPathMap = shared.idMap['path:outline'];
assert.ok(Array.isArray(sharedPathMap));
assert.equal(sharedPathMap.length, 2);
assert.notEqual(sharedPathMap[0].sketchId, sharedPathMap[1].sketchId);
const [leftSketch, rightSketch] = Object.values(shared.document.sketches);
assert.equal(
  new Set([
    ...Object.keys(leftSketch.vertices),
    ...Object.keys(rightSketch.vertices),
  ]).size,
  Object.keys(leftSketch.vertices).length +
    Object.keys(rightSketch.vertices).length,
);

const v3 = importLegacy(v3ProgramProject());
const shape = Object.values(v3.document.nodes)[0];
const program = v3.document.programs[shape.programId];
assert.deepEqual(
  Object.values(program.operators).map((entry) => entry.type),
  ['source', 'path', 'offset'],
);
assert.equal(Object.values(program.operators).at(-1).enabled, false);
assert.equal(v3.document.geometrySettings.curveToleranceMM, 0.02);
assert.equal(v3.document.manufacturing.layerHeightMM, 0.2);
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

const sandrone = importLegacy(
  decodeProject(fs.readFileSync('public/sandrone-example.spl')),
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
  'PASS: V1-V3 one-way import, cubic conversion, source copying, program/style/manufacturing mapping, and structured refusal.',
);
