import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decodeProject } from '../../../src/lib/project-format.mjs';
import { importLegacy } from '../../../src/lib/document/import/legacy-import.mjs';
import { evaluateCreation } from '../../../src/lib/creation-engine.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';
import { createStudioSession } from '../../../src/lib/editor/studio-session.mjs';
import { beginV4PathGesture } from '../../../src/lib/source-editor/path-gesture.mjs';
import { translatePaths } from '../../../src/lib/source-editor/selection.mjs';
import { readGeometry } from '../../../src/lib/region-engine.mjs';

const samples = [
  ['Sandrone', decodeProject(fs.readFileSync('public/sandrone-example.spl'))],
  [
    'partition paint',
    JSON.parse(
      fs.readFileSync('scripts/tests/fixtures/hair-partition.json', 'utf8'),
    ),
  ],
];
const sameRef = (left, right) =>
  left.ownerNodeId === right.ownerNodeId &&
  left.operatorId === right.operatorId &&
  left.port === right.port &&
  left.key === right.key;
const transformGeometry = (geometry, transform) => {
  const visit = (coordinates) =>
    typeof coordinates[0] === 'number'
      ? transform(coordinates)
      : coordinates.map(visit);
  return { ...geometry, coordinates: visit(geometry.coordinates) };
};

for (const [name, project] of samples) {
  const imported = importLegacy(project);
  const session = createStudioSession({
    opened: {
      kind: 'legacy',
      document: imported.document,
      assets: imported.assets,
    },
    presentation: {
      reference: null,
      frame: {
        width: project.width,
        height: project.height,
        widthMM: project.widthMM,
      },
      newReliefDepthMM: 2,
      fileName: null,
    },
    persistence: { writeFile: async () => {} },
  });
  const original = session.getSnapshot();
  const paths = original.runtime.readSourceView(original.project).source.paths;
  const selectedOwner =
    project.creation.objects.find((owner) => owner.name === '头发') ||
    project.creation.objects[0];
  const selectedOwnerId = imported.idMap[`object:${selectedOwner.id}`].id;
  const gesture = beginV4PathGesture({
    runtime: original.runtime,
    project: original.project,
    pathIds: paths
      .filter(
        (path) => name !== 'Sandrone' || path.ownerNodeId === selectedOwnerId,
      )
      .map((path) => path.id),
  });
  gesture.update({ x: 12, y: -8 });
  gesture.commit();
  const movedDocument = session.getSnapshot().editorState.document;
  const legacyMoved = structuredClone(project);
  translatePaths(
    legacyMoved,
    name === 'Sandrone'
      ? selectedOwner.pathIds
      : project.paths.map((path) => path.id),
    12,
    -8,
  );
  const legacy = evaluateCreation(legacyMoved);
  if (name === 'Sandrone') assert.deepEqual(legacy.errors, [], name);
  else
    assert.ok(
      legacy.errors.some((error) => error.stage === 'appearance'),
      'the old spatial lookup is not a usable post-move oracle',
    );
  const live = await evaluateDocument(movedDocument, {
    requestedDomains: ['regions', 'relief'],
  });
  for (const stage of live.regions)
    assert.equal(stage.status, 'ready', JSON.stringify(stage.diagnostics));
  assert.equal(
    live.relief.status,
    'ready',
    JSON.stringify(live.relief.diagnostics),
  );
  const regions = live.regions.flatMap((stage) => stage.value.regions);
  if (name !== 'Sandrone') {
    // This old fixture's spatial appearance lookup fails after translation.
    // Compare against its verified pre-move cells transformed by the same delta,
    // rather than treating the legacy fallback/error result as desired behavior.
    const before = evaluateCreation(project);
    assert.deepEqual(before.errors, []);
    const scale = project.widthMM / project.width;
    for (const paint of selectedOwner.paints) {
      const frozen = readGeometry(
        transformGeometry(paint.geometry, ([x, y]) => [
          x * project.widthMM,
          y * project.widthMM,
        ]),
      );
      const cells = before.cells.filter(
        (cell) =>
          cell.objectId === selectedOwner.id &&
          cell.key.includes(':cell:') &&
          frozen.covers(readGeometry(cell.geometry).getInteriorPoint()),
      );
      assert.ok(cells.length);
      const expected = cells
        .map((cell) =>
          readGeometry(
            transformGeometry(cell.geometry, ([x, y]) => [
              x + 12 * scale,
              y + 8 * scale,
            ]),
          ),
        )
        .reduce((a, b) => a.union(b));
      const mapped = imported.idMap[`paint-output:${paint.id}`];
      const refs = Array.isArray(mapped) ? mapped : [mapped];
      const matches = refs.flatMap((ref) =>
        regions.filter((region) => sameRef(ref, region.ref)),
      );
      assert.equal(matches.length, refs.length);
      const actual = matches
        .map((region) => readGeometry(region.geometry))
        .reduce((a, b) => a.union(b));
      assert.ok(
        actual.symDifference(expected).getArea() < 0.001,
        `translated paint geometry ${paint.id}: ${actual.symDifference(expected).getArea()} cells ${cells.length} vs ${matches.length}`,
      );
      const reliefs = refs.flatMap((ref) =>
        live.relief.value.reliefs.filter((relief) => sameRef(ref, relief.ref)),
      );
      assert.equal(reliefs.length, refs.length);
      const color = project.creation.swatches.find(
        (swatch) => swatch.id === paint.swatchId,
      ).color;
      for (const relief of reliefs) {
        assert.equal(relief.color.toLowerCase(), color.toLowerCase());
        assert.deepEqual(relief.thickness, {
          kind: 'mm',
          value: paint.heightMM,
        });
      }
    }
    assert.equal(selectedOwner.paints.length, 11);
  }
  for (const cell of name === 'Sandrone' ? legacy.cells : []) {
    const key = cell.featureId
      ? `feature-output:${cell.featureId}`
      : `surface-output:${cell.key}`;
    const mapping = imported.idMap[key];
    const targets = Array.isArray(mapping) ? mapping : [mapping];
    assert.ok(targets.every(Boolean), `${name}: missing ${key}`);
    const matches = targets.flatMap((ref) =>
      regions.filter((region) => sameRef(ref, region.ref)),
    );
    assert.equal(
      matches.length,
      targets.length,
      `${name}: missing moved output ${key}`,
    );
    const geometry = matches
      .map((region) => readGeometry(region.geometry))
      .reduce((a, b) => a.union(b));
    const drift = readGeometry(cell.geometry).symDifference(geometry).getArea();
    assert.ok(
      drift < 0.001,
      `${name}: moved geometry drift ${drift} for ${key}`,
    );
    const reliefs = targets.flatMap((ref) =>
      live.relief.value.reliefs.filter((relief) => sameRef(ref, relief.ref)),
    );
    assert.equal(reliefs.length, targets.length);
    for (const relief of reliefs) {
      assert.equal(
        relief.color.toLowerCase(),
        cell.color.toLowerCase(),
        `${name}: moved paint ${key}`,
      );
      assert.deepEqual(
        relief.thickness,
        Number.isInteger(cell.heightLayers)
          ? { kind: 'layers', count: cell.heightLayers }
          : { kind: 'mm', value: cell.heightMM },
      );
    }
  }
  assert.deepEqual(
    movedDocument.programs,
    original.editorState.document.programs,
    'movement must not rewrite output contracts',
  );
  assert.deepEqual(
    movedDocument.nodes,
    original.editorState.document.nodes,
    'source movement must not change owner poses',
  );
  session.undo();
  assert.deepEqual(
    session.getSnapshot().editorState.document,
    imported.document,
  );
  session.dispose();
  console.log(
    `PASS ${name}: source movement preserves evaluated geometry, paint and thickness`,
  );
}
