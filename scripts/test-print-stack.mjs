import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  rectangle,
  surfaceObject,
  liveSurfaces,
} from './fixtures/live-surfaces.mjs';
import { creationCommand } from '../lib/creation-commands.mjs';
import {
  evaluateCreation,
  compileCreation,
  previewCreationBase,
} from '../lib/creation-engine.mjs';
import { buildSolid } from '../lib/solid-engine.mjs';
import { resolvePrintStack } from '../lib/print-stack.mjs';
const command = (p, action, args = {}) =>
  creationCommand(p, action, args, evaluateCreation(p));
const scene = (p) => {
  const s = evaluateCreation(p);
  assert.deepEqual(s.errors, []);
  return s;
};
const same = (a, b) => assert(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

let p = liveSurfaces();
p.paths = [
  rectangle('outer', 0, 0, 100, 100),
  rectangle('middle-path', 10, 10, 90, 90),
  rectangle('top-path', 20, 20, 80, 80),
];
p.creation.objects[0].pathIds = ['outer'];
p.creation.objects[0].roles = {};
for (const id of ['middle', 'top']) {
  const object = surfaceObject(id, [id + '-path']);
  object.fillAll = true;
  p.creation.objects.push(object);
}
const original = structuredClone(p);
assert.throws(() => command(p, 'print_enable'), /确认/);
p = command(p, 'print_enable', { confirm: true, layerHeightMM: 0.2 });
const baseId = p.creation.printStack.layers[0].id;
p = command(p, 'print_layer_add', { name: '中层' });
const middleId = p.creation.printStack.layers[1].id;
p = command(p, 'print_layer_add', { name: '顶层' });
const topId = p.creation.printStack.layers[2].id;
p = command(p, 'print_assign', { objectIds: ['middle'], layerId: middleId });
p = command(p, 'print_assign', { objectIds: ['top'], layerId: topId });
for (const [id, count] of [
  ['owner', 3],
  ['middle', 2],
  ['top', 4],
])
  p = command(p, 'height', { objectIds: [id], heightLayers: count });
let s = scene(p);
assert.deepEqual(
  s.printLevels.map((l) => [l.bottomLayers, l.topLayers]),
  [
    [0, 3],
    [3, 5],
    [5, 9],
  ],
);
same(s.cells.find((c) => c.objectId === 'top').zMM, 1);
assert.deepEqual(p.paths, original.paths);
const compiled = compileCreation(p);
same(compiled.model.features.find((f) => f.id === 'body').heightMM, 0.6);
const solid = await buildSolid(p);
assert.equal(solid.report.valid, true);
assert.equal(solid.report.components, 1);
// STL vertices are float32; allow their quantization error in the volume sum.
assert(
  Math.abs(solid.report.volumeMM3 - (10000 * 0.6 + 6400 * 0.4 + 3600 * 0.8)) <
    0.002,
);
p = command(p, 'height', { cellKeys: ['feature:body'], heightLayers: 5 });
s = scene(p);
assert.deepEqual(
  s.printLevels.map((l) => [l.bottomLayers, l.topLayers]),
  [
    [0, 5],
    [5, 7],
    [7, 11],
  ],
);
p = command(p, 'print_settings', { layerHeightMM: 0.12 });
const scaled = scene(p);
assert.deepEqual(
  scaled.printLevels.map((l) => [l.bottomLayers, l.topLayers]),
  [
    [0, 5],
    [5, 7],
    [7, 11],
  ],
);
same(scaled.cells.find((c) => c.objectId === 'top').zMM, 0.84);
assert.deepEqual(scene(JSON.parse(JSON.stringify(p))).cells, scaled.cells);
assert.throws(
  () => command(p, 'height', { objectIds: ['owner'], heightLayers: 1.5 }),
  /整数/,
);
assert.throws(
  () => command(p, 'object', { id: 'owner', changes: { zMM: 3 } }),
  /接管/,
);
assert.throws(
  () => command(p, 'print_layer_remove', { layerId: middleId }),
  /先将/,
);
console.log(
  'PASS: three generic layers, integer thickness, downstream lift, profile scaling, reload, compiled STL volume',
);

let q = command(p, 'object', { id: 'middle', changes: { visible: false } });
assert.deepEqual(scene(q).printLevels, scene(p).printLevels);
q = command(p, 'object', { id: 'middle', changes: { printable: false } });
same(scene(q).printLevels[2].bottomLayers, 5);
q = command(p, 'print_layer_move', { layerId: topId, direction: -1 });
assert.deepEqual(
  scene(q).printLevels.map((l) => l.id),
  [baseId, topId, middleId],
);
q = command(p, 'print_layer_add');
const empty = q.creation.printStack.layers.at(-1).id;
assert.equal(scene(q).printLevels.at(-1).heightLayers, 0);
q = command(q, 'print_layer_remove', { layerId: empty });
assert.deepEqual(scene(q).cells, scene(p).cells);
const basePreview = previewCreationBase(p, {
  objectIds: ['top'],
  heightLayers: 2,
  offsetMM: 1,
});
assert.equal(basePreview.scene.printLevels.length, 4);
same(basePreview.scene.printLevels[1].bottomLayers, 2);
const failed = resolvePrintStack(scaled.creation, scaled.cells, [
  { objectId: 'middle', message: 'broken source' },
]);
assert.equal(failed.printLevels[0].state, 'ready');
assert(
  failed.printLevels
    .slice(1)
    .every((l) => l.state === 'blocked' && l.bottomMM === null),
);
assert.deepEqual(
  failed.cells.map((c) => c.objectId),
  ['owner'],
);
console.log(
  'PASS: hidden vs excluded, layer reorder, empty deletion, baseplate integration, upstream failure pauses higher placement',
);

const file = process.argv[2] || 'scripts/fixtures/surface-lineage.json';
let art = JSON.parse(fs.readFileSync(file, 'utf8'));
const before = scene(art);
art = command(art, 'print_enable', { confirm: true, layerHeightMM: 0.2 });
const after = scene(art);
assert.equal(after.cells.length, before.cells.length);
for (const cell of after.cells) {
  const old = before.cells.find((c) => c.key === cell.key);
  assert.deepEqual(cell.geometry, old.geometry);
  assert.equal(cell.color, old.color);
}
// Use IDs discovered from the generic object list, with no preset in product code.
art = command(art, 'print_layer_add', { name: '试验中层' });
art = command(art, 'print_layer_add', { name: '试验顶层' });
const objects = art.creation.objects;
art = command(art, 'print_assign', {
  objectIds: [objects[1].id],
  layerId: art.creation.printStack.layers[1].id,
});
art = command(art, 'print_assign', {
  objectIds: objects.slice(2).map((o) => o.id),
  layerId: art.creation.printStack.layers[2].id,
});
const ordered = scene(art);
assert(ordered.printLevels.every((l) => l.state === 'ready'));
const oldTop = ordered.printLevels[2].bottomLayers;
const oldBase = ordered.printLevels[0].heightLayers;
art = command(art, 'height', {
  objectIds: [objects[0].id],
  heightLayers: oldBase + 2,
});
const moved = scene(art);
assert.equal(moved.printLevels[2].bottomLayers, oldTop + 2);
for (const cell of moved.cells.filter((c) => c.objectId !== objects[0].id)) {
  const old = ordered.cells.find((v) => v.key === cell.key);
  assert.equal(cell.heightLayers, old.heightLayers);
  assert.equal(cell.color, old.color);
  assert.deepEqual(cell.geometry, old.geometry);
}
fs.mkdirSync('../../outputs/print-stack', { recursive: true });
fs.writeFileSync(
  '../../outputs/print-stack/print-stack-trial.bezier.json',
  JSON.stringify(art),
);
console.log(
  `PASS: current artwork migration (${before.cells.length} faces), unchanged contours/colors, layered placement with lower edits`,
);
