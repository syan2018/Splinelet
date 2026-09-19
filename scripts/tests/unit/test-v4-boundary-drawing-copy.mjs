import assert from 'node:assert/strict';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import {
  decodeDocument,
  encodeDocument,
} from '../../../src/lib/document/codec.mjs';
import { createAdvancedCommand } from '../../../src/lib/editing/commands/advanced.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { findRegionDrawing } from '../../../src/lib/editing/region-drawing.mjs';
import { repeatedRingDocument } from '../fixtures/v4-programs.mjs';

let sequence = 0;
const idFactory = () => `boundary-drawing-copy-${++sequence}`;
const dispatch = (session, command) =>
  session.dispatch(command, { expectedRevision: session.state.revision });
const author = (session, action) =>
  dispatch(session, createAuthoringCommand(action));
const advanced = (session, action) =>
  dispatch(session, createAdvancedCommand(action));
const pathRef = (sketchId, id) => ({ kind: 'path', sketchId, id });
const programFor = (document, ownerNodeId) =>
  document.programs[document.nodes[ownerNodeId].programId];
const drawingChain = (document, branch) => {
  const program = programFor(document, branch.ownerNodeId);
  const fill = program.operators[branch.operatorId];
  assert.equal(fill.type, 'fill');
  const sourceRef = fill.inputs.input[0];
  const source = program.operators[sourceRef.operatorId];
  assert.equal(source.type, 'source');
  return { program, fill, source, sourceRef };
};
const newDrawingPath = (document, priorSketchIds) => {
  const sketch = Object.values(document.sketches).find(
    (item) =>
      !priorSketchIds.has(item.id) &&
      Object.values(item.paths).some((path) => path.edges.length === 0),
  );
  assert.ok(sketch, 'copied owner must retain its drawing Sketch');
  const path = Object.values(sketch.paths).find(
    (item) => item.edges.length === 0,
  );
  return pathRef(sketch.id, path.id);
};
const ready = (document, ownerNodeId) => {
  const stage = evaluateProgram(document, ownerNodeId);
  assert.equal(
    stage.curves.status,
    'ready',
    JSON.stringify(stage.curves.diagnostics),
  );
  assert.equal(
    stage.regions.status,
    'ready',
    JSON.stringify(stage.regions.diagnostics),
  );
  return stage;
};

const session = createEditorSession(repeatedRingDocument(), { idFactory });
const ownerNodeId = 'shape';
const originalProgram = programFor(session.state.document, ownerNodeId);
const originalJoinId = originalProgram.outputs.curves.operatorId;
const originalSourceId =
  originalProgram.operators.join.inputs.input[0].operatorId;
ready(session.state.document, ownerNodeId);

const initialSketchIds = new Set(Object.keys(session.state.document.sketches));
author(session, {
  kind: 'start-path',
  point: [40, 30],
  ownerNodeId,
});
const originalRef = newDrawingPath(session.state.document, initialSketchIds);
const originalBranch = findRegionDrawing(session.state.document, originalRef);
assert.deepEqual(originalBranch, {
  ownerNodeId,
  operatorId: originalBranch.operatorId,
  role: 'boundary',
});
const originalChain = drawingChain(session.state.document, originalBranch);
assert.equal(originalChain.fill.enabled, false);
assert.deepEqual(originalChain.fill.authoring, { phase: 'drawing' });
const originalPending = structuredClone(session.state.document);

const beforeCopySketchIds = new Set(
  Object.keys(session.state.document.sketches),
);
advanced(session, { kind: 'copy-nodes', nodeIds: [ownerNodeId] });
const copiedOwnerNodeId = session.state.lastChange.selectionIntent.activeRef.id;
assert.notEqual(copiedOwnerNodeId, ownerNodeId);
const copiedRef = newDrawingPath(session.state.document, beforeCopySketchIds);
assert.equal(
  session.state.document.sketches[copiedRef.sketchId].ownerNodeId,
  copiedOwnerNodeId,
);
const copiedBranch = findRegionDrawing(session.state.document, copiedRef);
assert.deepEqual(copiedBranch?.role, 'boundary');
assert.equal(copiedBranch.ownerNodeId, copiedOwnerNodeId);
const copiedChain = drawingChain(session.state.document, copiedBranch);
assert.equal(copiedChain.fill.enabled, false);
assert.deepEqual(copiedChain.fill.authoring, { phase: 'drawing' });
assert.equal(copiedChain.sourceRef.ownerNodeId, copiedOwnerNodeId);
assert.equal(copiedChain.source.inputs.paths[0].sketchId, copiedRef.sketchId);
assert.deepEqual(copiedChain.source.inputs.paths[0].pathIds, [copiedRef.id]);
assert.notEqual(copiedChain.source.id, originalChain.source.id);
assert.notEqual(copiedChain.fill.id, originalChain.fill.id);

const reopenedCopy = decodeDocument(
  encodeDocument(session.state.document),
).document;
assert.equal(findRegionDrawing(reopenedCopy, copiedRef)?.role, 'boundary');
ready(reopenedCopy, ownerNodeId);
ready(reopenedCopy, copiedOwnerNodeId);

author(session, {
  kind: 'extend-path',
  sketchId: copiedRef.sketchId,
  pathId: copiedRef.id,
  cubic: [
    [40, 30],
    [40, 30],
    [50, 30],
    [50, 30],
  ],
});
author(session, {
  kind: 'extend-path',
  sketchId: copiedRef.sketchId,
  pathId: copiedRef.id,
  cubic: [
    [50, 30],
    [50, 30],
    [45, 40],
    [45, 40],
  ],
});
author(session, {
  kind: 'close-path',
  sketchId: copiedRef.sketchId,
  pathId: copiedRef.id,
});
assert.equal(findRegionDrawing(session.state.document, copiedRef), null);
ready(session.state.document, copiedOwnerNodeId);

const completedOriginalProgram = programFor(
  session.state.document,
  ownerNodeId,
);
assert.deepEqual(
  session.state.document.nodes[ownerNodeId],
  originalPending.nodes[ownerNodeId],
  'finishing the copied boundary must not change the original owner',
);
assert.deepEqual(
  completedOriginalProgram.operators[originalSourceId],
  originalPending.programs[originalProgram.id].operators[originalSourceId],
  'finishing the copied boundary must not change the original source',
);
assert.equal(
  completedOriginalProgram.outputs.curves.operatorId,
  originalJoinId,
);
assert.deepEqual(
  completedOriginalProgram.operators[originalJoinId],
  originalPending.programs[originalProgram.id].operators[originalJoinId],
  'the original Join identity and curve chain must stay published',
);
assert.deepEqual(
  completedOriginalProgram,
  originalPending.programs[originalProgram.id],
  'finishing the copied boundary must leave the original pending branch untouched',
);
assert.deepEqual(
  session.state.document.sketches[originalRef.sketchId],
  originalPending.sketches[originalRef.sketchId],
);
assert.deepEqual(
  findRegionDrawing(session.state.document, originalRef),
  originalBranch,
);

const reopenedCompleted = decodeDocument(
  encodeDocument(session.state.document),
).document;
ready(reopenedCompleted, ownerNodeId);
ready(reopenedCompleted, copiedOwnerNodeId);

console.log(
  'PASS advanced boundary drawing copies keep pending branches isolated, publish through collectors, and survive file roundtrips',
);
