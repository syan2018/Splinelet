import assert from 'node:assert/strict';
import fs from 'node:fs';
import { creationCommand } from '../lib/creation-commands.mjs';
import { creationDocument } from '../lib/creation-schema.mjs';
import { evaluateCreation } from '../lib/creation-engine.mjs';
import {
  liveSurfaces,
  rectangle,
  surfaceObject,
} from './fixtures/live-surfaces.mjs';

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
let p = liveSurfaces();
const draft = rectangle('draft', 20, 20, 40, 40);
draft.closed = false;
draft.curves = draft.curves.slice(0, 2);
draft.anchors = draft.anchors.slice(0, 3);
p.paths.push(draft);
p.creation.objects[0].pathIds.push('draft');
p.creation.objects[0].roles.draft = 'boundary';
const target = surfaceObject('target', []);
p.creation.objects.push(target);
const baseline = snapshot(p),
  c = creationDocument(p);
let moved = move(p, ['draft'], 'target');
assert.deepEqual(snapshot(moved), baseline);
assert.deepEqual(moved.creation.objects[0].modifiers, c.objects[0].modifiers);
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
let split = structuredClone(p);
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

const file =
  process.argv[2] ||
  '../../outputs/Sandrone-unified-creation/Sandrone-new.bezier.json';
const original = JSON.parse(fs.readFileSync(file)),
  doc = creationDocument(original),
  path75 = original.paths.find((p) => /^路径\s*75$/.test(p.name));
assert(path75, 'current 75-path artwork is required');
const owner = doc.objects.find((o) => o.pathIds.includes(path75.id)),
  before = snapshot(original);
for (const destination of doc.objects.filter((o) => o.id !== owner.id)) {
  const next = move(original, [path75.id], destination.id);
  assert.deepEqual(snapshot(next), before, destination.name + ' surfaces');
  assert.deepEqual(next.model, original.model);
  for (const object of doc.objects) {
    const actual = next.creation.objects.find((o) => o.id === object.id);
    assert.deepEqual(actual.modifiers, object.modifiers);
    assert.deepEqual(actual.sources, object.sources);
    assert.deepEqual(actual.paints, object.paints);
  }
  const { groupId: ignored, ...actualPath } = next.paths.find(
    (p) => p.id === path75.id,
  );
  const { groupId: previous, ...originalPath } = path75;
  assert.deepEqual(actualPath, originalPath);
  assert.equal(
    next.paths.find((p) => p.id === path75.id).groupId,
    destination.groupId,
  );
  const roundtrip = move(
    JSON.parse(JSON.stringify(next)),
    [path75.id],
    owner.id,
  );
  assert.deepEqual(snapshot(roundtrip), before);
  assert(
    roundtrip.creation.objects
      .find((o) => o.id === owner.id)
      .pathIds.includes(path75.id),
  );
  checks.push(
    'real path 75 moves to ' +
      destination.name +
      ' and back after reload without geometry/style coupling',
  );
}
console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
