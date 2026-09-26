import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createDocument } from '../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../src/lib/editing/commands/authoring.mjs';
import { evaluateProgram } from '../../src/lib/construction/document-evaluation.mjs';
import { evaluateDocument } from '../../src/lib/evaluation/evaluate-document.mjs';
import {
  sameOutputRef,
  outputIdentity,
} from '../../src/lib/construction/output-identity.mjs';
import { readGeometry } from '../../src/lib/region-engine.mjs';

// Generated authoring fixture only: no input files, writes, browser, or repairs.
// --check tests desired invariants, not that a known defect still occurs.
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('node scripts/validation/audit-region-identity.mjs [--check]');
  process.exit(0);
}
if (args.some((arg) => arg !== '--check'))
  throw Error('Unknown argument; see --help');
const tolerance = 1e-9;
const geometryDifference = (left, right) =>
  readGeometry(left).symDifference(readGeometry(right)).getArea();
const centroid = (geometry) => {
  const point = readGeometry(geometry).getCentroid().getCoordinate();
  return [point.x, point.y];
};
const refHash = (ref) =>
  createHash('sha256').update(outputIdentity(ref)).digest('hex').slice(0, 16);

function fixture(points) {
  let serial = 0;
  const idFactory = () => `identity-audit-${++serial}`;
  const session = createEditorSession(createDocument({ idFactory }), {
    idFactory,
  });
  const run = (action) =>
    session.dispatch(createAuthoringCommand(action), {
      expectedRevision: session.state.revision,
    });
  run({
    kind: 'draw-path',
    points: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    closed: true,
  });
  const ownerNodeId = Object.keys(session.state.document.nodes)[0];
  const base = evaluateProgram(session.state.document, ownerNodeId).regions
    .value.regions[0].ref;
  run({ kind: 'create-swatch', name: 'initial', color: '#888888' });
  const initialSwatch = Object.keys(
    session.state.document.appearances.swatches,
  )[0];
  run({ kind: 'paint-region', target: base, swatchId: initialSwatch });
  run({
    kind: 'set-thickness',
    target: base,
    thickness: { kind: 'mm', value: 1 },
  });
  const knownSketches = new Set(Object.keys(session.state.document.sketches));
  run({
    kind: 'start-path',
    role: 'divider',
    point: points[0],
    ownerNodeId,
    targets: [base],
  });
  const sketch = Object.values(session.state.document.sketches).find(
    (item) => !knownSketches.has(item.id),
  );
  const pathId = Object.keys(sketch.paths)[0];
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1],
      to = points[index];
    run({
      kind: 'extend-path',
      sketchId: sketch.id,
      pathId,
      cubic: [from, from, to, to],
    });
  }
  run({ kind: 'finish-path', sketchId: sketch.id, pathId });
  const output = evaluateProgram(session.state.document, ownerNodeId).regions;
  assert.equal(output.status, 'ready', 'Fixture must initially evaluate');
  assert.equal(output.value.regions.length, 2);
  const sorted = [...output.value.regions].sort(
    (a, b) => centroid(a.geometry)[1] - centroid(b.geometry)[1],
  );
  run({ kind: 'create-swatch', name: 'lower-red', color: '#ff0000' });
  run({ kind: 'create-swatch', name: 'upper-blue', color: '#0000ff' });
  const swatches = Object.keys(
    session.state.document.appearances.swatches,
  ).slice(-2);
  for (let index = 0; index < sorted.length; index++) {
    const target = sorted[index].ref;
    run({ kind: 'paint-region', target, swatchId: swatches[index] });
    run({
      kind: 'set-thickness',
      target,
      thickness: { kind: 'mm', value: index ? 2.5 : 1.25 },
    });
  }
  return { session, run, ownerNodeId, sketchId: sketch.id, pathId };
}

async function capture(document, ownerNodeId) {
  const snapshot = await evaluateDocument(document, {
    requestedDomains: ['regions', 'relief'],
  });
  const stage = snapshot.regions.find(
    (item) => item.ownerNodeId === ownerNodeId,
  );
  assert.ok(stage, 'Fixture owner must have a published stage');
  const reliefs = snapshot.relief.value?.reliefs ?? [];
  return {
    status: stage.status,
    reliefStatus: snapshot.relief.status,
    diagnosticCodes: [
      ...new Set(
        Object.values(snapshot.planar.components).flatMap((component) =>
          Object.values(component.ports ?? {}).flatMap((port) =>
            port.status === 'blocked'
              ? port.diagnostics.map((item) => item.code ?? item.kind)
              : [],
          ),
        ),
      ),
    ],
    faces: (stage.value?.regions ?? []).map((region) => {
      const relief = reliefs.find((item) =>
        sameOutputRef(item.ref, region.ref),
      );
      return {
        ref: region.ref,
        geometry: region.geometry,
        color: relief?.color ?? null,
        thicknessMM: relief?.thickness.value ?? null,
      };
    }),
  };
}
const faceSummary = (face) => ({
  refHash: refHash(face.ref),
  centroidMM: centroid(face.geometry),
  areaMM2: readGeometry(face.geometry).getArea(),
  color: face.color,
  thicknessMM: face.thicknessMM,
});
const summary = (snapshot) => ({
  ...snapshot,
  faces: snapshot.faces.map(faceSummary),
});
function compare(before, after) {
  const bindings = before.faces.map((previous) => {
    const candidates = after.faces.filter((next) =>
      sameOutputRef(previous.ref, next.ref),
    );
    const next = candidates.length === 1 ? candidates[0] : null;
    return {
      before: faceSummary(previous),
      after: next ? faceSummary(next) : null,
      matchingRefCount: candidates.length,
      symmetricDifferenceMM2: next
        ? geometryDifference(previous.geometry, next.geometry)
        : null,
      sameAttributes:
        !!next &&
        previous.color === next.color &&
        previous.thicknessMM === next.thicknessMM,
    };
  });
  const geometrySetUnchanged =
    before.faces.length === after.faces.length &&
    before.faces.every(
      (face) =>
        after.faces.filter(
          (next) =>
            geometryDifference(face.geometry, next.geometry) <= tolerance,
        ).length === 1,
    );
  return {
    geometrySetUnchanged,
    bindings,
    expectedInvariantPassed:
      before.faces.length === 2 &&
      after.status === 'ready' &&
      after.reliefStatus === 'ready' &&
      geometrySetUnchanged &&
      bindings.every(
        (binding) =>
          binding.matchingRefCount === 1 &&
          binding.sameAttributes &&
          binding.symmetricDifferenceMM2 <= tolerance,
      ),
  };
}

const reverseFixture = fixture([
  [-1, 5],
  [11, 5],
]);
const reverseBefore = await capture(
  reverseFixture.session.state.document,
  reverseFixture.ownerNodeId,
);
assert.equal(reverseBefore.reliefStatus, 'ready');
assert.deepEqual(
  reverseBefore.faces.map((face) => [face.color, face.thicknessMM]).sort(),
  [
    ['#0000ff', 2.5],
    ['#ff0000', 1.25],
  ],
);
reverseFixture.run({
  kind: 'reverse-path',
  sketchId: reverseFixture.sketchId,
  pathId: reverseFixture.pathId,
});
const reverseAfter = await capture(
  reverseFixture.session.state.document,
  reverseFixture.ownerNodeId,
);
const reverseComparison = compare(reverseBefore, reverseAfter);

const deleteFixture = fixture([
  [-1, 5],
  [5, 5],
  [11, 5],
]);
const deleteBefore = await capture(
  deleteFixture.session.state.document,
  deleteFixture.ownerNodeId,
);
const sketch =
  deleteFixture.session.state.document.sketches[deleteFixture.sketchId];
const usesBefore = structuredClone(sketch.paths[deleteFixture.pathId].edges);
assert.equal(usesBefore.length, 2);
deleteFixture.run({
  kind: 'delete-path-vertices',
  pathRef: { kind: 'path', sketchId: sketch.id, id: deleteFixture.pathId },
  vertexIds: [sketch.edges[usesBefore[0].edgeId].endVertexId],
  expectedEdges: usesBefore,
  toleranceMM: 0.001,
});
const deleteDocument = deleteFixture.session.state.document;
const deleteAfter = await capture(deleteDocument, deleteFixture.ownerNodeId);
const deleteComparison = compare(deleteBefore, deleteAfter);

// Isolate geometry from the existing saved-contract failure. This clone is
// never handed back to the editor and does not repair assignments.
const diagnosticDocument = structuredClone(deleteDocument);
for (const program of Object.values(diagnosticDocument.programs)) {
  for (const operator of Object.values(program.operators))
    delete operator.outputContract;
}
const unbound = await capture(diagnosticDocument, deleteFixture.ownerNodeId);
const diagnosticComparison = compare(deleteBefore, unbound);
const report = {
  scope:
    'Real authoring commands and Document/Program/appearance/relief evaluation, generated square only.',
  desiredInvariant:
    'Equivalent source representation preserves each authored region and its physical color/thickness assignment.',
  reversePath: {
    before: summary(reverseBefore),
    after: summary(reverseAfter),
    ...reverseComparison,
  },
  deleteCollinearVertex: {
    before: summary(deleteBefore),
    after: summary(deleteAfter),
    ...deleteComparison,
    unboundDiagnosticOnly: {
      warning:
        'Disposable in-memory copy; not a repair or an acceptance of the edited document.',
      after: summary(unbound),
      geometrySetUnchanged: diagnosticComparison.geometrySetUnchanged,
      bindings: diagnosticComparison.bindings,
    },
  },
  expectedInvariantsPassed:
    reverseComparison.expectedInvariantPassed &&
    deleteComparison.expectedInvariantPassed,
};
console.log(JSON.stringify(report, null, 2));
if (args.includes('--check') && !report.expectedInvariantsPassed)
  process.exitCode = 1;
