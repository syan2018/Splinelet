import assert from 'node:assert/strict';
import { creationCommand } from '../../../src/lib/creation-commands.mjs';
import { evaluateCreation } from '../../../src/lib/creation-engine.mjs';
import { bindSurfaceGraphs } from '../../../src/lib/surface-lineage.mjs';
import { rectangle, liveSurfaces } from '../fixtures/live-surfaces.mjs';
import { buildSolid } from '../../../src/lib/solid-engine.mjs';

let p = liveSurfaces();
p.paths[0] = rectangle('outer', 60, 45, 70, 55);
p.paths[1] = rectangle('hole', 63, 48, 67, 52);
const original = structuredClone(p.paths);
const command = (project, action, args) =>
  creationCommand(
    project,
    action,
    { objectId: 'owner', ...args },
    evaluateCreation(project),
  );
const scene = (project) => {
  const result = evaluateCreation(project);
  assert.deepEqual(result.errors, []);
  return result;
};
const initialArea = scene(p).cells[0].areaMM2;
p = command(p, 'modifier_add', {
  type: 'radial_array',
  count: 4,
  angleDeg: 90,
  centerMM: { x: 0, y: 0 },
});
const s = scene(p);
assert(Math.abs(s.cells[0].areaMM2 - initialArea * 4) < 1e-5);
assert.equal(s.cells[0].geometry.type, 'MultiPolygon');
assert.equal(s.cells[0].geometry.coordinates.length, 4);
assert(
  s.cells[0].geometry.coordinates.every((polygon) => polygon.length === 2),
);
assert.deepEqual(p.paths, original);
assert.deepEqual(scene(JSON.parse(JSON.stringify(p))).cells, s.cells);
p = bindSurfaceGraphs(p, s);
const modifierId = p.creation.objects[0].modifiers.at(-1).id;
let q = command(p, 'modifier_update', { modifierId, changes: { count: 3 } });
assert(Math.abs(scene(q).cells[0].areaMM2 - initialArea * 3) < 1e-5);
q = command(p, 'modifier_update', { modifierId, changes: { enabled: false } });
assert(Math.abs(scene(q).cells[0].areaMM2 - initialArea) < 1e-5);
q = command(p, 'modifier_move', { modifierId, direction: -1 });
assert(evaluateCreation(q).errors.some((e) => e.modifierId === 'hole:hole')); // Reordering changes the bound downstream topology; fail closed.
q = command(p, 'modifier_update', { modifierId, changes: { angleDeg: 0 } });
assert(Math.abs(scene(q).cells[0].areaMM2 - initialArea) < 1e-5); // Overlapping copies union, not multiply volume.
for (const count of [0, 1.5, 65])
  assert.throws(
    () => command(p, 'modifier_update', { modifierId, changes: { count } }),
    /旋转阵列/,
  );
const solid = await buildSolid(p);
assert.equal(solid.report.invalidEdges, 0);
assert.equal(solid.report.zeroArea, 0);
console.log(
  'PASS: radial copies with holes, stack order, live count/disable, overlap union, reload, source immutability and manifold solid',
);
