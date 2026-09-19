import React, { useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createStudioSession } from '../../../src/lib/editor/studio-session.mjs';
import {
  SourcePathLayers,
  SourceNodeHandles,
} from '../../../src/components/source-editor/source-canvas-layers.tsx';
import { useSourceDrag } from '../../../src/hooks/use-source-drag.ts';

let serial = 0;
const idFactory = () => `snap-dom-${++serial}`;
const editor = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
for (const points of [
  [
    [-10, 0],
    [0, 0],
  ],
  [
    [5, 4],
    [9, 7],
  ],
])
  editor.dispatch(
    createAuthoringCommand({ kind: 'draw-path', points, closed: false }),
    { expectedRevision: editor.state.revision },
  );
const session = createStudioSession({
  opened: { kind: 'v4', document: editor.state.document, assets: {} },
  presentation: {
    reference: null,
    frame: { width: 200, height: 200, widthMM: 100 },
    newReliefDepthMM: 2,
    fileName: null,
  },
  persistence: { writeFile: async () => {} },
});
const h = React.createElement;
function Fixture() {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const canvas = useRef(null);
  const [nodes, setNodes] = useState([1]);
  const [selection, setSelection] = useState({ curve: 0, point: 3 });
  const [feedback, setFeedback] = useState(null);
  const [error, setError] = useState('');
  const path = snapshot.project.paths[0];
  const drag = useSourceDrag({
    runtime: snapshot.runtime,
    project: snapshot.project,
    pathId: path.id,
    nodes,
    snapEnabled: true,
    scale: 1,
    onSnapFeedback: setFeedback,
    getCaptureTarget: () => canvas.current,
    toPoint: (event) => {
      const box = canvas.current.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    },
    onSelectionChange: (nodes, selection) => {
      setNodes(nodes);
      setSelection(selection);
    },
    onError: (error) => setError(error.message),
  });
  return h(
    'main',
    { style: { padding: 20 } },
    h(
      'div',
      { style: { width: 200, height: 200, position: 'relative' } },
      React.createElement(
        'svg',
        {
          ref: (element) => {
            canvas.current = element;
          },
          className: 'drawing-canvas',
          width: 200,
          height: 200,
          tabIndex: 0,
          onPointerMove: (event) => drag.onPointerMove(event),
          onPointerUp: (event) => drag.onPointerUp(event),
          onPointerCancel: (event) => drag.onPointerCancel(event),
          onLostPointerCapture: (event) => drag.onLostPointerCapture(event),
          onKeyDown: (event) => drag.onKeyDown(event),
        },
        h(SourcePathLayers, {
          paths: snapshot.project.paths,
          scale: 1,
          tool: 'edit',
          selectedPaths: [path.id],
          highlightSourceSelection: true,
          fill: false,
          onSelectPath: () => {},
          onEditPath: () => {},
          onSplitAt: () => {},
        }),
        h(SourceNodeHandles, {
          path,
          scale: 1,
          selectedNodes: nodes,
          selection,
          onPointPointerDown: (event, curve, point) =>
            drag.onPointPointerDown(event, curve, point),
        }),
      ),
    ),
    h('button', { onClick: () => session.undo() }, '撤销吸附测试'),
    h(
      'pre',
      { id: 'snap-evidence' },
      JSON.stringify({
        point: path.anchors[1],
        feedback,
        revision: snapshot.editorState.revision,
        previewId: snapshot.editorState.previewId,
      }),
    ),
    h('p', { id: 'snap-error' }, error),
  );
}
createRoot(document.getElementById('root')).render(h(Fixture));
