import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createAdvancedCommand } from '../../../src/lib/editing/commands/advanced.mjs';
import { createSourceTransferCommand } from '../../../src/lib/editing/commands/source-transfer.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';

let sequence = 0;
const idFactory = () => `v5-copy-${++sequence}`;
const session = createEditorSession(createDocument({ version: 5, idFactory }), {
  idFactory,
});
const run = (action) =>
  session.dispatch(createAuthoringCommand(action), {
    expectedRevision: session.state.revision,
  });
const regionStage = (document, ownerNodeId) => {
  const stage = evaluateProgram(document, ownerNodeId).regions;
  assert.equal(stage.status, 'ready', JSON.stringify(stage.diagnostics));
  return stage.value.regions;
};
const cellUses = (selector) =>
  [selector.outer, ...(selector.holes || [])].flatMap((ring) =>
    ring.flatMap((run) => run.sources.map((source) => source.use)),
  );

run({
  kind: 'draw-path',
  points: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
  closed: true,
});
const ownerNodeId = Object.keys(session.state.document.nodes)[0];
const sketch = Object.values(session.state.document.sketches)[0];
const path = Object.values(sketch.paths)[0];
run({ kind: 'create-swatch', name: 'red', color: '#ff0000' });
const swatchId = Object.keys(session.state.document.appearances.swatches)[0];
run({
  kind: 'paint-region',
  target: regionStage(session.state.document, ownerNodeId)[0].ref,
  swatchId,
});
run({
  kind: 'set-thickness',
  target: regionStage(session.state.document, ownerNodeId)[0].ref,
  thickness: { kind: 'mm', value: 2.5 },
});
const original = structuredClone(session.state.document);
const baseRef = regionStage(original, ownerNodeId)[0].ref;
const baseDefinition = original.regionDefinitions[baseRef.key];

// A result selector is a distinct typed parent reference. It is intentionally
// not evaluated here; the copy assertion verifies its parent ID is remapped.
const copySource = structuredClone(original);
copySource.regionDefinitions.result = {
  id: 'result',
  context: structuredClone(baseDefinition.context),
  selector: {
    kind: 'result',
    role: 'boolean',
    parent: structuredClone(baseRef),
  },
};
const copied = createAdvancedCommand({
  kind: 'copy-nodes',
  nodeIds: [ownerNodeId],
})(copySource, { idFactory });
const copiedOwnerNodeId = copied.selectionIntent.activeRef.id;
const copiedRegions = regionStage(copied.document, copiedOwnerNodeId);
const copiedBase = copiedRegions.find(
  (region) => region.ref.key !== baseRef.key,
);
assert.ok(copiedBase, 'copied region gets a new RegionDefinition key');
const copiedDefinition = copied.document.regionDefinitions[copiedBase.ref.key];
assert.equal(copiedDefinition.context.ownerNodeId, copiedOwnerNodeId);
assert.notEqual(
  copiedDefinition.context.operatorId,
  baseDefinition.context.operatorId,
);
const copiedSketchId = copied.document.nodes[copiedOwnerNodeId].programId
  ? Object.values(copied.document.sketches).find(
      (item) => item.ownerNodeId === copiedOwnerNodeId,
    ).id
  : null;
const copiedPath = Object.values(
  copied.document.sketches[copiedSketchId].paths,
)[0];
const copiedUse = cellUses(copiedDefinition.selector)[0];
assert.equal(copiedUse.sketchId, copiedSketchId);
assert.equal(copiedUse.pathId, copiedPath.id);
const copiedColor = Object.values(copied.document.appearances.overrides).find(
  (item) => item.target.ownerNodeId === copiedOwnerNodeId,
);
const copiedThickness = Object.values(
  copied.document.reliefDefinitions.overrides,
).find((item) => item.target.ownerNodeId === copiedOwnerNodeId);
assert.equal(copiedColor.target.key, copiedBase.ref.key);
assert.equal(copiedColor.value.swatchId, swatchId);
assert.equal(copiedThickness.target.key, copiedBase.ref.key);
assert.equal(copiedThickness.value.thickness.value, 2.5);
const copiedResultDefinition = Object.values(
  copied.document.regionDefinitions,
).find(
  (definition) =>
    definition.context.ownerNodeId === copiedOwnerNodeId &&
    definition.selector.kind === 'result',
);
assert.equal(
  copiedResultDefinition.selector.parent.ownerNodeId,
  copiedOwnerNodeId,
);
assert.equal(copiedResultDefinition.selector.parent.key, copiedBase.ref.key);

const basisCopySource = structuredClone(original);
const basisPath = basisCopySource.sketches[sketch.id].paths[path.id];
basisPath.basisCatalog = { 'bridge-basis': {} };
basisPath.edges = basisPath.edges.map((use) => ({
  ...use,
  basisId: 'bridge-basis',
}));
cellUses(basisCopySource.regionDefinitions[baseRef.key].selector).forEach(
  (use) => {
    use.pathId = 'bridge-basis';
  },
);
const basisCopied = createAdvancedCommand({
  kind: 'copy-nodes',
  nodeIds: [ownerNodeId],
})(basisCopySource, { idFactory });
const basisOwnerNodeId = basisCopied.selectionIntent.activeRef.id;
const basisDefinition = Object.values(
  basisCopied.document.regionDefinitions,
).find((definition) => definition.context.ownerNodeId === basisOwnerNodeId);
const basisSketch = Object.values(basisCopied.document.sketches).find(
  (item) => item.ownerNodeId === basisOwnerNodeId,
);
const basisCopiedPath = Object.values(basisSketch.paths)[0];
const basisUse = cellUses(basisDefinition.selector)[0];
assert.equal(basisUse.sketchId, basisSketch.id);
assert.equal(basisUse.pathId, basisCopiedPath.edges[0].basisId);
assert.notEqual(basisUse.pathId, 'bridge-basis');
assert.deepEqual(Object.keys(basisCopiedPath.basisCatalog), [basisUse.pathId]);

const transferredSource = structuredClone(original);
delete transferredSource.appearances.overrides[
  Object.keys(transferredSource.appearances.overrides)[0]
];
delete transferredSource.reliefDefinitions.overrides[
  Object.keys(transferredSource.reliefDefinitions.overrides)[0]
];
transferredSource.sketches.target = {
  id: 'target',
  ownerNodeId,
  vertices: {},
  edges: {},
  paths: {},
};
const transferred = createSourceTransferCommand({
  kind: 'transfer-source',
  sourceSketchId: sketch.id,
  targetSketchId: 'target',
  pathIds: [path.id],
  keepWorld: true,
})(transferredSource, { idFactory });
const transferredDefinition =
  transferred.document.regionDefinitions[baseRef.key];
assert.equal(transferredDefinition.context.ownerNodeId, ownerNodeId);
assert.equal(
  transferredDefinition.context.operatorId,
  baseDefinition.context.operatorId,
);
assert(
  cellUses(transferredDefinition.selector).every(
    (use) => use.sketchId === 'target' && use.pathId === path.id,
  ),
);
assert(
  regionStage(transferred.document, ownerNodeId).some(
    (region) => region.ref.key === baseRef.key,
  ),
  'typed source rewrite keeps the persisted definition resolvable after transfer',
);

console.log(
  'PASS V5 copy remaps definitions and bases; source transfer rewrites typed source uses',
);
