// Isolated native V5 sample entry. By default it opens the compatibility
// sample from public; set VITE_SPLINELET_BROWSER_SAMPLE_URL to a repository-
// local URL (for example /outputs/.../copy.spl) to exercise another copy.
import React from 'react';
import { createRoot } from 'react-dom/client';
import StudioApp from '../../../src/components/studio/studio-app.tsx';
import { openProject } from '../../../src/lib/persistence/open-project.mjs';
import { createBrowserStudioHost } from '../../../src/lib/editor/browser-studio-host.ts';
const sampleUrl =
  import.meta.env.VITE_SPLINELET_BROWSER_SAMPLE_URL || '/sandrone-example.spl';
const bytes = new Uint8Array(await (await fetch(sampleUrl)).arrayBuffer());
const opened = openProject({ bytes, target: null });
if (opened.kind !== 'v5') throw Error('walkthrough sample must be native V5');

let savedBytes = null;
const presentation = {
  fileName: 'isolated-sandrone-walkthrough.spl',
  blenderExtrusionMM: 2,
};
const host = createBrowserStudioHost({
  opened,
  presentation,
  persistence: {
    writeFile: async (_target, nextBytes) => {
      savedBytes = new Uint8Array(nextBytes);
    },
  },
});

function evidence() {
  const { editorState, project, storage } = host.getSnapshot();
  const sourcePath = project.paths.find(
    (path) =>
      path.name === 'signature · 笔画' &&
      path.visible &&
      !path.closed &&
      path.anchors.length > 3,
  );
  const hairPath = project.paths.find((path) =>
    path.id.endsWith('path:43c8857140e76e8b732d'),
  );
  return {
    version: editorState.document.version,
    dirty: storage.dirty,
    revision: editorState.revision,
    sourcePath: sourcePath && { id: sourcePath.id, name: sourcePath.name },
    hairPath: hairPath && {
      id: hairPath.id,
      name: hairPath.name,
      anchors: hairPath.anchors.length,
    },
    declaredRegions: Object.keys(editorState.document.regionDefinitions).length,
    objects: project.creation.objects.length,
  };
}

window.v5SandroneEvidence = evidence;
window.v5SandroneDocument = () =>
  structuredClone(host.getSnapshot().editorState.document);
window.v5SandroneCreation = async () => {
  const { project, runtime } = host.getSnapshot();
  const view = await runtime.evaluate('creation', {}, project);
  const nonOpenPathErrors = view.errors.filter(
    (item) => item.kind !== 'open-path',
  );
  const diagnostics = view.diagnostics || [];
  const severityErrors = diagnostics.filter(
    (item) => item.severity === 'error',
  );
  const blockedObjects = (view.creation?.objects || [])
    .filter((object) => object.evaluation?.state === 'blocked')
    .map((object) => ({ id: object.id, name: object.name }));
  return {
    cells: view.cells.length,
    errorCount: view.errors.length,
    nonOpenPathErrors,
    severityErrors,
    blockedObjects,
    diagnostics,
  };
};
window.v5SandroneSaveAndReopen = async () => {
  await host.save('isolated-reopen.spl');
  if (!savedBytes) throw Error('isolated save did not produce bytes');
  host.open(openProject({ bytes: savedBytes, target: null }), presentation);
  return evidence();
};

createRoot(document.getElementById('root')).render(
  React.createElement(StudioApp, { host }),
);
