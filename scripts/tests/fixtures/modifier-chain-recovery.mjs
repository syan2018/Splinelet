// Isolated V5 Studio fixture for the modifier-input recovery UI. It never
// opens, saves, or mutates a user project.
import React from 'react';
import { createRoot } from 'react-dom/client';
import StudioApp from '../../../src/components/studio/studio-app.tsx';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { compileModifierAdd } from '../../../src/lib/editor/modifier-intents.mjs';
import { createBrowserStudioHost } from '../../../src/lib/editor/browser-studio-host.ts';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';

let serial = 0;
const idFactory = () => `modifier-recovery-${++serial}`;
const modelDocument = createDocument({ version: 5, idFactory });
modelDocument.sourceFrame = { width: 800, height: 600, widthMM: 100 };
const editor = createEditorSession(modelDocument, { idFactory });
const dispatch = (command) =>
  editor.dispatch(command, { expectedRevision: editor.state.revision });

for (const x of [8, 52])
  dispatch(
    createAuthoringCommand({
      kind: 'draw-path',
      closed: true,
      points: [
        [x, 12],
        [x + 24, 12],
        [x + 24, 36],
        [x, 36],
      ],
    }),
  );

const [owner, independent] = Object.values(editor.state.document.nodes);
const ownerRegions = () => {
  const stage = evaluateProgram(editor.state.document, owner.id).regions;
  if (stage.status !== 'ready') throw Error('fixture owner Fill has no region');
  return stage.value.regions;
};
dispatch(
  createAuthoringCommand(
    compileModifierAdd(editor.state.document, {
      objectId: owner.id,
      type: 'curve_mirror',
      targets: { kind: 'all' },
      centerMM: { x: 0, y: 0 },
      angleDeg: 90,
    }),
  ),
);
dispatch(
  createAuthoringCommand({
    kind: 'create-swatch',
    name: 'selection recovery',
    color: '#d12b2b',
  }),
);
dispatch(
  createAuthoringCommand({
    kind: 'paint-region',
    target: ownerRegions()[0].ref,
    swatchId: Object.keys(editor.state.document.appearances.swatches)[0],
  }),
);

const program = editor.state.document.programs[owner.programId];
const mirror = Object.values(program.operators).find(
  (operator) => operator.type === 'curve-mirror',
);
if (!mirror) throw Error('fixture failed to create curve-mirror');
const originalInput = structuredClone(mirror.inputs.input[0]);
const fillId = program.outputs.regions.operatorId;
const selectionDefinitionId = ownerRegions()[0].ref.key;

const host = createBrowserStudioHost({
  opened: {
    kind: 'v5',
    document: editor.state.document,
    assets: {},
    target: null,
  },
  presentation: {
    fileName: 'isolated-modifier-chain-recovery.spl',
    frame: { width: 800, height: 600, widthMM: 100 },
    blenderExtrusionMM: 2,
  },
  persistence: { writeFile: async () => {} },
  idFactory,
});

const ownerPathId = () =>
  host.getSnapshot().project.paths.find((path) => path.ownerNodeId === owner.id)
    ?.id || null;
const currentMirror = () => {
  const current = host.getSnapshot().editorState.document;
  return current.programs[owner.programId].operators[mirror.id];
};
const cloneDocument = () =>
  structuredClone(host.getSnapshot().editorState.document);
const snapshotEvidence = () => {
  const { editorState, project, runtime, storage } = host.getSnapshot();
  const snapshot = runtime.readModifierSnapshot(project, mirror.id, 'curves');
  const inputs = runtime.readModifierInputs(project, owner.id, mirror.id);
  const selections = runtime.readRegionSelections(project, owner.id, fillId);
  const status = runtime
    .readModifierStatus(project)
    .find((item) => item.modifierId === mirror.id);
  return {
    revision: editorState.revision,
    epoch: editorState.epoch,
    dirty: storage.dirty,
    ownerId: owner.id,
    ownerProgramId: owner.programId,
    ownerPathId: ownerPathId(),
    independentId: independent.id,
    mirrorId: mirror.id,
    fillId,
    selectionDefinitionId,
    originalInput: structuredClone(originalInput),
    input: structuredClone(currentMirror().inputs.input[0]),
    angleDeg: status?.controls?.values?.angleDeg,
    status: snapshot?.current?.status || null,
    freshness: snapshot?.freshness || null,
    lastSuccessfulRevision: snapshot?.lastSuccessful?.revision ?? null,
    inputView: structuredClone(inputs),
    selectionView: structuredClone(selections),
  };
};

window.modifierChainRecovery = Object.freeze({
  evidence: snapshotEvidence,
  document: cloneDocument,
  async evaluate() {
    const { project, runtime } = host.getSnapshot();
    await runtime.evaluate('creation', {}, project);
    return snapshotEvidence();
  },
  breakInput() {
    host.dispatch((next) => {
      next.programs[owner.programId].operators[
        mirror.id
      ].inputs.input[0].operatorId = 'removed-producer';
      return { document: next };
    });
    return snapshotEvidence();
  },
  breakSelection() {
    host.dispatch((next) => {
      const definition = next.regionDefinitions[selectionDefinitionId];
      if (!definition?.selector?.outer?.[0]?.sources?.[0]?.use)
        throw Error('fixture selection definition is not a cell boundary');
      definition.selector.outer[0].sources[0].use.pathId = 'missing-path';
      return { document: next };
    });
    return snapshotEvidence();
  },
  undo() {
    host.undo();
    return snapshotEvidence();
  },
});

createRoot(document.getElementById('root')).render(
  React.createElement(StudioApp, { host }),
);
