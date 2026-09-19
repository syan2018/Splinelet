// Full original Studio shell; only this ephemeral origin's OPFS is written.
import React from 'react';
import { createRoot } from 'react-dom/client';
import StudioApp from '../../../src/components/studio/studio-app.tsx';
import { openProject } from '../../../src/lib/persistence/open-project.mjs';
import { createStudioHost } from '../../../src/lib/editor/studio-host.mjs';
import { createStudioFileWriter } from '../../../src/lib/platform/studio-file-writer.mjs';
import { sameDocument } from '../../../src/lib/editing/history.mjs';

const opened = openProject({
  bytes: new Uint8Array(
    await (await fetch('/sandrone-example.spl')).arrayBuffer(),
  ),
});
const baseline = structuredClone(opened.document);
let draft = null;
const host = createStudioHost({
  opened,
  presentation: {
    fileName: 'sandrone-original-studio.spl',
    newReliefDepthMM: 2,
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
// Read-only instrumentation: all edits below must originate in original UI.
window.originalStudioEvidence = () => {
  const { editorState, project, storage } = host.getSnapshot();
  return {
    revision: editorState.revision,
    previewId: editorState.previewId,
    paths: project.paths.length,
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
  const saved = openProject({
    bytes: new Uint8Array(await (await handle.getFile()).arrayBuffer()),
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
