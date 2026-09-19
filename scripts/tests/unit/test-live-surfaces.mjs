import assert from 'node:assert/strict';
import {
  evaluateCreation,
  compileCreation,
} from '../../../src/lib/creation-engine.mjs';
import { creationCommand } from '../../../src/lib/creation-commands.mjs';
import { validateCreation } from '../../../src/lib/creation-schema.mjs';
import { regionContext } from '../../../src/lib/region-engine.mjs';
import { buildSolid, resolveHeights } from '../../../src/lib/solid-engine.mjs';
import {
  liveSurfaces,
  rectangle,
  surfaceObject,
} from '../fixtures/live-surfaces.mjs';
const checks = [];
const check = (name, fn) => {
  fn();
  checks.push(name);
};
const scene = (p) => evaluateCreation(p);
const cell = (p) => scene(p).cells.find((c) => c.featureId === 'body');
const compiledCell = (p, id = 'body') => {
  const c = compileCreation(p);
  return regionContext(c).get(
    c.model.features.find((f) => f.id === id).regionId,
  );
};
const p = liveSurfaces();
const original = structuredClone(p);
check('imported face and compiled extrusion both use the live hole', () => {
  assert.equal(cell(p).areaMM2, 4800);
  assert.equal(cell(p).holes, 1);
  assert.equal(compiledCell(p).getArea(), 4800);
  assert.deepEqual(p, original);
  assert.equal(cell(p).key, 'feature:body');
  assert.equal(cell(p).name, '有名字的区域');
});
const solid = await buildSolid(p);
check('print mesh volume agrees with the cut preview', () => {
  assert(solid.report.valid);
  assert(Math.abs(solid.report.volumeMM3 - 9600) < 0.01);
});
for (const variant of ['guide', 'delete', 'outside', 'resize']) {
  const q = structuredClone(p);
  if (variant === 'guide') q.creation.objects[0].roles.hole = 'guide';
  if (variant === 'delete') q.paths = q.paths.filter((p) => p.id !== 'hole');
  if (variant === 'outside') q.paths[1] = rectangle('hole', 110, 110, 130, 130);
  if (variant === 'resize') q.paths[1] = rectangle('hole', 40, 40, 60, 60);
  check(`hole ${variant} recomputes immediately and on reload`, () => {
    const area = variant === 'resize' ? 6000 : 6400;
    assert.equal(cell(q).areaMM2, area);
    assert.equal(compiledCell(q).getArea(), area);
    assert.deepEqual(scene(JSON.parse(JSON.stringify(q))), scene(q));
    assert.equal(cell(q).heightMM, 2);
    assert.equal(cell(q).swatchId, 'cream');
  });
}
{
  const q = structuredClone(p),
    o = q.creation.objects[0];
  q.model.features.push({
    ...q.model.features[0],
    id: 'upper',
    zMM: 4,
    heightMM: 1,
    color: '#9c3043',
  });
  o.featureIds.push('upper');
  o.featureSwatches.upper = 'red';
  q.model.regions.push({ ...q.model.regions[0], id: 'flat', name: '平面区域' });
  o.regionIds.push('flat');
  q.model.features.push({
    ...q.model.features[0],
    id: 'other-body',
    zMM: 8,
    heightMM: 1.5,
  });
  const other = surfaceObject('other', [], ['other-body']);
  other.featureSwatches['other-body'] = 'cream';
  q.creation.objects.push(other);
  check(
    'holes cover all owned imported surfaces without coupling styles or shared recipes',
    () => {
      const s = scene(q),
        own = s.cells.filter((c) => c.objectId === 'owner');
      assert.equal(own.length, 3);
      assert(own.every((c) => c.areaMM2 === 4800));
      assert.equal(s.cells.find((c) => c.objectId === 'other').areaMM2, 6400);
      assert.equal(compiledCell(q, 'other-body').getArea(), 6400);
      assert.equal(s.cells.find((c) => c.featureId === 'upper').heightMM, 1);
      assert.equal(
        s.cells.find((c) => c.featureId === 'upper').swatchId,
        'red',
      );
      const edited = creationCommand(
        q,
        'height',
        { cellKeys: ['feature:body'], heightMM: 3 },
        s,
      );
      assert.equal(cell(edited).heightMM, 3);
      assert.equal(
        scene(edited).cells.find((c) => c.featureId === 'upper').heightMM,
        1,
      );
      assert.deepEqual(
        q.model.regions,
        compileCreation(q).model.regions.filter((r) => r.kind !== 'creation'),
      );
    },
  );
}
{
  const q = structuredClone(p);
  q.paths.push(rectangle('second', 15, 15, 25, 25));
  q.creation.objects[0].pathIds.push('second');
  q.creation.objects[0].roles.second = 'hole';
  check('multiple holes are subtracted once', () => {
    assert.equal(cell(q).areaMM2, 4700);
    assert.equal(cell(q).holes, 2);
  });
}
{
  const q = structuredClone(p);
  q.paths[1] = rectangle('hole', 0, 0, 100, 100);
  check(
    'a completely removed imported surface stays empty and cannot export its old recipe',
    () => {
      assert.equal(scene(q).cells.length, 0);
      assert.equal(scene(q).errors.length, 0);
      assert.equal(compileCreation(q).model.features[0].enabled, false);
    },
  );
  q.paths.push(rectangle('child-path', 45, 45, 55, 55));
  q.model.regions.push({
    id: 'child-region',
    name: '上层区域',
    kind: 'path',
    pathId: 'child-path',
    color: '#9c3043',
  });
  q.model.features.push({
    id: 'child',
    name: '上层',
    regionId: 'child-region',
    partId: 'main',
    mode: 'add',
    zMM: 0,
    heightMM: 1,
    color: '#9c3043',
    enabled: true,
    attachId: 'body',
  });
  const child = surfaceObject('child-owner', ['child-path'], ['child']);
  child.featureSwatches.child = 'red';
  q.creation.objects.push(child);
  check(
    'removing a supporting face preserves the remaining layer world height',
    () => {
      const c = compileCreation(q);
      assert.equal(resolveHeights(c.model).get('child').bottom, 2);
    },
  );
  const mesh = await buildSolid(q);
  assert(mesh.report.valid);
  assert(Math.abs(mesh.report.volumeMM3 - 100) < 0.01);
}
{
  const q = structuredClone(p);
  q.paths[1].closed = false;
  check('invalid holes surface an error without rendering old geometry', () => {
    assert.match(scene(q).errors[0].message, /hole.*尚未闭合/);
    assert.equal(scene(q).cells.length, 0);
    assert.throws(() => compileCreation(q), /请先处理/);
  });
}
{
  let q = structuredClone(p);
  q.paths.push({
    ...rectangle('divider', 50, 10, 50, 90),
    closed: false,
    curves: [
      [
        { x: 50, y: 10 },
        { x: 50, y: 10 },
        { x: 50, y: 90 },
        { x: 50, y: 90 },
      ],
    ],
  });
  q.creation.objects[0].pathIds.push('divider');
  q.creation.objects[0].roles.divider = 'divider';
  check('partitioned imported surfaces are cut dynamically', () => {
    assert.equal(scene(q).cells.length, 2);
    assert.equal(
      scene(q).cells.reduce((n, c) => n + c.areaMM2, 0),
      4800,
    );
  });
  q = creationCommand(
    q,
    'paint',
    { cellKeys: scene(q).cells.map((c) => c.key), swatchId: 'red' },
    scene(q),
  );
  q.paths[1] = rectangle('hole', 40, 40, 60, 60);
  check('painted partitions change area when the hole is edited', () => {
    const s = scene(q);
    assert.equal(s.cells.length, 2);
    assert.equal(
      s.cells.reduce((n, c) => n + c.areaMM2, 0),
      6000,
    );
    assert(s.cells.every((c) => c.swatchId === 'red' && c.heightMM === 2));
    validateCreation(q.creation);
  });
}
console.log(JSON.stringify({ ok: true, checks }, null, 2));
