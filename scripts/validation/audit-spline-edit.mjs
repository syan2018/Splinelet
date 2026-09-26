import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeDocument } from '../../src/lib/document/codec.mjs';
import { evaluateDocument } from '../../src/lib/evaluation/evaluate-document.mjs';
import { sameOutputRef } from '../../src/lib/construction/output-identity.mjs';
import { readGeometry } from '../../src/lib/region-engine.mjs';

// Read-only diagnostic, not an editor or a repair tool. The unbound experiment
// operates on an in-memory clone and never writes contracts or assignments.
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(
    'node scripts/validation/audit-spline-edit.mjs --before <baseline.spl> --after <edited.spl> [--probe-unbound]',
  );
  process.exit(0);
}
const files = {};
let probeUnbound = false;
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (arg === '--probe-unbound') probeUnbound = true;
  else if (arg === '--before' || arg === '--after') {
    const value = args[++index];
    if (!value || value.startsWith('--')) throw Error(`${arg} requires a file`);
    if (files[arg]) throw Error(`Duplicate argument: ${arg}`);
    files[arg] = resolve(value);
  } else throw Error(`Unknown argument: ${arg}`);
}
if (!files['--before'] || !files['--after'])
  throw Error('Both --before and --after are required; see --help');

const hash = (value) => createHash('sha256').update(value).digest('hex');
const jsonHash = (value) => hash(JSON.stringify(value));
const load = (file) => {
  const bytes = readFileSync(file);
  return {
    file,
    sha256: hash(bytes),
    document: decodeDocument(new Uint8Array(bytes)).document,
  };
};
const before = load(files['--before']);
const after = load(files['--after']);
const documentHashes = [jsonHash(before.document), jsonHash(after.document)];
const requestedDomains = ['curves', 'regions', 'relief', 'placed-relief'];
const inspect = (document) => evaluateDocument(document, { requestedDomains });
const diagnostic = (item) => ({
  code: item.code ?? item.kind,
  message: item.message,
});
const summarize = (snapshot, document) => ({
  regions: snapshot.regions.map((stage) => ({
    ownerNodeId: stage.ownerNodeId,
    name: document.nodes[stage.ownerNodeId]?.name,
    status: stage.status,
    count: stage.value?.regions.length ?? null,
  })),
  blockedComponents: Object.entries(snapshot.planar.components).flatMap(
    ([componentId, component]) =>
      Object.entries(component.ports ?? {}).flatMap(([port, stage]) =>
        stage.status === 'blocked'
          ? [
              {
                componentId,
                port,
                diagnostics: stage.diagnostics.map(diagnostic),
              },
            ]
          : [],
      ),
  ),
  reliefStatus: snapshot.relief.status,
  placedReliefStatus: snapshot.placedRelief.status,
});
const beforeSnapshot = await inspect(before.document);
const afterSnapshot = await inspect(after.document);

const compare = (oldSnapshot, newSnapshot) =>
  newSnapshot.regions.flatMap((stage) => {
    const old = oldSnapshot.regions.find(
      (candidate) => candidate.ownerNodeId === stage.ownerNodeId,
    );
    if (stage.status !== 'ready' || old?.status !== 'ready') return [];
    const previous = old.value.regions;
    const current = stage.value.regions;
    const retainedRefs = current.filter((region) =>
      previous.some((item) => sameOutputRef(item.ref, region.ref)),
    ).length;
    const unchangedGeometryCount = current.filter((region) =>
      previous.some(
        (item) => jsonHash(item.geometry) === jsonHash(region.geometry),
      ),
    ).length;
    if (
      current.length === previous.length &&
      retainedRefs === current.length &&
      unchangedGeometryCount === current.length
    ) {
      // Still check each binding: identical sets can hide a permutation.
      const unchangedBindings = current.every((region) => {
        const item = previous.find((candidate) =>
          sameOutputRef(candidate.ref, region.ref),
        );
        return jsonHash(item.geometry) === jsonHash(region.geometry);
      });
      if (unchangedBindings) return [];
    }
    return [
      {
        ownerNodeId: stage.ownerNodeId,
        name: after.document.nodes[stage.ownerNodeId]?.name,
        beforeCount: previous.length,
        afterCount: current.length,
        retainedRefs,
        unchangedGeometryCount,
        faces: current.map((region, index) => {
          const geometry = readGeometry(region.geometry);
          const identicalRef = previous.find((item) =>
            sameOutputRef(item.ref, region.ref),
          );
          const differences = previous
            .map((item, beforeIndex) => ({
              beforeIndex,
              symmetricDifferenceMM2: geometry
                .symDifference(readGeometry(item.geometry))
                .getArea(),
            }))
            .sort(
              (a, b) => a.symmetricDifferenceMM2 - b.symmetricDifferenceMM2,
            );
          return {
            index,
            areaMM2: geometry.getArea(),
            sameRefGeometryDifferenceMM2: identicalRef
              ? geometry
                  .symDifference(readGeometry(identicalRef.geometry))
                  .getArea()
              : null,
            // Comparison evidence only. These candidates MUST NOT write bindings.
            smallestGeometryDifferences: differences.slice(0, 2),
          };
        }),
      },
    ];
  });

const changedSections = [
  ...new Set([...Object.keys(before.document), ...Object.keys(after.document)]),
].filter(
  (section) =>
    JSON.stringify(before.document[section]) !==
    JSON.stringify(after.document[section]),
);
const report = {
  scope: 'Read-only file comparison and evaluation; no automatic repair.',
  before: {
    file: before.file,
    sha256: before.sha256,
    ...summarize(beforeSnapshot, before.document),
  },
  after: {
    file: after.file,
    sha256: after.sha256,
    ...summarize(afterSnapshot, after.document),
  },
  changedSections,
  changedSketchIds: [
    ...new Set([
      ...Object.keys(before.document.sketches),
      ...Object.keys(after.document.sketches),
    ]),
  ].filter(
    (id) =>
      JSON.stringify(before.document.sketches[id]) !==
      JSON.stringify(after.document.sketches[id]),
  ),
  changedReadyOutputs: compare(beforeSnapshot, afterSnapshot),
};
if (probeUnbound) {
  const candidate = structuredClone(after.document);
  let removedContracts = 0;
  for (const program of Object.values(candidate.programs)) {
    for (const operator of Object.values(program.operators)) {
      if (!operator.outputContract) continue;
      delete operator.outputContract;
      removedContracts++;
    }
  }
  const snapshot = await inspect(candidate);
  report.unboundExperiment = {
    warning:
      'In-memory diagnostic only. Ready geometry does not validate identity or repair assignments.',
    removedContracts,
    ...summarize(snapshot, candidate),
    changedReadyOutputs: compare(beforeSnapshot, snapshot),
  };
}
report.inputDocumentsUnchanged =
  documentHashes[0] === jsonHash(before.document) &&
  documentHashes[1] === jsonHash(after.document);
report.inputFilesUnchanged =
  before.sha256 === hash(readFileSync(before.file)) &&
  after.sha256 === hash(readFileSync(after.file));
console.log(JSON.stringify(report, null, 2));
if (!report.inputDocumentsUnchanged || !report.inputFilesUnchanged)
  process.exitCode = 1;
