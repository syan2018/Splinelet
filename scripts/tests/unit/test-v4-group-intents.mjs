import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createStudioSession } from '../../../src/lib/editor/studio-session.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createSourceOrganizationCommand } from '../../../src/lib/editing/commands/source-organization.mjs';
import { movePaths } from '../../../src/lib/source-editor/selection.mjs';

let serial = 0;
const idFactory = () => `group-intent-${++serial}`;
const session = createStudioSession({
  opened: {
    kind: 'v4',
    document: createDocument({ idFactory }),
    assets: {},
    target: null,
  },
  presentation: {
    reference: null,
    frame: { width: 800, height: 600, widthMM: 100 },
    fileName: null,
    blenderExtrusionMM: 2,
  },
  persistence: { writeFile: async () => {} },
  idFactory,
});
for (let i = 0; i < 3; i++)
  session.dispatch(
    createAuthoringCommand({
      kind: 'draw-path',
      closed: false,
      points: [
        [i, 0],
        [i + 1, 1],
      ],
    }),
  );
const snapshot = () => session.getSnapshot();
const ids = snapshot().project.paths.map((path) => path.id);
const initialPrograms = structuredClone(
  snapshot().editorState.document.programs,
);
const run = (request) => {
  const captured = snapshot();
  const result = captured.runtime
    .commandGroup(request, { project: captured.project })
    .commit();
  assert.equal(
    snapshot().editorState.revision,
    captured.editorState.revision + 1,
  );
  return result;
};
let result = run({ kind: 'create-group', name: 'A', pathIds: ids.slice(0, 2) });
const a = result.groups[0].id;
assert.deepEqual(result.groups[0].pathIds, ids.slice(0, 2));
result = run({ kind: 'create-group', name: 'B', pathIds: [ids[0], ids[2]] });
const b = result.groups[1].id;
assert.deepEqual(result.groups.find((g) => g.id === a).pathIds, [ids[1]]);
assert.equal(result.paths[0].groupId, b);
const beforeMove = snapshot().editorState.document;
const legacy = structuredClone(result);
movePaths(legacy, [ids[2]], a, ids[1], true);
result = run({
  kind: 'move-group-paths',
  pathIds: [ids[2]],
  groupId: a,
  targetId: ids[1],
  after: true,
});
assert.deepEqual(
  result.paths.map((p) => [p.id, p.groupId]),
  legacy.paths.map((p) => [p.id, p.groupId]),
);
assert.deepEqual(snapshot().editorState.document.programs, initialPrograms);
session.undo();
assert.deepEqual(snapshot().editorState.document, beforeMove);
run({ kind: 'assign-group', pathIds: [ids[0]], groupId: null });
assert.equal(
  snapshot().project.paths.find((p) => p.id === ids[0]).groupId,
  undefined,
);
run({ kind: 'rename-group', groupId: b, name: 'Renamed' });
run({ kind: 'group-visibility', groupId: b, visible: false });
assert.equal(
  snapshot().project.paths.find((p) => p.id === ids[2]).visible,
  false,
);
run({ kind: 'delete-group', groupId: b });
assert.equal(snapshot().project.paths.length, 3);
const held = snapshot();
const stale = held.runtime.commandGroup(
  { kind: 'rename-group', groupId: a, name: 'stale' },
  { project: held.project },
);
run({ kind: 'rename-group', groupId: a, name: 'current' });
assert.throws(() => stale.commit(), /过期/);
const source = snapshot().runtime.readSourceView(snapshot().project).source;
const ref = source.identities.byId[ids[1]];
session.dispatch(
  createSourceOrganizationCommand({
    kind: 'create-path-collection',
    name: 'overlap',
    pathRefs: [ref],
  }),
);
const overlap = snapshot();
const shown = overlap.project.paths.find((p) => p.id === ids[1]);
assert.equal(shown.groupIds.length, 2);
assert.equal(shown.groupId, undefined);
assert.throws(
  () =>
    overlap.runtime.commandGroup(
      { kind: 'move-group-paths', pathIds: [ids[0]], targetId: ids[1] },
      { project: overlap.project },
    ),
  /多个分组/,
);
assert.equal(snapshot(), overlap);
run({ kind: 'assign-group', pathIds: [ids[1]], groupId: a });
assert.deepEqual(
  snapshot().project.paths.find((p) => p.id === ids[1]).groupIds,
  [a],
);
assert.equal(
  JSON.stringify(snapshot().editorState.document).includes('groupIds'),
  false,
);
session.dispose();
console.log(
  'PASS original grouping and order compile to atomic source collection commands, preserve Programs, expose overlaps and reject stale plans',
);
