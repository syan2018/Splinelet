import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openProject } from '../../../src/lib/persistence/open-project.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';
import { creationOutput } from '../../../src/lib/editor/creation-output.mjs';
import { meshSTL } from '../../../src/lib/mesh-format.mjs';

const files = [
  new URL('../../../public/sandrone-example.spl', import.meta.url),
];
if (process.argv[2]) files.push(process.argv[2]);
for (const file of files) {
  const { document } = openProject({ bytes: readFileSync(file) });
  assert.equal(document.manufacturing.cleanupRadiusMM, 0.02);
  const before = structuredClone(document);
  const snapshot = await evaluateDocument(document, {
    requestedDomains: ['bodies'],
  });
  assert.equal(
    snapshot.bodies.status,
    'ready',
    JSON.stringify(snapshot.bodies.diagnostics),
  );
  assert.deepEqual(document, before);
  for (const body of snapshot.bodies.value.bodies) {
    assert.equal(body.report.valid, true);
    assert.equal(body.report.invalidEdges, 0);
    assert.equal(body.report.zeroArea, 0);
    assert.equal(body.report.components, 1);
    assert.ok(meshSTL(body.mesh).byteLength > 84);
    const total = body.materialParts.reduce(
      (sum, part) => sum + part.volumeMM3,
      0,
    );
    assert.ok(
      Math.abs(total - body.report.volumeMM3) <
        Math.max(0.001, body.report.volumeMM3 * 1e-5),
    );
    const output = creationOutput(document, snapshot, '3mf', {
      partId: body.partId,
    });
    assert.ok(output.bytes.byteLength > 100);
    console.log(
      JSON.stringify({
        sample: String(file),
        triangles: body.report.triangles,
        volumeMM3: body.report.volumeMM3,
        components: body.report.components,
        materialParts: body.materialParts.length,
      }),
    );
  }
  const withoutCleanupDocument = structuredClone(document);
  withoutCleanupDocument.manufacturing.cleanupRadiusMM = 0;
  const withoutCleanupSnapshot = await evaluateDocument(
    withoutCleanupDocument,
    {
      requestedDomains: ['bodies'],
    },
  );
  assert.equal(
    withoutCleanupSnapshot.bodies.status,
    'ready',
    JSON.stringify(withoutCleanupSnapshot.bodies.diagnostics),
  );
  for (const body of withoutCleanupSnapshot.bodies.value.bodies) {
    assert.equal(body.report.valid, true);
    assert.equal(body.report.invalidEdges, 0);
    assert.equal(body.report.zeroArea, 0);
    assert.equal(body.report.components, 1);
    assert.equal(body.materialParts.length > 0, true);
    const total = body.materialParts.reduce(
      (sum, part) => sum + part.volumeMM3,
      0,
    );
    assert.ok(
      Math.abs(total - body.report.volumeMM3) <
        Math.max(0.001, body.report.volumeMM3 * 1e-5),
    );
  }
}
console.log(
  'PASS real Sandrone canonical bodies preserve topology, valid STL and material 3MF with stored 0.02 mm cleanup and cleanup disabled without changing source',
);
