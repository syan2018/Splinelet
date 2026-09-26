import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  importLegacy,
  LegacyImportError,
} from '../../../src/lib/document/import/legacy-import.mjs';
import { validateDocument } from '../../../src/lib/document/schema.mjs';
import { decodeProject } from '../../../src/lib/project-format.mjs';
import {
  closedPath,
  v2SharedProject,
  v3ProgramProject,
} from '../fixtures/v4-migration/legacy-projects.mjs';

const refs = (value) =>
  (Array.isArray(value) ? value : [value]).filter(Boolean);

const collectionFor = (migrated, legacyGroupId) => {
  const mapped = migrated.idMap[`group:${legacyGroupId}`];
  assert.equal(mapped?.kind, 'collection');
  return migrated.document.collections[mapped.id];
};

const ownerNodeId = (migrated, legacyOwnerId) => {
  const mapped = migrated.idMap[`object:${legacyOwnerId}`];
  assert.equal(mapped?.kind, 'node');
  return mapped.id;
};

const ownedPathRef = (project, migrated, legacyPathId) => {
  const owners = project.creation.objects.filter((object) =>
    object.pathIds.includes(legacyPathId),
  );
  assert.equal(owners.length, 1, `${legacyPathId} must have one real owner`);
  const nodeId = ownerNodeId(migrated, owners[0].id);
  const pathRefs = refs(migrated.idMap[`path:${legacyPathId}`]);
  const owned = pathRefs.filter(
    (ref) =>
      ref.kind === 'path' &&
      migrated.document.sketches[ref.sketchId]?.ownerNodeId === nodeId,
  );
  assert.equal(owned.length, 1, `${legacyPathId} must map to its owned path`);
  return owned[0];
};

const sandroneProject = decodeProject(
  fs.readFileSync('scripts/tests/fixtures/legacy-sandrone.spl'),
);
const sandrone = importLegacy(sandroneProject);
assert.equal(validateDocument(sandrone.document), sandrone.document);
assert.equal(sandroneProject.groups.length, 11);

for (const group of sandroneProject.groups) {
  const expected = sandroneProject.paths
    .filter((path) => path.groupId === group.id)
    .flatMap((path) => [ownedPathRef(sandroneProject, sandrone, path.id)]);
  const collection = collectionFor(sandrone, group.id);
  assert.deepEqual(
    collection.members,
    expected,
    `${group.name} must preserve exact path membership and project path order`,
  );
}

const headwearGroup = sandroneProject.groups.find(
  (group) => group.name === '头饰',
);
const headwear = sandroneProject.creation.objects.find(
  (object) => object.name === '头饰',
);
assert.equal(
  sandroneProject.paths.filter((path) => path.groupId === headwearGroup.id)
    .length,
  9,
);
assert.equal(headwear.pathIds.length, 20);
assert.equal(collectionFor(sandrone, headwearGroup.id).members.length, 9);

const outlineGroup = sandroneProject.groups.find(
  (group) => group.name === '外框',
);
const outlinePath = sandroneProject.paths.find(
  (path) => path.groupId === outlineGroup.id,
);
assert.equal(refs(sandrone.idMap[`path:${outlinePath.id}`]).length, 1);
assert.deepEqual(collectionFor(sandrone, outlineGroup.id).members, [
  ownedPathRef(sandroneProject, sandrone, outlinePath.id),
]);

for (const node of Object.values(sandrone.document.nodes)) {
  assert.equal(node.parentId, null);
  assert.deepEqual(node.pose, { translationMM: [0, 0], rotationRad: 0 });
}

const sparseProject = v3ProgramProject();
sparseProject.groups.push({ id: 'empty-group', name: '空分组' });
const ungrouped = closedPath('ungrouped');
delete ungrouped.groupId;
sparseProject.paths.push(ungrouped);
sparseProject.creation.objects[0].pathIds.push(ungrouped.id);
const sparse = importLegacy(sparseProject);
assert.deepEqual(collectionFor(sparse, 'empty-group').members, []);
assert.ok(
  Object.values(sparse.document.collections).every((collection) =>
    collection.members.every(
      (member) =>
        member.kind !== 'path' ||
        member.id !== ownedPathRef(sparseProject, sparse, ungrouped.id).id,
    ),
  ),
);

const sharedProject = v2SharedProject();
let sharedError;
try {
  importLegacy(sharedProject);
} catch (error) {
  sharedError = error;
}
assert.ok(sharedError instanceof LegacyImportError);
assert.ok(
  sharedError.report.issues.some(
    (issue) =>
      issue.code === 'ambiguous-path-owner' &&
      issue.ref?.id === 'outline' &&
      issue.ownerIds.join(',') === 'left,right',
  ),
);

console.log(
  'PASS: legacy groups retain exact ordered PathRefs, exclude external source references, preserve empty/ungrouped paths, and reject ambiguous source ownership.',
);
