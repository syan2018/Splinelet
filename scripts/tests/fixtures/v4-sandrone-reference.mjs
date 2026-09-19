// Isolated actual-sample fixture. Only its private origin's OPFS is written.
import React, { useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { SplineNodeInspector } from '../../../src/components/source-editor/spline-inspector.tsx';
import { createV4NodeActions } from '../../../src/lib/source-editor/node-actions.mjs';
import { openProject } from '../../../src/lib/persistence/open-project.mjs';
import { createStudioHost } from '../../../src/lib/editor/studio-host.mjs';
import { createStudioFileWriter } from '../../../src/lib/platform/studio-file-writer.mjs';
import { sameDocument } from '../../../src/lib/editing/history.mjs';

const h = React.createElement;
const originalBytes = new Uint8Array(
  await (await fetch('/public/sandrone-example.spl')).arrayBuffer(),
);
const opened = openProject({ bytes: originalBytes });
const baseline = structuredClone(opened.document);
const created = [],
  revoked = [];
const presentation = { fileName: 'sandrone.spl', newReliefDepthMM: 2 };
const host = createStudioHost({
  opened,
  presentation,
  urls: {
    createObjectURL(blob) {
      const url = URL.createObjectURL(blob);
      created.push(url);
      return url;
    },
    revokeObjectURL(url) {
      revoked.push(url);
      URL.revokeObjectURL(url);
    },
  },
  persistence: { writeFile: createStudioFileWriter() },
});
const directory = await navigator.storage.getDirectory();
const handle = await directory.getFileHandle('sandrone-reference-test.spl', {
  create: true,
});
const target = { kind: 'web', handle };
let savedSize = 0;

function Fixture() {
  const snapshot = useSyncExternalStore(host.subscribe, host.getSnapshot);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const path = snapshot.project.paths.find(
    (path) => path.visible && !path.locked && path.curves.length >= 2,
  );
  const actions = createV4NodeActions({
    runtime: snapshot.runtime,
    project: snapshot.project,
    onCommit: () => {},
  });
  const run = async (action) => {
    setBusy(true);
    try {
      await action();
      setError('');
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
    }
  };
  const evidence = {
    paths: snapshot.project.paths.length,
    dirty: snapshot.storage.dirty,
    targetKind: snapshot.storage.target?.kind ?? null,
    restored: sameDocument(snapshot.editorState.document, baseline),
    image: snapshot.project.image,
    imageName: snapshot.project.imageName,
    width: snapshot.project.width,
    height: snapshot.project.height,
    revision: snapshot.editorState.revision,
    mode: path.nodeModes[1],
    created: created.length,
    revoked: [...revoked],
    savedSize,
  };
  return h(
    'main',
    { style: { padding: 20, width: 540 } },
    h('h2', null, '内置 Sandrone · 原节点面板与参考图'),
    h('img', {
      id: 'reference-image',
      src: snapshot.project.image,
      alt: snapshot.project.imageName,
      width: 360,
    }),
    h(SplineNodeInspector, {
      path,
      nodes: [1],
      selection: null,
      disabled: busy,
      merging: false,
      canMerge: false,
      onMode: (mode) => run(() => actions.setModes(path.id, [1], mode)),
      onStraighten: (index) => run(() => actions.straighten(path.id, index)),
      onDelete: () => run(() => actions.deleteNodes(path.id, [1], 1.5)),
      onResume: () => {},
      onMerge: () => {},
      onCancelMerge: () => {},
      onClear: () => {},
    }),
    h(
      'button',
      { disabled: busy, onClick: () => run(() => host.undo()) },
      '撤销测试编辑',
    ),
    h(
      'button',
      {
        disabled: busy,
        onClick: () =>
          run(async () => {
            await host.save(target);
            const file = await handle.getFile();
            savedSize = file.size;
            host.openBytes(
              { bytes: new Uint8Array(await file.arrayBuffer()), target },
              presentation,
            );
          }),
      },
      '保存并重开测试副本',
    ),
    h(
      'pre',
      {
        id: 'reference-evidence',
        'data-ready': !busy,
        style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
      },
      JSON.stringify(evidence),
    ),
    h('p', { id: 'reference-error' }, error),
  );
}
createRoot(document.getElementById('root')).render(h(Fixture));
