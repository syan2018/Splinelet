// Isolated component fixture. No application storage or user files are read.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import CreationModifiers from '../../../src/components/creation/creation-modifiers.tsx';
import { SplineNodeInspector } from '../../../src/components/source-editor/spline-inspector.tsx';
import { createV4NodeActions } from '../../../src/lib/source-editor/node-actions.mjs';
import {
  useCurvePreview,
  CurvePreviewOverlay,
} from '../../../src/components/creation/creation-curve-preview.tsx';
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
  sourceFrame: { width: 100, height: 100, widthMM: 100 },
  toDisplayProject: (_state, view) => ({
    version: 4,
    width: 100,
    height: 100,
    widthMM: 100,
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
  const previewProject = runtime.project();
  const preview = useCurvePreview(previewProject, owner.id, runtime);
  const [display, setDisplay] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sourceBaseline, setSourceBaseline] = useState(null);
  const [selectedNodes, setSelectedNodes] = useState([1]);
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
  const sourcePath = sourceBaseline
    ? runtime.readSourceView(previewProject).source.paths[0]
    : null;
  const nodeActions = sourceBaseline
    ? createV4NodeActions({
        runtime,
        project: previewProject,
        onCommit: (project) => setDisplay({ project, scene: display.scene }),
      })
    : null;
  const evidence = {
    source: sourcePath && {
      curves: sourcePath.curves,
      modes: sourcePath.nodeModes,
      anchors: sourcePath.anchors,
    },
    sourceBaselineRestored:
      sourceBaseline !== null &&
      JSON.stringify(document) === JSON.stringify(sourceBaseline),
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
            run(() => {
              editor.replaceDocument(structuredClone(baseline), {
                expectedRevision: editor.state.revision,
              });
              let project = runtime.project();
              let path = runtime.readSourceView(project).source.paths[0];
              project = runtime
                .commandSource(
                  {
                    kind: 'split-span',
                    pathId: path.id,
                    identityId: path.identity.edgeIds[0],
                    t: 0.5,
                  },
                  { project },
                )
                .commit();
              path = runtime.readSourceView(project).source.paths[0];
              project = runtime
                .commandSource(
                  {
                    kind: 'set-handle-mode',
                    pathId: path.id,
                    identityId: path.identity.anchorIds[1],
                    mode: 'corner',
                  },
                  { project },
                )
                .commit();
              path = runtime.readSourceView(project).source.paths[0];
              const handle = path.curves[0][2];
              runtime
                .commandSource(
                  {
                    kind: 'move-handle',
                    pathId: path.id,
                    identityId: path.identity.handleIds[0][1],
                    pixelPoint: { x: handle.x + 5, y: handle.y + 4 },
                  },
                  { project },
                )
                .commit();
              setSourceBaseline(structuredClone(editor.state.document));
              setSelectedNodes([1]);
            }),
        },
        '测试节点基线',
      ),
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
    sourcePath &&
      h(SplineNodeInspector, {
        path: sourcePath,
        nodes: selectedNodes,
        selection: null,
        disabled: busy || sourcePath.locked,
        merging: false,
        canMerge: false,
        onResume: () => {},
        onMode: (mode) =>
          run(() => nodeActions.setModes(sourcePath.id, selectedNodes, mode)),
        onStraighten: (curve) =>
          run(() => nodeActions.straighten(sourcePath.id, curve)),
        onDelete: () =>
          run(() => {
            nodeActions.deleteNodes(sourcePath.id, selectedNodes, 1.5);
            setSelectedNodes([]);
          }),
        onClear: () => setSelectedNodes([]),
        onMerge: () => {},
        onCancelMerge: () => {},
      }),
    h(
      'section',
      { style: { position: 'relative' } },
      preview.controls,
      h(
        'svg',
        {
          viewBox: '0 0 100 100',
          width: 340,
          height: 240,
          'aria-label': '测试派生曲线画布',
        },
        h(CurvePreviewOverlay, {
          previews: preview.previews,
          project: previewProject,
          scale: 1,
        }),
      ),
    ),
    h(
      'pre',
      {
        id: 'evidence',
        'data-ready': !busy,
        style: {
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          maxHeight: 160,
          overflow: 'auto',
        },
      },
      JSON.stringify(evidence),
    ),
    h('p', { id: 'fixture-error', role: 'status' }, error),
  );
}

createRoot(document.getElementById('root')).render(h(Fixture));
