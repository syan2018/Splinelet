// Isolated component fixture. No application storage or user files are read.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import CreationModifiers from '../../../src/components/creation/creation-modifiers.tsx';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createV4CreationRuntime } from '../../../src/lib/editor/creation-runtime.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';

const h = React.createElement;
let serial = 0;
const idFactory = () => `modifier-ui-${++serial}`;
const editor = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
const dispatch = (command) =>
  editor.dispatch(command, { expectedRevision: editor.state.revision });
dispatch(
  createAuthoringCommand({
    kind: 'draw-path',
    points: [
      [0, 0],
      [4, 3],
    ],
    closed: false,
  }),
);
const owner = Object.values(editor.state.document.nodes)[0];
dispatch(
  createAuthoringCommand({
    kind: 'mirror-curves',
    ownerNodeId: owner.id,
    center: [2, 3],
    angleRad: Math.PI / 4,
  }),
);
const mirror = Object.values(
  editor.state.document.programs[owner.programId].operators,
).find((op) => op.type === 'curve-mirror');
dispatch((document) => {
  document.nodes[owner.id].pose = {
    translationMM: [20, 30],
    rotationRad: Math.PI / 2,
  };
  return { document };
});
const baseline = structuredClone(editor.state.document);
const runtime = createV4CreationRuntime({
  editorSession: editor,
  toDisplayProject: (_state, view) => ({
    version: 4,
    paths: [],
    creation: view.creation,
  }),
});
const read = async () => {
  const project = runtime.project();
  return { project, scene: await runtime.evaluate('creation', {}, project) };
};
const initial = await read();

function Fixture() {
  const [display, setDisplay] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (action) => {
    setBusy(true);
    try {
      action();
      setDisplay(await read());
      setError('');
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };
  const document = editor.state.document;
  const evidence = {
    operators: Object.values(document.programs[owner.programId].operators).map(
      ({ id, type, inputs, params }) => ({ id, type, inputs, params }),
    ),
    curveCount:
      evaluateProgram(document, owner.id).curves.value?.curves.length ?? 0,
    revision: editor.state.revision,
    rawUnchanged:
      JSON.stringify(document.sketches) === JSON.stringify(baseline.sketches),
    baselineRestored: JSON.stringify(document) === JSON.stringify(baseline),
    angleRad:
      document.programs[owner.programId].operators[mirror.id].params.angleRad,
    enabled: document.programs[owner.programId].operators[mirror.id].enabled,
    center:
      document.programs[owner.programId].operators[mirror.id].params.center,
  };
  return h(
    'main',
    { style: { width: 380, padding: 20 } },
    h(
      'nav',
      null,
      h(
        'button',
        {
          disabled: busy,
          onClick: () =>
            run(() => editor.undo({ expectedRevision: editor.state.revision })),
        },
        '测试撤销',
      ),
      h(
        'button',
        {
          disabled: busy,
          onClick: () =>
            run(() =>
              dispatch((doc) => {
                doc.parameters.angle = {
                  id: 'angle',
                  name: '角度',
                  ownerNodeId: owner.id,
                  unit: 'rad',
                  value: Math.PI / 3,
                };
                doc.programs[owner.programId].operators[
                  mirror.id
                ].params.angleRad = { kind: 'parameter', id: 'angle' };
                return { document: doc };
              }),
            ),
        },
        '测试参数驱动',
      ),
      h(
        'button',
        {
          disabled: busy,
          onClick: () =>
            run(() =>
              dispatch((doc) => {
                delete doc.parameters.angle;
                return { document: doc };
              }),
            ),
        },
        '测试缺失参数',
      ),
      h(
        'button',
        {
          disabled: busy,
          onClick: () =>
            run(() =>
              dispatch(
                createAuthoringCommand({
                  kind: 'set-node',
                  nodeId: owner.id,
                  value: { locked: true },
                }),
              ),
            ),
        },
        '测试锁定',
      ),
    ),
    h(CreationModifiers, {
      object: display.scene.creation.objects.find(
        (object) => object.id === owner.id,
      ),
      project: display.project,
      scene: display.scene,
      cellKeys: [],
      busy,
      onCommand: (action, args) =>
        run(() => runtime.command(action, args, display).commit()),
    }),
    h('pre', { id: 'evidence', 'data-ready': !busy }, JSON.stringify(evidence)),
    h('p', { id: 'fixture-error', role: 'status' }, error),
  );
}

createRoot(document.getElementById('root')).render(h(Fixture));
