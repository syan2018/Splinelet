import assert from 'node:assert/strict';
import fs from 'node:fs';
import { creationCommand } from '../lib/creation-commands.mjs';
import {
  evaluateCreation,
  compileCreation,
  previewCreationBase,
} from '../lib/creation-engine.mjs';
import { creationDocument, validateCreation } from '../lib/creation-schema.mjs';
import { readGeometry, regionContext } from '../lib/region-engine.mjs';
import { buildSolid } from '../lib/solid-engine.mjs';
import {
  liveSurfaces,
  rectangle,
  surfaceObject,
} from './fixtures/live-surfaces.mjs';
const checks = [];
const same = (a, b) => assert(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const command = (p, action, args) =>
  creationCommand(p, action, args, evaluateCreation(p));
const add = (p, args) =>
  command(p, 'modifier_add', { objectId: 'owner', ...args });
const obj = (p) => creationDocument(p).objects.find((o) => o.id === 'owner');
const cells = (p) => {
  const s = evaluateCreation(p);
  assert.deepEqual(s.errors, []);
  return s.cells.filter((c) => c.objectId === 'owner');
};
const compiledArea = (p, id) => {
  const q = compileCreation(p);
  return regionContext(q)
    .get(q.model.features.find((f) => f.id === id).regionId)
    .getArea();
};

let p = liveSurfaces();
p.model.features.push({
  ...p.model.features[0],
  id: 'gold',
  heightMM: 3,
  color: '#d2b777',
});
p.creation.objects[0].featureIds.push('gold');
p.creation.objects[0].featureSwatches.gold = 'gold';
const original = structuredClone(p),
  hole = obj(p).modifiers[0];
p = command(p, 'modifier_update', {
  objectId: 'owner',
  modifierId: hole.id,
  targets: {
    kind: 'selected',
    refs: [{ key: 'feature:gold', name: '金色面' }],
  },
});
same(cells(p).find((c) => c.featureId === 'body').areaMM2, 6400);
same(cells(p).find((c) => c.featureId === 'gold').areaMM2, 4800);
same(compiledArea(p, 'body'), 6400);
same(compiledArea(p, 'gold'), 4800);
assert.deepEqual(p.paths, original.paths);
assert.deepEqual(p.model, original.model);
checks.push(
  'a scoped hole changes only its selected extrusion and retains the underlying face',
);
let q = command(p, 'modifier_update', {
  objectId: 'owner',
  modifierId: hole.id,
  changes: { enabled: false },
});
assert(cells(q).every((c) => c.areaMM2 === 6400));
q = command(p, 'modifier_remove', { objectId: 'owner', modifierId: hole.id });
assert(cells(q).every((c) => c.areaMM2 === 6400));
assert.equal(obj(q).modifiers.length, 0);
assert.deepEqual(
  evaluateCreation(JSON.parse(JSON.stringify(p))).cells,
  evaluateCreation(p).cells,
);
checks.push(
  'disable, remove and reload use the actual modifier program without hidden hole fallbacks',
);

let order = command(liveSurfaces(), 'roles', {
  objectId: 'owner',
  pathIds: ['hole'],
  role: 'guide',
});
order = add(order, {
  type: 'boolean',
  operation: 'difference',
  input: { kind: 'path', id: 'hole' },
});
order = add(order, { type: 'offset', distanceMM: 2 });
const expandedAfterCut = cells(order)[0].areaMM2;
order = command(order, 'modifier_move', {
  objectId: 'owner',
  modifierId: obj(order).modifiers[1].id,
  direction: -1,
});
assert(Math.abs(cells(order)[0].areaMM2 - expandedAfterCut) > 10);
checks.push(
  'modifier order changes geometry: offset-before-cut differs from cut-before-offset',
);

let split = command(liveSurfaces(), 'roles', {
  objectId: 'owner',
  pathIds: ['hole'],
  role: 'guide',
});
const cut = rectangle('cut', 50, 10, 50, 90);
cut.closed = false;
cut.curves = [cut.curves[1]];
cut.start = { x: 50, y: 10 };
cut.anchors = [
  { x: 50, y: 10 },
  { x: 50, y: 90 },
];
split.paths.push(cut);
split.creation.objects[0].pathIds.push('cut');
split.creation.objects[0].roles.cut = 'guide';
split = add(split, { type: 'split', input: { kind: 'path', id: 'cut' } });
let pieces = cells(split);
assert.equal(pieces.length, 2);
same(pieces[0].areaMM2, 3200);
same(pieces[1].areaMM2, 3200);
split = command(split, 'paint', {
  cellKeys: [pieces[0].key],
  swatchId: 'gold',
});
split = command(split, 'height', { cellKeys: [pieces[0].key], heightMM: 3 });
pieces = cells(split);
assert.equal(pieces[0].color, '#d2b777');
assert.equal(pieces[1].color, '#f3ead7');
assert.equal(pieces[1].heightMM, 2);
const splitSolid = await buildSolid(split);
assert(splitSolid.report.valid);
same(Math.round(splitSolid.report.volumeMM3), 16000);
const moved = structuredClone(split);
for (const path of moved.paths)
  path.curves = path.curves.map((curve) =>
    curve.map((p) => ({ x: p.x + 7, y: p.y - 3 })),
  );
assert.deepEqual(
  cells(moved).map((c) => [c.key, c.color, c.heightMM]),
  pieces.map((c) => [c.key, c.color, c.heightMM]),
);
split = add(split, {
  type: 'boolean',
  input: { kind: 'path', id: 'hole' },
  cellKeys: [pieces[0].key],
});
same(cells(split).find((c) => c.key === pieces[0].key).areaMM2, 2400);
same(cells(split).find((c) => c.key === pieces[1].key).areaMM2, 3200);
checks.push(
  'split outputs have directional identities, isolated colours/heights and composable downstream scopes',
);
let merged = command(split, 'height', { objectIds: ['owner'], heightMM: 2 });
merged = command(merged, 'paint', { objectIds: ['owner'], swatchId: 'cream' });
merged = add(merged, {
  type: 'boolean',
  operation: 'union',
  input: { kind: 'path', id: 'hole' },
});
assert.equal(cells(merged).length, 1);
merged = command(merged, 'paint', {
  cellKeys: [cells(merged)[0].key],
  swatchId: 'gold',
});
same(cells(merged)[0].areaMM2, 6400);
assert.equal(cells(merged)[0].color, '#d2b777');
merged = command(merged, 'delete_swatch', {
  id: 'gold',
  replacementId: 'cream',
});
assert.equal(cells(merged)[0].color, '#f3ead7');
assert((await buildSolid(merged)).report.valid);
checks.push(
  'a merged result owns its local style; repainting and deleting its colour preserve the union',
);

let nested = command(liveSurfaces(), 'roles', {
  objectId: 'owner',
  pathIds: ['hole'],
  role: 'guide',
});
nested.paths.push(
  rectangle('tool', 30, 30, 70, 70),
  rectangle('notch', 50, 20, 80, 80),
);
const tool = surfaceObject('tool-object', ['tool']),
  notch = surfaceObject('notch-object', ['notch']);
tool.fillAll = true;
notch.fillAll = true;
nested.creation.objects.push(tool, notch);
nested = command(nested, 'modifier_add', {
  objectId: 'tool-object',
  type: 'boolean',
  operation: 'difference',
  input: { kind: 'object', id: 'notch-object' },
});
nested = add(nested, {
  type: 'boolean',
  operation: 'difference',
  input: { kind: 'object', id: 'tool-object' },
});
same(cells(nested)[0].areaMM2, 5600);
const edited = structuredClone(nested);
edited.paths[3] = rectangle('notch', 60, 20, 80, 80);
same(cells(edited)[0].areaMM2, 5200);
const cycle = command(nested, 'modifier_add', {
  objectId: 'notch-object',
  type: 'boolean',
  operation: 'difference',
  input: { kind: 'object', id: 'owner' },
});
const failed = evaluateCreation(cycle);
assert(failed.errors.some((e) => /循环/.test(e.message)));
assert(!failed.cells.some((c) => c.objectId === 'owner'));
assert.throws(() => compileCreation(cycle), /循环/);
checks.push(
  'object operands use their final modified result and cycles fail without stale output',
);

let composite = command(nested, 'new_object', { name: '组合' });
const compositeId = composite.creation.objects.at(-1).id;
composite = command(composite, 'modifier_add', {
  objectId: compositeId,
  type: 'boolean',
  operation: 'union',
  input: { kind: 'object', id: 'tool-object' },
});
const compositeScene = evaluateCreation(composite);
assert.deepEqual(compositeScene.errors, []);
same(compositeScene.cells.find((c) => c.objectId === compositeId).areaMM2, 800);
checks.push(
  'an empty object can start from another object result and build an extensible composite',
);
let stacked = structuredClone(split);
const upper = surfaceObject('upper', []);
upper.attachId = 'owner';
upper.modifiers = [
  {
    id: 'upper-input',
    name: '上层',
    type: 'boolean',
    operation: 'union',
    enabled: true,
    targets: { kind: 'all' },
    input: { kind: 'path', id: 'hole' },
  },
];
stacked.creation.objects.push(upper);
let stackedScene = evaluateCreation(stacked);
same(stackedScene.cells.find((c) => c.objectId === 'upper').zMM, 3);
stacked = command(stacked, 'height', {
  cellKeys: [pieces[0].key],
  heightMM: 5,
});
same(
  evaluateCreation(stacked).cells.find((c) => c.objectId === 'upper').zMM,
  5,
);
const based = previewCreationBase(nested, {
  objectIds: ['owner'],
  offsetMM: 1,
  heightMM: 2,
});
const baseArea = evaluateCreation(based.project).cells.find(
  (c) => c.objectId === based.objectId,
).areaMM2;
based.project.paths[0] = rectangle('outer', 10, 10, 95, 90);
assert(
  evaluateCreation(based.project).cells.find(
    (c) => c.objectId === based.objectId,
  ).areaMM2 > baseArea,
);
checks.push(
  'stacked objects follow final local thicknesses and referenced baseplates follow source edits',
);

const stale = command(p, 'modifier_update', {
  objectId: 'owner',
  modifierId: hole.id,
  targets: {
    kind: 'selected',
    refs: [{ key: 'feature:deleted', name: '已删除面' }],
  },
});
assert(evaluateCreation(stale).errors.some((e) => /作用面/.test(e.message)));
assert.throws(() => compileCreation(stale), /作用面/);
assert.throws(
  () =>
    command(p, 'modifier_update', {
      objectId: 'owner',
      modifierId: hole.id,
      changes: { targets: { kind: 'selected', refs: [] } },
    }),
  /范围/,
);
validateCreation(creationDocument(split));
checks.push(
  'missing targets and invalid parameters cannot silently retarget another surface',
);

const file =
  process.argv[2] ||
  '../../outputs/modifier-stack/Sandrone-new.source.bezier.json';
if (fs.existsSync(file)) {
  const art = JSON.parse(fs.readFileSync(file)),
    before = evaluateCreation(art),
    crown = before.creation.objects.find((o) => o.name === '头饰');
  const h = crown.modifiers.find(
    (m) => m.rolePathId === 'be92b11d-9617-4008-b6c1-be9f1d842c45',
  );
  assert(h);
  assert.deepEqual(before.errors, []);
  const scoped = command(art, 'modifier_update', {
    objectId: crown.id,
    modifierId: h.id,
    targets: {
      kind: 'selected',
      refs: [{ key: 'feature:body-band-64', name: '头饰嵌线 65' }],
    },
  });
  const after = evaluateCreation(scoped);
  assert.deepEqual(after.errors, []);
  assert.equal(after.cells.find((c) => c.featureId === 'body-8').holes, 0);
  assert.equal(
    after.cells.find((c) => c.featureId === 'body-band-64').holes,
    1,
  );
  for (const cell of before.cells.filter((c) => c.featureId !== 'body-8')) {
    const current = after.cells.find((c) => c.key === cell.key);
    same(
      readGeometry(cell.geometry)
        .symDifference(readGeometry(current.geometry))
        .getArea(),
      0,
    );
    assert.equal(current.color, cell.color);
    assert.equal(current.heightMM, cell.heightMM);
  }
  const off = command(scoped, 'modifier_update', {
    objectId: crown.id,
    modifierId: h.id,
    changes: { enabled: false },
  });
  assert.equal(
    evaluateCreation(off).cells.find((c) => c.featureId === 'body-band-64')
      .holes,
    0,
  );
  assert.deepEqual(scoped.paths, art.paths);
  assert.deepEqual(scoped.model, art.model);
  const solid = await buildSolid(scoped);
  assert(
    solid.report.valid &&
      solid.report.components === 1 &&
      solid.report.zeroArea === 0,
  );
  console.log(JSON.stringify({ crownSolid: solid.report }));
  checks.push(
    'real crown migrates duplicate cuts, exposes a white shallow diamond and stays printable',
  );
}
console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
