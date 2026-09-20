// Fresh test origin only. Exercises the original Studio and its real worker.
import React from 'react';
import { createRoot } from 'react-dom/client';
import StudioApp from '../../../src/components/studio/studio-app.tsx';
import { createBrowserStudioHost } from '../../../src/lib/editor/browser-studio-host.ts';
import { repeatedRingDocument } from './v4-programs.mjs';

const document = repeatedRingDocument();
document.appearances.swatches.gold = {
  id: 'gold',
  name: '金色',
  color: '#cfad68',
};
document.appearances.defaults.shape = { swatchId: 'gold' };
document.reliefDefinitions.defaults.shape = {
  enabled: true,
  thickness: { kind: 'mm', value: 2 },
  mode: 'add',
  placement: { kind: 'free', zMM: 0 },
};
const host = createBrowserStudioHost({
  opened: { kind: 'v4', document, assets: {}, target: null },
  presentation: {
    fileName: 'final-preview.spl',
    frame: { width: 400, height: 400, widthMM: 40 },
    blenderExtrusionMM: 2,
  },
  persistence: { writeFile: async () => {} },
});
// Read-only instrumentation; interaction goes through original GUI/API intents.
window.previewDocument = () => host.getSnapshot().editorState.document;
createRoot(window.document.getElementById('root')).render(
  React.createElement(StudioApp, { host }),
);
