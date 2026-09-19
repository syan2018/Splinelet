import assert from 'node:assert/strict';
import {
  createDocument,
  validateDocument,
} from '../../../src/lib/document/schema.mjs';
import {
  encodeDocument,
  decodeDocument,
} from '../../../src/lib/document/codec.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { findRegionDrawing } from '../../../src/lib/editing/region-drawing.mjs';
import { projectCreationView } from '../../../src/lib/editor/creation-view.mjs';
import { compileModifierUpdate } from '../../../src/lib/editor/modifier-intents.mjs';

let sequence = 0;
const idFactory = () => `drawing-${++sequence}`;
const create = (document = createDocument({ idFactory })) =>
  createEditorSession(document, { idFactory });
const run = (session, action) =>
  session.dispatch(createAuthoringCommand(action), {
    expectedRevision: session.state.revision,
  });
const base = create();
run(base, {
  kind: 'draw-path',
  points: [
    [0, 0],
    [20, 0],
    [20, 20],
    [0, 20],
  ],
  closed: true,
});
const ownerNodeId = Object.keys(base.state.document.nodes)[0];
const baseStage = evaluateProgram(base.state.document, ownerNodeId).regions;
const target = baseStage.value.regions[0].ref;
run(base, { kind: 'create-swatch', name: '红色', color: '#ff0000' });
const swatchId = Object.keys(base.state.document.appearances.swatches)[0];
run(base, { kind: 'paint-region', target, swatchId });
run(base, {
  kind: 'set-thickness',
  target,
  thickness: { kind: 'mm', value: 3 },
});
const original = base.state.document;
const start = (session, role, point) => {
  const oldIds = new Set(Object.keys(session.state.document.sketches));
  run(session, {
    kind: 'start-path',
    role,
    point,
    ownerNodeId,
    targets: [target],
  });
  const sketch = Object.values(session.state.document.sketches).find(
    (item) => !oldIds.has(item.id),
  );
  return {
    kind: 'path',
    sketchId: sketch.id,
    id: Object.keys(sketch.paths)[0],
  };
};
const extend = (session, ref, from, to) =>
  run(session, {
    kind: 'extend-path',
    sketchId: ref.sketchId,
    pathId: ref.id,
    cubic: [from, from, to, to],
  });
const finish = (session, ref, close = false) =>
  run(session, {
    kind: close ? 'close-path' : 'finish-path',
    sketchId: ref.sketchId,
    pathId: ref.id,
  });

for (const role of ['divider', 'hole']) {
  let session = create(original);
  const ref = start(session, role, role === 'divider' ? [10, -1] : [5, 5]);
  const drawing = session.state.document;
  const branch = findRegionDrawing(drawing, ref);
  assert.equal(branch.role, role);
  const program = drawing.programs[drawing.nodes[ownerNodeId].programId];
  assert.deepEqual(program.outputs, original.programs[program.id].outputs);
  assert.equal(program.operators[branch.operatorId].enabled, false);
  assert.deepEqual(
    evaluateProgram(drawing, ownerNodeId).regions,
    baseStage,
    'single point never changes published regions',
  );
  for (const key of ['appearances', 'reliefDefinitions', 'manufacturing'])
    assert.deepEqual(drawing[key], original[key]);
  assert.equal(
    projectCreationView(drawing, {}).modifierStatus.length,
    0,
    'unfinished drawing is not a modifier',
  );
  assert.throws(
    () =>
      compileModifierUpdate(drawing, {
        objectId: ownerNodeId,
        modifierId: branch.operatorId,
        changes: { enabled: true },
      }),
    /绘制/,
  );
  const invalid = structuredClone(drawing);
  invalid.programs[program.id].operators[branch.operatorId].authoring.phase =
    'ready';
  assert.throws(() => validateDocument(invalid), /authoring/);
  // Codec key ordering must not prevent recognition of the captured old port.
  const reopened = decodeDocument(encodeDocument(drawing)).document;
  assert.deepEqual(reopened, drawing);
  session = create(reopened);
  assert.deepEqual(findRegionDrawing(session.state.document, ref), branch);
  assert.throws(() => finish(session, ref), /区域|分区/);
  assert.deepEqual(
    session.state.document,
    reopened,
    'failed completion keeps unfinished source',
  );
  if (role === 'divider') extend(session, ref, [10, -1], [10, 21]);
  else {
    extend(session, ref, [5, 5], [15, 5]);
    extend(session, ref, [15, 5], [15, 15]);
    extend(session, ref, [15, 15], [5, 15]);
    assert.throws(
      () => finish(session, ref),
      /区域/,
      'open hole cannot finish',
    );
  }
  const beforeFinish = session.state.document;
  const operatorIds = Object.keys(beforeFinish.programs[program.id].operators);
  finish(session, ref, role === 'hole');
  const completed = session.state.document;
  const finalStage = evaluateProgram(completed, ownerNodeId).regions;
  assert.deepEqual(
    evaluateProgram(
      decodeDocument(encodeDocument(completed)).document,
      ownerNodeId,
    ).regions,
    finalStage,
    'completed output contract survives actual file encoding',
  );
  assert.equal(finalStage.status, 'ready');
  assert.equal(finalStage.value.regions.length, role === 'divider' ? 2 : 1);
  assert.equal(findRegionDrawing(completed, ref), null);
  assert.deepEqual(
    Object.keys(completed.programs[program.id].operators),
    operatorIds,
    'finish reuses the saved branch',
  );
  assert.equal(
    Object.values(completed.appearances.overrides).length,
    role === 'divider' ? 2 : 1,
  );
  assert.equal(
    Object.values(completed.reliefDefinitions.overrides).length,
    role === 'divider' ? 2 : 1,
  );
  if (role === 'divider')
    assert.ok(
      completed.programs[program.id].operators[branch.operatorId]
        .outputContract,
    );
  else
    assert.equal(
      finalStage.value.regions[0].geometry.coordinates.length,
      2,
      'closed hole is actually cut',
    );
  session.undo({ expectedRevision: session.state.revision });
  assert.deepEqual(session.state.document, beforeFinish);
  session.redo({ expectedRevision: session.state.revision });
  assert.deepEqual(session.state.document, completed);
}

const two = create(original);
const first = start(two, 'divider', [10, -1]);
const second = start(two, 'divider', [5, -1]);
extend(two, first, [10, -1], [10, 21]);
extend(two, second, [5, -1], [5, 21]);
finish(two, first);
const afterFirst = two.state.document;
assert.ok(
  findRegionDrawing(afterFirst, second),
  'finishing one path does not complete another',
);
assert.throws(
  () => finish(two, second),
  /失效|变化/,
  'captured old target cannot silently change',
);
assert.deepEqual(two.state.document, afterFirst);
console.log(
  'V4 incremental region drawing: saved branches, exact targets, continuation, assignments and atomic completion passed',
);
