// Isolated native V5 document. It does not read the public compatibility sample.
import React from 'react';
import { createRoot } from 'react-dom/client';
import StudioApp from '../../../src/components/studio/studio-app.tsx';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createBrowserStudioHost } from '../../../src/lib/editor/browser-studio-host.ts';
import { sameDocument } from '../../../src/lib/editing/history.mjs';

let serial = 0;
const idFactory = () => `browser-v5-${++serial}`;
const modelDocument = createDocument({ version: 5, idFactory });
modelDocument.sourceFrame = { width: 800, height: 600, widthMM: 100 };
const editor = createEditorSession(modelDocument, { idFactory });
editor.dispatch(
  createAuthoringCommand({
    kind: 'draw-path',
    closed: false,
    points: [
      [5, 8],
      [55, 16],
      [82, 52],
    ],
  }),
  { expectedRevision: editor.state.revision },
);
const host = createBrowserStudioHost({
  opened: {
    kind: 'v5',
    document: editor.state.document,
    assets: {},
    target: null,
  },
  presentation: {
    fileName: 'isolated-native-v5.spl',
    frame: { width: 800, height: 600, widthMM: 100 },
    blenderExtrusionMM: 2,
  },
  persistence: { writeFile: async () => {} },
  idFactory,
});
const baseline = structuredClone(host.getSnapshot().editorState.document);
window.v5StudioEvidence = () => {
  const { editorState, project, storage } = host.getSnapshot();
  return {
    version: editorState.document.version,
    units: editorState.document.units,
    projectVersion: project.version,
    revision: editorState.revision,
    previewId: editorState.previewId,
    dirty: storage.dirty,
    sourceUnchanged: sameDocument(
      editorState.document.sketches,
      baseline.sketches,
    ),
  };
};
window.v5StudioDocument = () =>
  structuredClone(host.getSnapshot().editorState.document);
createRoot(document.getElementById('root')).render(
  React.createElement(StudioApp, { host }),
);
