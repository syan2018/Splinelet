import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  evaluateCreation,
  compileCreation,
  previewCreationBase,
} from '../lib/creation-engine.mjs';
import { creationCommand } from '../lib/creation-commands.mjs';
import { creationDocument, validateCreation } from '../lib/creation-schema.mjs';
import { readGeometry } from '../lib/region-engine.mjs';
import { buildSolid } from '../lib/solid-engine.mjs';
import { translatePaths } from '../public/selection.mjs';
const path = (id, pts, closed = true) => ({
  id,
  name: id,
  closed,
  visible: true,
  color: '#b8ef62',
  quality: 1,
  start: { x: pts[0][0], y: pts[0][1] },
  anchors: pts.map(([x, y]) => ({ x, y })),
  curves: pts
    .slice(0, -1)
    .map((a, i) => [a, a, pts[i + 1], pts[i + 1]].map(([x, y]) => ({ x, y }))),
});
let p = {
  version: 1,
  image: '/reference.png',
  imageName: 'test',
  width: 100,
  height: 100,
  widthMM: 100,
  depthMM: 2,
  paths: [
    path('outer', [
      [10, 10],
      [90, 10],
      [90, 90],
      [10, 90],
      [10, 10],
    ]),
  ],
};
const command = (action, args) => {
  p = creationCommand(p, action, args, evaluateCreation(p));
  return evaluateCreation(p);
};
let scene = evaluateCreation(p);
assert.equal(scene.cells.length, 1);
assert.equal(scene.cells[0].painted, false);
const objectId = scene.creation.objects[0].id;
scene = command('paint', { cellKeys: [scene.cells[0].key], swatchId: 'brown' });
assert.equal(scene.cells[0].painted, true);
assert.equal(p.paths[0].curves.length, 4);
assert.equal(p.creation.objects.length, 1);
const beforeSplit = structuredClone(p);
p.paths.push(
  path(
    'cut',
    [
      [9, 50],
      [91, 50],
    ],
    false,
  ),
);
p.creation.objects[0].pathIds.push('cut');
p.creation.objects[0].roles.cut = 'divider';
scene = evaluateCreation(p);
assert.equal(scene.cells.length, 2);
assert(
  scene.cells.every((c) => c.painted && c.swatchId === 'brown' && !c.conflict),
  'children inherit parent',
);
scene = command('paint', { cellKeys: [scene.cells[0].key], swatchId: 'cream' });
assert.equal(new Set(scene.cells.map((c) => c.swatchId)).size, 2);
{
  const before = structuredClone(p),
    keys = scene.cells.map((c) => c.key);
  const colored = creationCommand(
    p,
    'paint',
    { cellKeys: [keys[0]], color: '#E46E7F' },
    scene,
  );
  const result = evaluateCreation(colored);
  assert.equal(result.cells.find((c) => c.key === keys[0]).color, '#e46e7f');
  assert.equal(
    result.cells.find((c) => c.key === keys[1]).color,
    scene.cells[1].color,
  );
  assert.deepEqual(
    colored.paths,
    before.paths,
    'custom colour never changes source curves',
  );
  assert.deepEqual(
    colored.creation.swatches.slice(0, -1),
    before.creation.swatches,
    'shared palette is not recoloured',
  );
  assert.deepEqual(
    p,
    before,
    'a custom colour command is immutable and undoable as one snapshot',
  );
  const repeated = creationCommand(
    colored,
    'paint',
    { cellKeys: [keys[1]], color: '#e46e7f' },
    result,
  );
  assert.equal(
    repeated.creation.swatches.length,
    colored.creation.swatches.length,
    'reuse matching custom swatch',
  );
  assert.throws(
    () =>
      creationCommand(p, 'paint', { cellKeys: keys, color: 'invalid' }, scene),
    /色值/,
  );
}
scene = command('height', { cellKeys: [scene.cells[0].key], heightMM: 2 });
assert.equal(scene.cells[0].heightMM, 2);
assert.equal(scene.cells[1].heightMM, 1);
let solid = await buildSolid(p);
assert.equal(solid.report.components, 1);
assert.equal(solid.report.valid, true);
assert(Math.abs(solid.report.volumeMM3 - 9600) < 0.01);
const saved = structuredClone(p),
  paintBefore = JSON.stringify(p.creation.objects[0].paints);
const adjusted = structuredClone(p);
translatePaths(adjusted, ['cut'], 0, 6);
const adjustedScene = evaluateCreation(adjusted);
assert.equal(
  adjustedScene.cells.filter((c) => c.conflict).length,
  0,
  'moving divider preserves one-to-one colour association',
);
assert.equal(new Set(adjustedScene.cells.map((c) => c.swatchId)).size, 2);
translatePaths(p, ['outer', 'cut'], 5, -5);
scene = evaluateCreation(p);
assert(
  scene.cells.every((c) => c.painted && !c.conflict),
  'whole-object movement preserves paint',
);
assert.notEqual(JSON.stringify(p.creation.objects[0].paints), paintBefore);
p = saved;
p.creation.objects[0].roles.cut = 'guide';
scene = evaluateCreation(p);
assert.equal(scene.cells.length, 1);
assert.equal(scene.cells[0].conflict, true);
await assert.rejects(() => buildSolid(p), /冲突/);
scene = command('paint', { cellKeys: [scene.cells[0].key], swatchId: 'gold' });
assert.equal(scene.cells[0].conflict, false);
assert.equal(scene.cells[0].swatchId, 'gold');
p = beforeSplit;
p.paths.push(
  path(
    'gap',
    [
      [10.2, 50],
      [89.8, 50],
    ],
    false,
  ),
);
p.creation.objects[0].pathIds.push('gap');
p.creation.objects[0].roles.gap = 'divider';
scene = evaluateCreation(p);
assert.equal(scene.cells.length, 1, 'gaps are not silently bridged');
const preview = evaluateCreation(p, { objectId, joinMM: 0.3 });
assert.equal(preview.cells.length, 2);
assert.equal(preview.connections.length, 2);
assert.equal(evaluateCreation(p).cells.length, 1, 'preview does not mutate');
scene = command('join', { objectId, joinMM: 0.3 });
assert.equal(scene.cells.length, 2);
const gapCurves = JSON.stringify(p.paths.find((x) => x.id === 'gap').curves);
scene = command('connection', {
  objectId,
  pathId: 'gap',
  endpoint: 0,
  disabled: true,
});
assert.equal(
  scene.cells.length,
  1,
  'a disabled automatic endpoint removes its bridge',
);
assert.equal(
  JSON.stringify(p.paths.find((x) => x.id === 'gap').curves),
  gapCurves,
  'disabling a bridge never rewrites source anchors',
);
assert.equal(
  scene.diagnostics.some((d) => d.pathId === 'gap' && d.status === 'disabled'),
  true,
  'the UI can identify the disabled endpoint',
);
scene = command('connection', {
  objectId,
  pathId: 'gap',
  endpoint: 0,
  disabled: false,
});
assert.equal(scene.cells.length, 2, 'a disabled endpoint can be restored');
p = structuredClone(beforeSplit);
p.paths.push(
  path('hole', [
    [30, 30],
    [70, 30],
    [70, 70],
    [30, 70],
    [30, 30],
  ]),
);
p.creation.objects[0].pathIds.push('hole');
p.creation.objects[0].roles.hole = 'hole';
scene = evaluateCreation(p);
assert.equal(scene.cells.length, 1);
assert.equal(scene.cells[0].holes, 1);
assert.equal(scene.cells[0].swatchId, 'brown');
solid = await buildSolid(p);
assert.equal(solid.report.valid, true);
assert(Math.abs(solid.report.volumeMM3 - 4800) < 0.01);
p.widthMM = 50;
scene = evaluateCreation(p);
assert.equal(scene.cells[0].swatchId, 'brown');
assert.equal(
  scene.cells[0].areaMM2,
  1200,
  'normalised footprints follow project scale',
);
validateCreation(p.creation);
assert.equal(compileCreation(p).model.features.length, 1);
const basePreview = previewCreationBase(p, {
  objectIds: [objectId],
  heightMM: 2,
  offsetMM: 1,
});
assert.equal(p.creation.objects.length, 1, 'base preview does not commit');
validateCreation(basePreview.project.creation);
const based = await buildSolid(basePreview.project);
assert.equal(based.report.valid, true);
assert.equal(based.report.components, 1);
assert.equal(based.report.bounds[1][2], 3);
assert.throws(
  () =>
    creationCommand(
      basePreview.project,
      'object',
      { id: basePreview.objectId, changes: { attachId: objectId } },
      basePreview.scene,
    ),
  /循环/,
);
const sourcePath = new URL(
  '../../../outputs/Sandrone-app-relief/Sandrone-relief.bezier.json',
  import.meta.url,
);
if (fs.existsSync(sourcePath)) {
  const original = JSON.parse(fs.readFileSync(sourcePath, 'utf8')),
    migrated = {
      ...original,
      version: 3,
      creation: creationDocument(original),
    };
  validateCreation(migrated.creation);
  const s = evaluateCreation(migrated);
  assert.equal(s.cells.filter((c) => c.featureId).length, 64);
  assert.equal(s.errors.length, 0);
  assert.equal(JSON.stringify(migrated.paths), JSON.stringify(original.paths));
  assert.equal(JSON.stringify(migrated.model), JSON.stringify(original.model));
  const result = await buildSolid(migrated);
  assert.equal(result.report.valid, true);
  assert.equal(result.report.components, 1);
  const hair = s.creation.objects.find((o) => o.name === '头发');
  const edited = creationCommand(
      migrated,
      'continue_partition',
      { objectId: hair.id },
      s,
    ),
    es = evaluateCreation(edited);
  assert.equal(
    es.cells.filter((c) => c.objectId === hair.id && !c.featureId).length,
    11,
  );
  assert.equal(es.cells.filter((c) => c.conflict).length, 0);
  const after = await buildSolid(edited);
  assert.equal(after.report.valid, true);
  assert.equal(after.report.zeroArea, 0);
  assert.equal(after.report.components, 1);
  assert(
    Math.abs(after.report.volumeMM3 - result.report.volumeMM3) < 0.001,
    'shared hair regions preserve manufacturing volume',
  );
  const strand = es.cells.filter(
    (c) => c.objectId === hair.id && !c.featureId,
  )[4];
  const raised = creationCommand(
    edited,
    'height',
    {
      cellKeys: [strand.key],
      heightMM: 1.5,
    },
    es,
  );
  const raisedSolid = await buildSolid(raised);
  assert.equal(
    raisedSolid.report.valid,
    true,
    'edited hair survives STL float32 precision',
  );
  assert.equal(raisedSolid.report.components, 1);
  assert.equal(raisedSolid.report.zeroArea, 0);
  assert.equal(JSON.stringify(raised.paths), JSON.stringify(original.paths));
  console.log(
    'Sandrone migrated:',
    migrated.creation.objects.length,
    'objects;',
    s.cells.length,
    'internal regions;',
    result.report.triangles,
    'triangles',
  );
}
const repairSource = new URL(
  '../../../outputs/interaction-repair/Sandrone-new.source.bezier.json',
  import.meta.url,
);
// Legacy faces keep their elevation after a split is painted and serialized.
// Removing the divider must use the saved styles, including merge conflicts.
{
  let legacy = structuredClone(beforeSplit);
  delete legacy.creation;
  legacy.model = {
    version: 1,
    toleranceMM: 0.015,
    parts: [{ id: 'main', name: 'part' }],
    regions: [
      {
        id: 'legacy-area',
        name: 'area',
        kind: 'path',
        pathId: 'outer',
        color: '#a59883',
      },
    ],
    features: [
      {
        id: 'legacy-feature',
        name: 'feature',
        regionId: 'legacy-area',
        partId: 'main',
        heightMM: 1,
        zMM: 3,
        color: '#a59883',
        mode: 'add',
        enabled: true,
      },
    ],
  };
  legacy.creation = creationDocument(legacy);
  const object = legacy.creation.objects.find((o) =>
    o.featureIds.includes('legacy-feature'),
  );
  legacy.paths.push(
    path(
      'legacy-divider',
      [
        [10, 50],
        [90, 50],
      ],
      false,
    ),
  );
  object.pathIds.push('legacy-divider');
  object.roles['legacy-divider'] = 'divider';
  let divided = evaluateCreation(legacy);
  assert.equal(divided.cells.length, 2);
  assert(divided.cells.every((c) => c.zMM === 3));
  legacy = creationCommand(
    legacy,
    'paint',
    { cellKeys: [divided.cells[0].key], swatchId: 'gold' },
    divided,
  );
  legacy = JSON.parse(JSON.stringify(legacy));
  divided = evaluateCreation(legacy);
  assert(
    divided.cells.every((c) => c.zMM === 3),
    'paint and JSON reload preserve legacy elevation',
  );
  assert.equal(divided.errors.length, 0);
  legacy = creationCommand(
    legacy,
    'roles',
    { objectId: object.id, pathIds: ['legacy-divider'], role: 'guide' },
    divided,
  );
  const merged = evaluateCreation(legacy);
  assert.equal(merged.cells.length, 1);
  assert.equal(
    merged.cells[0].conflict,
    true,
    'removing a painted divider exposes saved style conflicts',
  );
  assert.equal(merged.cells[0].zMM, 3);
}
if (fs.existsSync(repairSource)) {
  const legacy = JSON.parse(fs.readFileSync(repairSource, 'utf8')),
    cup = legacy.creation.objects.find((o) => o.name === '杯子'),
    anchors = JSON.stringify(legacy.paths);
  cup.joinMM = 0.1;
  let cupScene = evaluateCreation(legacy),
    cupCells = cupScene.cells.filter((c) => c.objectId === cup.id);
  assert.equal(cupCells.length, 7, 'legacy cup dividers create seven cells');
  assert(
    cupCells.every((c) => c.painted),
    'legacy styles survive conversion',
  );
  for (const id of Object.keys(cup.roles)) cup.roles[id] = 'guide';
  cupScene = evaluateCreation(legacy);
  cupCells = cupScene.cells.filter((c) => c.objectId === cup.id);
  assert.equal(
    cupCells.length,
    5,
    'moving dividers back to guide restores legacy',
  );
  assert(
    cupCells.every((c) => c.painted),
    'guide rollback retains legacy styles',
  );
  assert.equal(
    JSON.stringify(legacy.paths),
    anchors,
    'role changes do not move anchors',
  );
}
// A newly added hair divider used to create a machine-epsilon segment during
// unary union, which made JSTS reject the graph as non-noded.  Keep this as a
// data regression: it reads a test-only copy and never mutates the artwork.
const hairPartitionSource = new URL(
  './fixtures/hair-partition.json',
  import.meta.url,
);
{
  const hairProject = JSON.parse(fs.readFileSync(hairPartitionSource, 'utf8')),
    originalPaths = JSON.stringify(hairProject.paths),
    hair = hairProject.creation.objects.find((o) => o.name === '头发'),
    hairScene = evaluateCreation(hairProject),
    hairCells = hairScene.cells.filter(
      (cell) => cell.objectId === hair.id && !cell.featureId && !cell.regionId,
    );
  assert.equal(hairScene.errors.length, 0, 'hair graph is fully noded');
  assert.equal(hairCells.length, 12, 'new divider creates its twelfth region');
  assert(
    hairCells.every((cell) => cell.painted),
    'all children inherit paint',
  );
  assert(
    hairCells.every(
      (cell) => Number.isFinite(cell.heightMM) && Number.isFinite(cell.zMM),
    ),
    'all children inherit printable elevation',
  );
  const before = structuredClone(hairProject);
  before.creation.objects.find((o) => o.id === hair.id).roles[
    'c80a7c16-7975-4cd7-b966-9cc6e18a55d4'
  ] = 'guide';
  const oldCells = evaluateCreation(before).cells.filter(
    (cell) => cell.objectId === hair.id && !cell.featureId && !cell.regionId,
  );
  assert.equal(oldCells.length, 11, 'guide state exposes prior eleven regions');
  assert(
    hairCells.every(
      (cell) =>
        oldCells.filter(
          (old) =>
            readGeometry(cell.geometry)
              .intersection(readGeometry(old.geometry))
              .getArea() > 1e-6,
        ).length === 1,
    ),
    'a new divider only subdivides one existing parent region',
  );
  assert.equal(
    JSON.stringify(hairProject.paths),
    originalPaths,
    'noding is derived-only',
  );
  assert(
    hairCells.every((cell) => !cell.conflict),
    'a new split never merges styles',
  );
  for (const cell of hairCells) {
    const parent = oldCells.find(
      (old) =>
        readGeometry(cell.geometry)
          .intersection(readGeometry(old.geometry))
          .getArea() > 1e-6,
    );
    assert.deepEqual(
      [cell.color, cell.heightMM, cell.zMM],
      [parent.color, parent.heightMM, parent.zMM],
    );
  }
  const solid = await buildSolid(hairProject);
  assert.equal(solid.report.valid, true, 'hair remains a printable solid');
  const repainted = creationCommand(
      hairProject,
      'paint',
      { cellKeys: [hairCells[0].key], color: '#cc4488' },
      hairScene,
    ),
    repaintedScene = evaluateCreation(repainted),
    repaintedCells = repaintedScene.cells.filter(
      (cell) => cell.objectId === hair.id && !cell.featureId && !cell.regionId,
    ),
    resized = creationCommand(
      repainted,
      'height',
      { cellKeys: [repaintedCells[1].key], heightMM: 2.34 },
      repaintedScene,
    ),
    reloadedCells = evaluateCreation(
      JSON.parse(JSON.stringify(resized)),
    ).cells.filter(
      (cell) => cell.objectId === hair.id && !cell.featureId && !cell.regionId,
    );
  assert.equal(
    repaintedCells.length,
    12,
    'paint keeps the accepted split graph',
  );
  assert.equal(repaintedCells.filter((cell) => cell.conflict).length, 0);
  assert.equal(
    reloadedCells.length,
    12,
    'height and JSON reload keep the split graph',
  );
  assert.equal(reloadedCells.filter((cell) => cell.conflict).length, 0);
  assert.deepEqual(
    reloadedCells.map((c) => c.geometry),
    hairCells.map((c) => c.geometry),
  );
  assert.deepEqual(resized.paths, hairProject.paths);
  const roleProject = structuredClone(hairProject),
    roleHair = roleProject.creation.objects.find((o) => o.id === hair.id),
    firstDivider = 'c80a7c16-7975-4cd7-b966-9cc6e18a55d4';
  roleHair.roles[firstDivider] = 'guide';
  const firstAccepted = creationCommand(
    roleProject,
    'roles',
    { objectId: roleHair.id, pathIds: [firstDivider], role: 'divider' },
    evaluateCreation(roleProject),
  );
  const firstConnections = evaluateCreation(firstAccepted).connections.filter(
    (c) => c.pathId === firstDivider,
  );
  const secondDivider = 'hair-second-divider',
    copied = structuredClone(
      firstAccepted.paths.find((path) => path.id === firstDivider),
    );
  copied.id = secondDivider;
  const offset = (p) => ({ ...p, x: p.x + 0.01 });
  copied.start = offset(copied.start);
  copied.anchors = copied.anchors.map(offset);
  copied.curves = copied.curves.map((curve) => curve.map(offset));
  firstAccepted.paths.push(copied);
  const acceptedHair = firstAccepted.creation.objects.find(
    (o) => o.id === roleHair.id,
  );
  acceptedHair.pathIds.push(secondDivider);
  acceptedHair.roles[secondDivider] = 'guide';
  const secondAccepted = creationCommand(
      firstAccepted,
      'roles',
      { objectId: acceptedHair.id, pathIds: [secondDivider], role: 'divider' },
      evaluateCreation(firstAccepted),
    ),
    secondScene = evaluateCreation(secondAccepted),
    secondCells = secondScene.cells.filter(
      (cell) => cell.objectId === hair.id && !cell.featureId && !cell.regionId,
    );
  assert.equal(secondScene.errors.length, 0);
  assert.equal(secondCells.filter((cell) => cell.conflict).length, 0);
  assert.deepEqual(
    secondScene.connections.filter((c) => c.pathId === firstDivider),
    firstConnections,
    'a closer new divider cannot steal either endpoint of the previously accepted divider',
  );
  assert.equal(
    secondAccepted.creation.objects.find((o) => o.id === hair.id)
      .dividerGraphCohorts.length,
    3,
    'a later divider becomes a later immutable graph cohort without repainting',
  );
  const broken = structuredClone(hairProject),
    brokenHair = broken.creation.objects.find((o) => o.id === hair.id),
    oldDivider = broken.paths.find(
      (path) => path.id === '0dc5136e-24eb-48ea-8d4a-d792d70fd171',
    );
  oldDivider.curves[1][0].x += 100;
  const failed = evaluateCreation(broken),
    fallback = failed.cells.filter((cell) => cell.objectId === brokenHair.id);
  assert(failed.errors.some((error) => error.objectId === brokenHair.id));
  assert.equal(
    fallback.filter((cell) => cell.fallback).length,
    brokenHair.paints.length,
  );
  assert(
    fallback.some((cell) => cell.featureId) &&
      fallback.filter((cell) => cell.fallback).every((cell) => cell.painted),
    'failure retains legacy features alongside saved paint footprints',
  );
  assert.throws(() => compileCreation(broken), /请先处理/);
  const unpaintedBroken = structuredClone(broken);
  unpaintedBroken.creation.objects.find((o) => o.id === brokenHair.id).paints =
    [];
  assert.throws(
    () => compileCreation(unpaintedBroken),
    /请先处理/,
    'a failed printable legacy object cannot export a partial solid',
  );
}
console.log(
  'PASS: scoped fill, split inheritance, local colour / height, merge conflicts, cancelable gap preview, holes, movement, scaling, and printable solid',
);
