import assert from 'node:assert/strict';
import { creationCommand } from '../../../src/lib/creation-commands.mjs';
import { creationDocument } from '../../../src/lib/creation-schema.mjs';
import { evaluateCreation } from '../../../src/lib/creation-engine.mjs';
import {
  liveSurfaces,
  rectangle,
  surfaceObject,
} from '../fixtures/live-surfaces.mjs';

const checks = [];
const move = (p, pathIds, objectId) =>
  creationCommand(p, 'move_paths', { pathIds, objectId }, evaluateCreation(p));
const snapshot = (p) => {
  const scene = evaluateCreation(p);
  assert.deepEqual(scene.errors, []);
  return scene.cells.map((c) => ({
    key: c.key,
    objectId: c.objectId,
    geometry: c.geometry,
    color: c.color,
    height: c.heightMM,
    z: c.bottomMM ?? c.zMM,
  }));
};
const p = liveSurfaces();
const draft = rectangle('draft', 20, 20, 40, 40);
draft.closed = false;
draft.curves = draft.curves.slice(0, 2);
draft.anchors = draft.anchors.slice(0, 3);
p.paths.push(draft);
p.creation.objects[0].pathIds.push('draft');
p.creation.objects[0].roles.draft = 'boundary';
const target = surfaceObject('target', []);
p.creation.objects.push(target);
const baseline = snapshot(p);
let moved = move(p, ['draft'], 'target');
assert.deepEqual(snapshot(moved), baseline);
assert(!Object.hasOwn(moved.creation.objects[0].roles, 'draft'));
assert.equal(moved.creation.objects[1].roles.draft, 'boundary');
checks.push(
  'unfinished boundary moves out of a modifier-owning object without changing its hole or surfaces',
);

const guide = rectangle('guide', 12, 12, 18, 18);
moved.paths.push(guide);
moved.creation.objects[0].pathIds.push('guide');
moved.creation.objects[0].roles.guide = 'guide';
moved = move(moved, ['draft'], 'owner');
moved.creation.objects.push(structuredClone(target));
moved = move(moved, ['draft', 'guide'], 'target');
assert(
  moved.creation.objects
    .find((o) => o.id === 'target')
    .pathIds.includes('guide'),
);
assert.deepEqual(snapshot(moved), baseline);
checks.push(
  'multi-select transfer handles a draft and a closed reference line atomically',
);
assert.throws(() => move(p, ['draft', 'hole'], 'target'), /hole.*参与/);
assert.deepEqual(p.creation.objects[0].pathIds, ['outer', 'hole', 'draft']);
checks.push(
  'an actually used hole remains protected by a named dependency error, with no partial batch move',
);

// Explicit modifier inputs count even for an open reference path.
const split = structuredClone(p);
split.creation = creationDocument(split);
split.creation.objects[0].modifiers.push({
  id: 'disabled-split',
  name: '分区',
  type: 'split',
  enabled: false,
  input: { kind: 'path', id: 'draft' },
  targets: { kind: 'all' },
});
assert.throws(() => move(split, ['draft'], 'target'), /draft.*参与/);
checks.push('disabled source references are not mistaken for unused paths');

console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
