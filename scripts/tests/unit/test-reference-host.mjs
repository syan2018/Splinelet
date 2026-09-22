import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decodeDocument } from '../../../src/lib/document/codec.mjs';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createReferenceCommand } from '../../../src/lib/editing/commands/references.mjs';
import { createStudioHost } from '../../../src/lib/editor/studio-host.mjs';
import { sha256 } from '../../../src/lib/project-container.mjs';

const png = new Uint8Array(
  await readFile(new URL('../../../public/reference.png', import.meta.url)),
);
const tinyPng = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9JcywAAAAASUVORK5CYII=',
    'base64',
  ),
);
const frame = { width: 4, height: 2, widthMM: 2 };
const presentation = (fileName = 'references.spl') => ({
  fileName,
  blenderExtrusionMM: 2,
});
const fakeUrls = () => {
  const blobs = new Map();
  let serial = 0;
  return {
    blobs,
    createObjectURL(blob) {
      const url = `blob:reference-host-${++serial}`;
      blobs.set(url, blob);
      return url;
    },
    revokeObjectURL(url) {
      blobs.delete(url);
    },
  };
};
const opened = () => {
  const document = createDocument();
  document.sourceFrame = { ...frame };
  document.assets['base-asset'] = {
    id: 'base-asset',
    path: 'assets/base.png',
    mediaType: 'image/png',
    size: png.length,
    sha256: sha256(png),
  };
  document.references.base = {
    id: 'base',
    assetId: 'base-asset',
    name: 'base.png',
    pixelWidth: frame.width,
    pixelHeight: frame.height,
    pixelToWorld: [0.5, 0, 0, -0.5, -1, 0.5],
    visible: true,
    locked: true,
    opacity: 1,
    role: 'base',
    order: 0,
  };
  return {
    kind: 'v4',
    document,
    assets: { 'base-asset': png.slice() },
    target: 'references.spl',
  };
};
const identity = (host) => {
  const { epoch, revision } = host.getSnapshot().editorState;
  return { epoch, revision };
};
const image = (name) => ({
  bytes: tinyPng.slice(),
  mediaType: 'image/png',
  name,
  width: 4,
  height: 2,
});
const overlayIds = (host) =>
  host
    .getSnapshot()
    .presentation.references.filter((reference) => reference.role === 'overlay')
    .map((reference) => reference.id);

const writes = [];
let draft = null;
const urls = fakeUrls();
const host = createStudioHost({
  opened: opened(),
  presentation: presentation(),
  urls,
  persistence: {
    writeFile: async (target, bytes) => writes.push({ target, bytes }),
    drafts: {
      write: async (_key, value) => {
        draft = structuredClone(value);
      },
      read: async () => null,
    },
  },
});
const baseUrl = host.getSnapshot().project.image;
host.addReferenceImages(
  [image('detail.png'), image('colour.png')],
  identity(host),
);
let snapshot = host.getSnapshot();
const [detail, colour] = overlayIds(host);
assert.equal(snapshot.presentation.references.length, 3);
assert.equal(
  snapshot.project.image,
  baseUrl,
  'base image remains the source image',
);
assert.deepEqual(snapshot.presentation.frame, frame);
assert.equal(snapshot.storage.target, 'references.spl');
assert(snapshot.presentation.references.every((reference) => reference.url));
assert.equal(
  Object.keys(snapshot.storage.assets).length,
  2,
  'identical imported image bytes share one descriptor',
);

host.dispatch(
  createReferenceCommand({
    kind: 'reference-update',
    id: detail,
    patch: { pixelToWorld: [0.2, 0, 0, -0.2, -0.4, 0.4] },
  }),
);
host.dispatch(
  createReferenceCommand({
    kind: 'reference-reorder',
    id: detail,
    direction: 'up',
  }),
);
host.dispatch(
  createReferenceCommand({
    kind: 'reference-update',
    id: detail,
    patch: { opacity: 0.35 },
  }),
);
const edited = host.getSnapshot();
assert.equal(edited.presentation.references.at(-1).id, detail);
assert.equal(
  edited.presentation.references.find((item) => item.id === detail).opacity,
  0.35,
);
host.undo();
assert.equal(
  host.getSnapshot().presentation.references.find((item) => item.id === detail)
    .opacity,
  1,
);
host.undo();
assert.equal(host.getSnapshot().presentation.references.at(-1).id, colour);
host.undo();
assert.equal(
  host.getSnapshot().presentation.references.find((item) => item.id === detail)
    .pixelToWorld[0],
  0.325,
);
host.redo();
host.redo();
host.redo();
assert.deepEqual(
  host.getSnapshot().editorState.document,
  edited.editorState.document,
);

await host.save('multi-reference.spl');
const saved = decodeDocument(writes.at(-1).bytes);
assert.equal(Object.keys(saved.document.references).length, 3);
assert.equal(Object.keys(saved.assets).length, 2);
host.openBytes(
  { bytes: writes.at(-1).bytes, target: 'reloaded.spl' },
  presentation('reloaded.spl'),
);
snapshot = host.getSnapshot();
assert.equal(snapshot.presentation.references.length, 3);
assert(snapshot.presentation.references.every((reference) => reference.url));
assert.deepEqual(snapshot.presentation.frame, frame);

await host.autosave();
assert.ok(draft);
const restoredUrls = fakeUrls();
const restored = createStudioHost({
  opened: opened(),
  presentation: presentation('restore-source.spl'),
  urls: restoredUrls,
  persistence: {
    writeFile: async () => {},
    drafts: { write: async () => {}, read: async () => structuredClone(draft) },
  },
});
await restored.restore(() => presentation('draft.spl'));
assert.equal(restored.getSnapshot().presentation.references.length, 3);
assert.deepEqual(restored.getSnapshot().storage.assets, draft.assets);
assert(
  restored
    .getSnapshot()
    .presentation.references.every((reference) => reference.url),
);
restored.dispose();

const stale = identity(host);
host.dispatch(
  createReferenceCommand({
    kind: 'reference-update',
    id: detail,
    patch: { visible: false },
  }),
);
assert.throws(
  () => host.addReferenceImages([image('stale.png')], stale),
  /工程已改变/,
);

host.dispatch(createReferenceCommand({ kind: 'reference-delete', id: colour }));
assert.equal(Object.keys(host.getSnapshot().storage.assets).length, 2);
host.dispatch(createReferenceCommand({ kind: 'reference-delete', id: detail }));
assert.deepEqual(
  Object.keys(host.getSnapshot().editorState.document.references),
  ['base'],
);
assert.deepEqual(Object.keys(host.getSnapshot().editorState.document.assets), [
  'base-asset',
]);
assert.equal(
  Object.keys(host.getSnapshot().storage.assets).length,
  2,
  'undo cache retains removed image bytes until history no longer needs them',
);
await host.save('base-only.spl');
assert.deepEqual(Object.keys(decodeDocument(writes.at(-1).bytes).assets), [
  'base-asset',
]);
host.undo();
assert.equal(host.getSnapshot().presentation.references.length, 2);
assert.equal(Object.keys(host.getSnapshot().storage.assets).length, 2);

const stable = host.getSnapshot();
const missing = opened();
missing.assets = {};
assert.throws(
  () => host.open(missing, presentation('missing.spl')),
  /资源缺失或校验失败/,
);
assert.strictEqual(
  host.getSnapshot(),
  stable,
  'missing assets do not replace the live host',
);
const wrongHash = opened();
wrongHash.assets['base-asset'] = png.slice();
wrongHash.assets['base-asset'][0] ^= 1;
assert.throws(
  () => host.open(wrongHash, presentation('hash.spl')),
  /资源缺失或校验失败/,
);
assert.strictEqual(
  host.getSnapshot(),
  stable,
  'bad hashes do not replace the live host',
);
host.dispose();

const boundedUrls = fakeUrls();
const bounded = createStudioHost({
  opened: opened(),
  presentation: presentation(),
  urls: boundedUrls,
  persistence: { writeFile: async () => {} },
});
for (let index = 0; index < 5; index++) {
  bounded.addReferenceImages(
    [
      {
        ...image('large-' + index),
        width: 4096,
        height: 4096,
        bytes: new Uint8Array([...tinyPng, index]),
      },
    ],
    identity(bounded),
  );
  bounded.dispatch(
    createReferenceCommand({
      kind: 'reference-delete',
      id: overlayIds(bounded)[0],
    }),
  );
}
const beforeLimit = bounded.getSnapshot();
const urlCount = boundedUrls.blobs.size;
assert.throws(
  () =>
    bounded.addReferenceImages(
      [
        {
          ...image('over-limit'),
          width: 4096,
          height: 4096,
          bytes: new Uint8Array([...tinyPng, 9]),
        },
      ],
      identity(bounded),
    ),
  /撤销缓存/,
);
assert.strictEqual(
  bounded.getSnapshot(),
  beforeLimit,
  'failed capacity check must not change history',
);
assert.equal(
  boundedUrls.blobs.size,
  urlCount,
  'failed capacity check must not leak URLs',
);
bounded.undo();
assert.equal(
  overlayIds(bounded).length,
  1,
  'prior deleted images remain undoable after capacity rejection',
);
bounded.dispose();
assert.equal(boundedUrls.blobs.size, 0);

console.log(
  'PASS reference host keeps multi-image assets, history, persistence and recovery coherent',
);
