import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluateCreation, compileCreation } from '../lib/creation-engine.mjs';
import { creationCommand } from '../lib/creation-commands.mjs';
import { bindSurfaceGraphs } from '../lib/surface-lineage.mjs';
import { validateCreation } from '../lib/creation-schema.mjs';
import { translatePaths } from '../public/selection.mjs';
import {
  liveSurfaces,
  rectangle,
  surfaceObject,
} from './fixtures/live-surfaces.mjs';
const evaluate = (p) => {
  const s = evaluateCreation(p);
  assert.deepEqual(s.errors, []);
  return s;
};
const bind = (p) => bindSurfaceGraphs(p, evaluate(p));
const command = (p, action, args) =>
  creationCommand(p, action, args, evaluateCreation(p));
const line = (id, x) => ({
  id,
  name: id,
  closed: false,
  visible: true,
  color: '#b8ef62',
  quality: 1,
  start: { x, y: 5 },
  anchors: [
    { x, y: 5 },
    { x, y: 95 },
  ],
  curves: [
    [
      { x, y: 5 },
      { x, y: 5 },
      { x, y: 95 },
      { x, y: 95 },
    ],
  ],
});
const checks = [];

let p = command(liveSurfaces(), 'roles', {
  objectId: 'owner',
  pathIds: ['hole'],
  role: 'guide',
});
p.paths.push(line('cut', 50));
p.creation.objects[0].pathIds.push('cut');
p = command(p, 'roles', {
  objectId: 'owner',
  pathIds: ['cut'],
  role: 'divider',
});
let s = evaluate(p);
assert.equal(s.cells.length, 2);
assert.equal(p.creation.objects[0].modifiers[0].type, 'split');
assert.deepEqual(p.creation.objects[0].featureIds, ['body']);
assert.equal(p.creation.objects[0].paints.length, 0);
const key = s.cells[0].key;
p = command(p, 'paint', { cellKeys: [key], swatchId: 'gold' });
p = command(p, 'height', { cellKeys: [key], heightMM: 3 });
p = bind(p);
const before = structuredClone(p),
  beforeCells = evaluate(p).cells;
translatePaths(p, ['cut'], 4, 0);
s = evaluate(p);
assert.deepEqual(
  s.cells.map((c) => [c.key, c.color, c.heightMM]),
  beforeCells.map((c) => [c.key, c.color, c.heightMM]),
);
assert.deepEqual(p.creation, before.creation);
checks.push(
  'role shortcut uses the modifier stack; moving a cut changes geometry without rewriting appearance',
);

p.paths.push(rectangle('other', 110, 10, 120, 20));
p.creation.objects.push({
  ...surfaceObject('other', ['other']),
  fillAll: true,
});
p = bind(p);
const other = evaluate(p).cells.find((c) => c.objectId === 'other');
translatePaths(p, ['cut'], 200, 0);
s = evaluateCreation(p);
assert(s.errors.some((e) => e.objectId === 'owner' && e.modifierId));
assert(!s.cells.some((c) => c.objectId === 'owner'));
assert.deepEqual(
  s.cells.find((c) => c.objectId === 'other'),
  other,
);
assert.throws(
  () => command(p, 'paint', { objectIds: ['owner'], swatchId: 'red' }),
  /修复/,
);
assert.throws(() => compileCreation(p), /处理/);
translatePaths(p, ['cut'], -200, 0);
s = evaluate(p);
assert.equal(s.cells.find((c) => c.key === key).heightMM, 3);
checks.push(
  'broken split freezes dependent surfaces and export, leaves unrelated objects intact, and resumes after source repair',
);

const splitId = p.creation.objects.find((o) => o.id === 'owner').modifiers[0]
  .id;
p = command(p, 'modifier_add', {
  objectId: 'owner',
  type: 'offset',
  distanceMM: 0.1,
  cellKeys: [key],
});
translatePaths(p, ['cut'], 200, 0);
s = evaluateCreation(p);
assert.equal(
  s.modifierStatus.find(
    (m) => m.modifierId !== splitId && m.objectId === 'owner',
  ).state,
  'waiting',
);
const frozen = structuredClone(p);
assert.throws(
  () =>
    command(p, 'modifier_truncate', { objectId: 'owner', modifierId: splitId }),
  /确认/,
);
p = command(p, 'modifier_truncate', {
  objectId: 'owner',
  modifierId: splitId,
  confirm: true,
});
assert.equal(evaluate(p).cells.filter((c) => c.objectId === 'owner').length, 1);
assert.deepEqual(frozen.creation.objects[0].modifiers.length, 2);
checks.push(
  'downstream waiting and explicit truncation are inspectable, confirmed and undoable',
);

let native = liveSurfaces();
native.model.regions = [];
native.model.features = [];
native.paths = [rectangle('outer', 10, 10, 90, 90), line('cut', 50)];
native.creation.objects = [
  {
    ...surfaceObject('native', ['outer', 'cut']),
    roles: { cut: 'divider' },
    fillAll: true,
  },
];
native = bind(native);
let n = evaluate(native);
const first = n.cells[0].key;
native = command(native, 'paint', { cellKeys: [first], swatchId: 'red' });
const graph = structuredClone(native.creation.objects[0].surfaceGraph);
translatePaths(native, ['cut'], 200, 0);
n = evaluateCreation(native);
assert.equal(n.errors[0].stage, 'partition');
assert(n.surfaceGraphCandidates.native);
assert.deepEqual(native.creation.objects[0].surfaceGraph, graph);
const rebuilt = command(native, 'rebuild_surfaces', {
  objectId: 'native',
  confirm: true,
});
assert.equal(evaluate(rebuilt).cells.length, 1);
assert(
  !evaluate(rebuilt).cells.some((c) =>
    graph.outputs.some((o) => o.key === c.key),
  ),
);
checks.push(
  'legacy arrangement freezes lost contour identities; rebuilding creates new references instead of reusing broken keys',
);

const file =
  process.argv[2] ||
  new URL('./fixtures/surface-lineage.json', import.meta.url);
const source = JSON.parse(fs.readFileSync(file));
const imported = evaluate(source);
const art = bind(source),
  live = evaluate(art),
  cup = art.creation.objects.find((o) => o.name === '杯子');
assert.equal(live.cells.length, 69);
assert.equal(live.cells.filter((c) => c.conflict).length, 0);
assert(art.creation.objects.every((o) => o.paints.length === 0));
assert.deepEqual(art.paths, source.paths);
assert.deepEqual(
  live.cells.map((c) => [c.key, c.color, c.heightMM, c.geometry]),
  imported.cells.map((c) => [c.key, c.color, c.heightMM, c.geometry]),
);
let edited = command(art, 'paint', {
  cellKeys: [live.cells.find((c) => c.objectId === cup.id).key],
  swatchId: 'red',
});
const selected = live.cells.find((c) => c.objectId === cup.id).key;
edited = command(edited, 'height', { cellKeys: [selected], heightMM: 2.3 });
const editedScene = evaluate(edited);
assert.deepEqual(
  editedScene.cells.filter((c) => c.key !== selected),
  live.cells.filter((c) => c.key !== selected),
);
assert.deepEqual(
  edited.creation.objects.filter((o) => o.id !== cup.id),
  art.creation.objects.filter((o) => o.id !== cup.id),
);
assert.deepEqual(
  edited.creation.objects
    .find((o) => o.id === cup.id)
    .surfaceGraph.outputs.filter((o) => o.key !== selected),
  cup.surfaceGraph.outputs.filter((o) => o.key !== selected),
);
assert.deepEqual(
  evaluate(JSON.parse(JSON.stringify(edited))).cells,
  editedScene.cells,
);
const moved = structuredClone(art);
translatePaths(moved, ['3d20bdfa-e58d-4eea-b4da-f5fc4bbf95c1'], 1, 0);
const movedScene = evaluate(moved);
assert.deepEqual(
  movedScene.cells.map((c) => [c.key, c.color, c.heightMM]),
  live.cells.map((c) => [c.key, c.color, c.heightMM]),
);
assert.deepEqual(moved.creation, art.creation);
validateCreation(art.creation);
fs.mkdirSync('../../outputs/style-robustness', { recursive: true });
fs.writeFileSync(
  '../../outputs/style-robustness/Sandrone-bound.bezier.json',
  JSON.stringify(art),
);
fs.writeFileSync(
  '../../outputs/style-robustness/blocked-chain.bezier.json',
  JSON.stringify(frozen),
);
checks.push(
  'real 69-face project: migration, cup movement, local colour/height, sibling preservation and reload',
);
const hair = JSON.parse(
  fs.readFileSync(new URL('./fixtures/hair-partition.json', import.meta.url)),
);
const hs = evaluate(hair),
  hairId = hs.creation.objects.find((o) => o.name === '头发').id;
assert.equal(
  hs.cells.filter((c) => c.objectId === hairId && !c.featureId && !c.regionId).length,
  12,
);
assert(
  hs.cells
    .filter((c) => c.objectId === hairId)
    .every((c) => Number.isFinite(c.heightMM) && Number.isFinite(c.zMM)),
);
const damaged = bind(hair);
damaged.paths.find(
  (p) => p.id === '0dc5136e-24eb-48ea-8d4a-d792d70fd171',
).curves[1][0].x += 100;
assert(evaluateCreation(damaged).errors.some((e) => e.objectId === hairId));
assert.throws(() => compileCreation(damaged), /请先处理/);
checks.push(
  'original non-noded hair fixture still computes 12 faces; a damaged source blocks export',
);
console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
