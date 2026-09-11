import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  evaluateCreation,
  compileCreation,
  previewCreationBase,
} from '../lib/creation-engine.mjs';
import { creationCommand } from '../lib/creation-commands.mjs';
import { creationDocument, validateCreation } from '../lib/creation-schema.mjs';
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
console.log(
  'PASS: scoped fill, split inheritance, local colour / height, merge conflicts, cancelable gap preview, holes, movement, scaling, and printable solid',
);
