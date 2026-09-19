import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeProject } from '../../../src/lib/project-format.mjs';
import { importLegacy } from '../../../src/lib/document/import/legacy-import.mjs';
import {
  encodeDocument,
  decodeDocument,
} from '../../../src/lib/document/codec.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { findRegionDrawing } from '../../../src/lib/editing/region-drawing.mjs';
import { repeatedRingDocument } from '../fixtures/v4-programs.mjs';

const files = [
  new URL('../../../public/sandrone-example.spl', import.meta.url),
];
if (process.argv[2]) files.push(process.argv[2]);
const fixtures = files.map((file) =>
  importLegacy(decodeProject(readFileSync(file))),
);
fixtures.push({ document: repeatedRingDocument(), assets: {} });
let sequence = 0;
const idFactory = () => `boundary-drawing-${++sequence}`;
const run = (session, action) =>
  session.dispatch(createAuthoringCommand(action), {
    expectedRevision: session.state.revision,
  });
const normalize = (value) =>
  typeof value === 'number' && value === 0
    ? 0
    : Array.isArray(value)
      ? value.map(normalize)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value).map(([key, child]) => [
              key,
              key === 'dependencies'
                ? [...child].sort((a, b) => a.localeCompare(b))
                : normalize(child),
            ]),
          )
        : value;
for (const fixture of fixtures) {
  const document = fixture.document;
  const program = Object.values(document.programs).find(
    (program) =>
      Object.values(program.operators).some((op) =>
        ['partition', 'join'].includes(op.type),
      ) &&
      evaluateProgram(document, program.ownerNodeId).regions.status === 'ready',
  );
  const ownerNodeId = program.ownerNodeId;
  let session = createEditorSession(document, { idFactory });
  const before = evaluateProgram(document, ownerNodeId);
  run(session, {
    kind: 'start-path',
    ownerNodeId,
    role: 'boundary',
    point: [200, 200],
  });
  const started = session.state.document;
  const sketch = Object.values(started.sketches).find(
    (item) => !document.sketches[item.id],
  );
  const pathRef = {
    kind: 'path',
    sketchId: sketch.id,
    id: Object.keys(sketch.paths)[0],
  };
  const action = { sketchId: sketch.id, pathId: pathRef.id };
  const branch = findRegionDrawing(started, pathRef);
  assert.equal(branch.role, 'boundary');
  assert.equal(
    started.programs[program.id].operators[branch.operatorId].type,
    'fill',
  );
  assert.deepEqual(started.programs[program.id].outputs, program.outputs);
  assert.deepEqual(
    evaluateProgram(started, ownerNodeId).regions,
    before.regions,
  );
  const resumed = decodeDocument(
    encodeDocument(started, { assets: fixture.assets }),
  ).document;
  session = createEditorSession(resumed, { idFactory });
  assert.deepEqual(findRegionDrawing(resumed, pathRef), branch);
  assert.throws(() => run(session, { kind: 'finish-path', ...action }), /闭合/);
  assert.deepEqual(session.state.document, resumed);
  for (const [a, b] of [
    [
      [200, 200],
      [210, 200],
    ],
    [
      [210, 200],
      [210, 210],
    ],
    [
      [210, 210],
      [200, 210],
    ],
  ])
    run(session, { kind: 'extend-path', ...action, cubic: [a, a, b, b] });
  const open = session.state.document;
  assert.deepEqual(
    normalize(evaluateProgram(open, ownerNodeId).regions),
    normalize(before.regions),
  );
  run(session, { kind: 'close-path', ...action });
  const completed = session.state.document;
  assert.equal(findRegionDrawing(completed, pathRef), null);
  const result = evaluateProgram(completed, ownerNodeId);
  assert.equal(result.regions.status, 'ready');
  assert.equal(
    result.regions.value.regions.length,
    before.regions.value.regions.length + 1,
  );
  assert.deepEqual(
    normalize(result.regions.value.regions.slice(0, -1)),
    normalize(before.regions.value.regions),
  );
  assert.deepEqual(
    normalize(result.curves.value.curves.slice(0, -1)),
    normalize(before.curves.value?.curves || []),
  );
  assert.deepEqual(
    result.curves.value.junctions,
    before.curves.value?.junctions || [],
  );
  for (const [id, op] of Object.entries(program.operators))
    assert.deepEqual(completed.programs[program.id].operators[id], op);
  for (const [id, original] of Object.entries(document.sketches))
    assert.deepEqual(completed.sketches[id], original);
  for (const key of ['appearances', 'reliefDefinitions', 'manufacturing'])
    assert.deepEqual(completed[key], document[key]);
  assert.deepEqual(
    normalize(
      evaluateProgram(
        decodeDocument(encodeDocument(completed, { assets: fixture.assets }))
          .document,
        ownerNodeId,
      ),
    ),
    normalize(result),
  );
  session.undo({ expectedRevision: session.state.revision });
  assert.deepEqual(
    session.state.document,
    open,
    'one undo restores the unfinished path and old published output',
  );
  session.redo({ expectedRevision: session.state.revision });
  assert.deepEqual(session.state.document, completed);
  // Complete API drawing shares the same branch builder and appender.
  run(session, {
    kind: 'draw-path',
    ownerNodeId,
    closed: true,
    points: [
      [220, 220],
      [230, 220],
      [230, 230],
      [220, 230],
    ],
  });
  assert.equal(
    evaluateProgram(session.state.document, ownerNodeId).regions.value.regions
      .length,
    result.regions.value.regions.length + 1,
  );
}
console.log(
  'V4 boundary drawing: advanced sample programs, saved continuation, independent append, old identities and single undo passed',
);
