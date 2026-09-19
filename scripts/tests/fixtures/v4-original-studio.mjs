// Full original Studio shell; only this ephemeral origin's OPFS is written.
import React from 'react';
import { createRoot } from 'react-dom/client';
import StudioApp from '../../../src/components/studio/studio-app.tsx';
import { openProject } from '../../../src/lib/persistence/open-project.mjs';
import { createBrowserStudioHost } from '../../../src/lib/editor/browser-studio-host.ts';
import { createStudioFileWriter } from '../../../src/lib/platform/studio-file-writer.mjs';
import { sameDocument } from '../../../src/lib/editing/history.mjs';

const originalBytes = new Uint8Array(
  await (await fetch('/sandrone-example.spl')).arrayBuffer(),
);
const opened = openProject({ bytes: originalBytes });
const baseline = structuredClone(opened.document);
let draft = null;
const host = createBrowserStudioHost({
  opened,
  presentation: {
    fileName: 'sandrone-original-studio.spl',
    blenderExtrusionMM: 2,
  },
  persistence: {
    writeFile: createStudioFileWriter(),
    drafts: {
      write: (_key, value) => {
        draft = structuredClone(value);
      },
      read: () => structuredClone(draft),
    },
  },
});
const directory = await navigator.storage.getDirectory();
const handle = await directory.getFileHandle('sandrone-original-studio.spl', {
  create: true,
});
await host.save({ kind: 'web', handle });
const pickerFiles = { saved: handle };
for (const [key, bytes] of Object.entries({
  legacy: originalBytes,
  invalid: new Uint8Array([1, 2, 3]),
})) {
  const file = await directory.getFileHandle(`${key}.spl`, { create: true });
  const writer = await file.createWritable();
  await writer.write(bytes);
  await writer.close();
  pickerFiles[key] = file;
}
let pickerChoice = 'saved';
window.originalStudioChooseFile = (name) => {
  pickerChoice = name;
};
window.showOpenFilePicker = async () => [
  pickerChoice === 'current'
    ? host.getSnapshot().storage.target.handle
    : pickerFiles[pickerChoice],
];
window.showSaveFilePicker = async () =>
  directory.getFileHandle('new-image-project.spl', { create: true });
// Read-only instrumentation: all edits below must originate in original UI.
window.originalStudioDocument = () =>
  structuredClone(host.getSnapshot().editorState.document);
window.originalStudioEvidence = () => {
  const { editorState, project, storage } = host.getSnapshot();
  return {
    epoch: editorState.epoch,
    canUndo: editorState.canUndo,
    targetKind: storage.target?.kind ?? null,
    revision: editorState.revision,
    previewId: editorState.previewId,
    paths: project.paths.length,
    pendingRegionDrawings: Object.values(editorState.document.programs)
      .flatMap((program) => Object.values(program.operators))
      .filter((operator) => operator.authoring?.phase === 'drawing').length,
    pathGeometry: project.paths.map((path) => ({
      id: path.id,
      closed: path.closed,
      segments: path.curves.length,
    })),
    objects: project.creation.objects.length,
    dirty: storage.dirty,
    baselineRestored: sameDocument(editorState.document, baseline),
    sourceUnchanged: sameDocument(
      editorState.document.sketches,
      baseline.sketches,
    ),
    programsUnchanged: sameDocument(
      editorState.document.programs,
      baseline.programs,
    ),
    nodePosesUnchanged: sameDocument(
      editorState.document.nodes,
      baseline.nodes,
    ),
  };
};
window.originalStudioSavedEvidence = async () => {
  const currentHandle = host.getSnapshot().storage.target?.handle ?? handle;
  const saved = openProject({
    bytes: new Uint8Array(await (await currentHandle.getFile()).arrayBuffer()),
  });
  return {
    kind: saved.kind,
    matchesCurrent: sameDocument(
      saved.document,
      host.getSnapshot().editorState.document,
    ),
  };
};
createRoot(document.getElementById('root')).render(
  React.createElement(StudioApp, { host }),
);
