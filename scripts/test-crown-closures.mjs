import fs from 'node:fs';
import assert from 'node:assert/strict';
import { evaluateCreation, compileCreation } from '../lib/creation-engine.mjs';
import { creationCommand } from '../lib/creation-commands.mjs';
import {
  regionContext,
  readGeometry,
  robustPolygonize,
} from '../lib/region-engine.mjs';

const source =
  process.argv[2] ||
  '../../outputs/crown-closure-repair/Sandrone-new.source.bezier.json';
const p = JSON.parse(fs.readFileSync(source));
const original = structuredClone(p),
  before = evaluateCreation(p);
const crown = before.creation.objects.find((o) => o.name === '头饰');
const edge = p.paths.find((p) => p.name === '头饰环5下');
const own = (s) => s.cells.filter((c) => c.objectId === crown.id);
assert.deepEqual(before.errors, []);
const checks = [];

// Exercise the reported numerical failure independently of redundant band-edge
// detection: the same curve is a newly added divider with a distinct identity.
const repro = structuredClone(p),
  newEdge = { ...structuredClone(edge), id: 'noding-repro' };
repro.paths.push(newEdge);
const object = repro.creation.objects.find((o) => o.id === crown.id);
object.pathIds.push(newEdge.id);
object.roles[newEdge.id] = 'divider';
const divided = evaluateCreation(repro);
assert.deepEqual(divided.errors, []);
assert(own(divided).length > own(before).length);
checks.push(
  'reported clipped-coordinate junction is fully noded for an independent divider',
);

// Floating endpoints rounded by a previous intersection must occupy one node,
// including the degenerate segments they can leave in a subsequent graph.
const x = 12.088153783016967,
  y = 30.14065903744553;
for (const sign of [1, -1]) {
  const points = [
    [x, y],
    [x + 1, y],
    [x + 1, y + 1],
    [x, y + 1],
    [x, y],
  ].map(([x, y]) => [x * sign, y * sign]);
  const lines = [
    points,
    [
      [12.088153783, 30.140659037],
      [x, y],
    ].map(([x, y]) => [x * sign, y * sign]),
  ];
  const cells = robustPolygonize(
    lines.map((coordinates) =>
      readGeometry({ type: 'LineString', coordinates }),
    ),
  );
  assert.equal(cells.length, 1);
  assert(Math.abs(cells[0].getArea() - 1) < 1e-7);
}
checks.push(
  'near-identical junctions and collapsed segments share the same precision grid',
);

let q = creationCommand(
  p,
  'roles',
  { objectId: crown.id, pathIds: [edge.id], role: 'divider' },
  before,
);
let s = evaluateCreation(q);
assert.deepEqual(s.errors, []);
assert.deepEqual(s.cells, before.cells);
assert(
  s.diagnostics.some(
    (d) => d.pathId === edge.id && d.status === 'existing_boundary',
  ),
);
assert.deepEqual(q.paths, p.paths);
checks.push(
  'reclassifying an existing band edge preserves every surface, colour and height',
);

const args = {
  objectId: crown.id,
  featureId: 'body-band-60',
  regionId: 'band-60',
  boundaryRegionId: 'source-8',
  joinMM: 0.15,
};
assert.throws(
  () => creationCommand(q, 'closure_boundary', { ...args, joinMM: 0 }),
  /超过边界接合距离/,
);
assert.throws(
  () =>
    creationCommand(q, 'closure_boundary', {
      ...args,
      boundaryRegionId: 'source-0',
    }),
  /超过边界接合距离/,
);
assert.throws(
  () =>
    creationCommand(q, 'closure_boundary', { ...args, featureId: 'body-base' }),
  /不属于当前对象/,
);
assert.deepEqual(p, original);
checks.push(
  'invalid, distant and foreign closure changes are rejected before mutation',
);

q = creationCommand(q, 'closure_boundary', args);
s = evaluateCreation(q);
assert.deepEqual(s.errors, []);
const target = s.cells.find((c) => c.featureId === args.featureId);
assert(Math.abs(target.areaMM2 - 10.989169396445089) < 1e-6);
assert.equal(
  target.heightMM,
  before.cells.find((c) => c.featureId === args.featureId).heightMM,
);
assert.equal(
  target.color,
  before.cells.find((c) => c.featureId === args.featureId).color,
);
for (const cell of before.cells.filter((c) => c.featureId !== args.featureId))
  assert.deepEqual(
    s.cells.find((c) => c.key === cell.key),
    cell,
  );
const parent = regionContext(q).get('source-8').getBoundary();
for (const closure of s.closures.filter(
  (c) => c.featureId === args.featureId,
)) {
  assert.equal(closure.boundaryRegionId, 'source-8');
  assert(closure.coordinates.length >= 4);
  for (const coordinates of closure.coordinates.slice(1, -1))
    assert(
      parent.distance(readGeometry({ type: 'Point', coordinates })) < 1e-7,
    );
}
assert.deepEqual(q.paths, p.paths);
assert.deepEqual(q.model.features, p.model.features);
checks.push(
  'both caps follow the actual crown contour while source nodes and unrelated faces stay fixed',
);

const restored = creationCommand(q, 'closure_boundary', {
  ...args,
  boundaryRegionId: null,
});
assert.deepEqual(evaluateCreation(restored).cells, before.cells);
assert.deepEqual(
  evaluateCreation(JSON.parse(JSON.stringify(q))).cells,
  s.cells,
);
const moved = structuredClone(q);
const upper = moved.paths.find(
  (p) => p.id === 'a22b84e1-a2e0-4091-b675-883215f94ed9',
);
upper.curves[0][1].x += 1;
const live = evaluateCreation(moved);
assert.deepEqual(live.errors, []);
assert.notEqual(
  live.cells.find((c) => c.featureId === args.featureId).areaMM2,
  target.areaMM2,
);
const compiled = compileCreation(moved);
assert.equal(
  regionContext(compiled)
    .get(compiled.model.features.find((f) => f.id === args.featureId).regionId)
    .getArea(),
  live.cells.find((c) => c.featureId === args.featureId).areaMM2,
);
checks.push(
  'straight mode restores exactly, JSON reload retains contour mode and edits update preview and extrusion',
);
console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
