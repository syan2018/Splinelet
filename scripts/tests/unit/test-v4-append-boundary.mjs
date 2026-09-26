import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeProject } from '../../../src/lib/project-format.mjs';
import { importLegacy } from '../../../src/lib/document/import/legacy-import.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { repeatedRingDocument } from '../fixtures/v4-programs.mjs';
import { projectCreationView } from '../../../src/lib/editor/creation-view.mjs';

// Identity-space evaluation may turn IEEE -0 into +0; geometric zero is identical.
const geometricZeros = (value) =>
  typeof value === 'number' && value === 0
    ? 0
    : Array.isArray(value)
      ? value.map(geometricZeros)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value).map(([key, child]) => [
              key,
              geometricZeros(child),
            ]),
          )
        : value;

const files = [new URL('../fixtures/legacy-sandrone.spl', import.meta.url)];
if (process.argv[2]) files.push(process.argv[2]);
const documents = files.map(
  (file) => importLegacy(decodeProject(readFileSync(file))).document,
);
documents.push(repeatedRingDocument());
for (const document of documents) {
  const imported = { document };
  const advanced = Object.values(imported.document.programs).find(
    (program) =>
      Object.values(program.operators).some((op) =>
        ['partition', 'join'].includes(op.type),
      ) &&
      evaluateProgram(imported.document, program.ownerNodeId).regions.status ===
        'ready',
  );
  assert.ok(advanced, 'sample has a ready advanced region program');
  let serial = 0;
  const session = createEditorSession(imported.document, {
    idFactory: () => `append-${++serial}`,
  });
  const run = (action) =>
    session.dispatch(createAuthoringCommand(action), {
      expectedRevision: session.state.revision,
    });
  const oldSketches = structuredClone(session.state.document.sketches);
  run({
    kind: 'draw-path',
    ownerNodeId: advanced.ownerNodeId,
    auxiliary: true,
    closed: true,
    points: [
      [200, 200],
      [210, 200],
      [210, 210],
      [200, 210],
    ],
  });
  const newSketch = Object.values(session.state.document.sketches).find(
    (sketch) => !oldSketches[sketch.id],
  );
  const pathRef = {
    kind: 'path',
    sketchId: newSketch.id,
    id: Object.keys(newSketch.paths)[0],
  };
  const before = structuredClone(session.state.document);
  const previous = evaluateProgram(before, advanced.ownerNodeId);
  const colliding = createEditorSession(before, {
    idFactory: () => Object.keys(advanced.operators)[0],
  });
  assert.throws(
    () =>
      colliding.dispatch(
        createAuthoringCommand({ kind: 'append-boundary', pathRef }),
        { expectedRevision: 0 },
      ),
    /重复 ID/,
  );
  assert.deepEqual(
    colliding.state.document,
    before,
    'ID collision cannot overwrite existing operators',
  );
  run({ kind: 'append-boundary', pathRef });
  const after = session.state.document;
  const result = evaluateProgram(after, advanced.ownerNodeId);
  assert.deepEqual(
    projectCreationView(after, {})
      .modifierStatus.filter((item) => item.type !== 'fill')
      .map((item) => item.modifierId),
    projectCreationView(before, {})
      .modifierStatus.filter((item) => item.type !== 'fill')
      .map((item) => item.modifierId),
    'appending a boundary exposes Fill but introduces no source/collection implementation nodes',
  );
  assert.equal(result.regions.status, 'ready');
  assert.equal(result.curves.status, 'ready');
  assert.equal(
    result.regions.value.regions.length,
    previous.regions.value.regions.length + 1,
  );
  assert.deepEqual(
    geometricZeros(result.regions.value.regions.slice(0, -1)),
    geometricZeros(previous.regions.value.regions),
    'old region identities and geometry survive',
  );
  assert.deepEqual(
    geometricZeros(result.curves.value.curves.slice(0, -1)),
    geometricZeros(previous.curves.value?.curves || []),
    'old curve identities survive',
  );
  assert.deepEqual(
    result.curves.value.junctions,
    previous.curves.value?.junctions || [],
  );
  for (const [id, op] of Object.entries(advanced.operators))
    assert.deepEqual(
      after.programs[advanced.id].operators[id],
      op,
      'old construction stays intact',
    );
  assert.deepEqual(
    after.sketches,
    before.sketches,
    'no frozen or duplicated raw geometry',
  );
  for (const key of ['appearances', 'reliefDefinitions', 'manufacturing'])
    assert.deepEqual(after[key], before[key], `${key} assignments stay intact`);
  const revision = session.state.revision;
  assert.throws(() => run({ kind: 'append-boundary', pathRef }), /重复追加/);
  assert.equal(session.state.revision, revision);
  assert.deepEqual(session.state.document, after);
  session.undo({ expectedRevision: revision });
  assert.deepEqual(
    session.state.document,
    before,
    'one undo restores the prior published branches',
  );
  session.redo({ expectedRevision: session.state.revision });
  assert.deepEqual(session.state.document, after);

  run({
    kind: 'draw-path',
    ownerNodeId: advanced.ownerNodeId,
    auxiliary: true,
    points: [
      [220, 220],
      [230, 220],
    ],
  });
  const openSketch = Object.values(session.state.document.sketches).find(
    (sketch) => !after.sketches[sketch.id],
  );
  const openRef = {
    kind: 'path',
    sketchId: openSketch.id,
    id: Object.keys(openSketch.paths)[0],
  };
  const beforeInvalid = session.state.document;
  assert.throws(
    () => run({ kind: 'append-boundary', pathRef: openRef }),
    /闭合/,
  );
  assert.deepEqual(session.state.document, beforeInvalid);
  const locked = structuredClone(before);
  locked.nodes[advanced.ownerNodeId].locked = true;
  const lockedSession = createEditorSession(locked);
  assert.throws(
    () =>
      lockedSession.dispatch(
        createAuthoringCommand({ kind: 'append-boundary', pathRef }),
        { expectedRevision: 0 },
      ),
    /锁定/,
  );
  assert.equal(lockedSession.state.revision, 0);
}
console.log(
  'V4 append boundary: real sample identities, assignments, history and rejection passed',
);
