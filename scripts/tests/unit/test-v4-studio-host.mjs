import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decodeDocument } from '../../../src/lib/document/codec.mjs';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createStudioHost } from '../../../src/lib/editor/studio-host.mjs';
import { createStudioPresentation } from '../../../src/lib/editor/studio-presentation.mjs';
import { openProject } from '../../../src/lib/persistence/open-project.mjs';
import { sha256 } from '../../../src/lib/project-container.mjs';
import { decodeProject } from '../../../src/lib/project-format.mjs';

const fixtureBytes = new Uint8Array(
  fs.readFileSync(
    new URL('../../../public/sandrone-example.spl', import.meta.url),
  ),
);
const legacyProject = decodeProject(fixtureBytes);
const frame = { width: 4, height: 2, widthMM: 2 };
const presentation = (fileName = 'project.spl', extra = {}) => ({
  fileName,
  blenderExtrusionMM: 2,
  ...extra,
});
let documentSerial = 0;
const fakeUrls = () => {
  const blobs = new Map();
  const events = [];
  let serial = 0;
  return {
    blobs,
    events,
    createObjectURL(blob) {
      const url = `blob:studio-host-${++serial}`;
      blobs.set(url, blob);
      events.push(['create', url]);
      return url;
    },
    revokeObjectURL(url) {
      events.push(['revoke', url]);
    },
  };
};
const sourceDocument = () => {
  const document = createDocument({
    idFactory: () => `studio-host-document-${++documentSerial}`,
  });
  const assetId = 'asset:reference';
  const referenceId = 'reference:reference';
  const bytes = new Uint8Array([11, 22, 33, 44]);
  document.assets[assetId] = {
    id: assetId,
    path: 'assets/reference.png',
    mediaType: 'image/png',
    size: bytes.length,
    sha256: sha256(bytes),
  };
  document.references[referenceId] = {
    id: referenceId,
    assetId,
    name: 'reference.png',
    pixelWidth: frame.width,
    pixelHeight: frame.height,
    pixelToWorld: [0.5, 0, 0, -0.5, -1, 0.5],
    visible: true,
    locked: true,
    opacity: 0.7,
  };
  return {
    kind: 'v4',
    document,
    assets: { [assetId]: bytes },
    target: 'old.spl',
  };
};
const samePoint = (actual, expected) => {
  assert.ok(Math.abs(actual.x - expected.x) < 1e-9);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-9);
};

// The tracked fixture is a legacy project. Its import must retain the original
// source canvas and convert its embedded image into one canonical V4 asset.
const openedBuiltin = openProject({
  bytes: fixtureBytes,
  target: 'sandrone.spl',
});
const originalDocument = structuredClone(openedBuiltin.document);
const originalAssets = structuredClone(openedBuiltin.assets);
const builtinUrls = fakeUrls();
const writes = [];
const builtinHost = createStudioHost({
  opened: openedBuiltin,
  presentation: presentation('sandrone.spl'),
  urls: builtinUrls,
  persistence: {
    writeFile: async (target, bytes) => writes.push({ target, bytes }),
    drafts: { read: async () => null, write: async () => {} },
  },
});
const builtinSnapshot = builtinHost.getSnapshot();
const builtinReference = Object.values(openedBuiltin.document.references)[0];
const builtinAsset = openedBuiltin.document.assets[builtinReference.assetId];
const builtinUrl = builtinSnapshot.project.image;

assert.equal(openedBuiltin.kind, 'legacy');
assert.equal(builtinSnapshot.project.paths.length, 76);
assert.equal(legacyProject.paths.length, 76);
for (const [index, path] of legacyProject.paths.entries()) {
  const projected = builtinSnapshot.project.paths[index];
  assert.equal(projected.name, path.name);
  assert.equal(projected.closed, path.closed);
  samePoint(projected.start, path.start);
  assert.equal(projected.curves.length, path.curves.length);
  for (const [curveIndex, curve] of path.curves.entries())
    curve.forEach((point, pointIndex) =>
      samePoint(projected.curves[curveIndex][pointIndex], point),
    );
}
assert(Object.isFrozen(builtinSnapshot.project));
assert.throws(() => {
  builtinSnapshot.project.image = 'blob:mutated';
}, TypeError);
assert.deepEqual(openedBuiltin.document, originalDocument);
assert.deepEqual(openedBuiltin.assets, originalAssets);
assert.equal(builtinSnapshot.project.image, builtinUrl);
assert.equal(builtinSnapshot.project.imageName, builtinReference.name);
assert.deepEqual(builtinSnapshot.presentation.reference, {
  ...builtinReference,
  url: builtinUrl,
});
assert.deepEqual(builtinSnapshot.presentation.frame, {
  width: 1254,
  height: 1254,
  widthMM: 100,
});
assert.deepEqual(
  new Uint8Array(await builtinUrls.blobs.get(builtinUrl).arrayBuffer()),
  openedBuiltin.assets[builtinReference.assetId],
);
assert.equal(builtinUrls.blobs.get(builtinUrl).type, builtinAsset.mediaType);

// Saving converts the legacy import to V4. The URL is presentation-only and
// the encoded container must continue to carry the actual image bytes.
await builtinHost.save('converted.spl');
assert.equal(writes.length, 1);
assert.equal(writes[0].target, 'converted.spl');
const encoded = decodeDocument(writes[0].bytes);
assert.deepEqual(
  encoded.assets[builtinReference.assetId],
  originalAssets[builtinReference.assetId],
);
assert.equal(JSON.stringify(encoded.document).includes('blob:'), false);

let replacementPublished = false;
const stopObserving = builtinHost.subscribe(() => {
  const current = builtinHost.getSnapshot();
  if (current.project.image !== builtinUrl) {
    replacementPublished = true;
    assert.equal(
      builtinUrls.events.some(
        (event) => event[0] === 'revoke' && event[1] === builtinUrl,
      ),
      false,
      'the old URL remains valid while the replacement snapshot is published',
    );
  }
});
builtinHost.openBytes(
  { bytes: writes[0].bytes, target: 'reopened.spl' },
  presentation('reopened.spl'),
);
stopObserving();
const reopenedSnapshot = builtinHost.getSnapshot();
const reopenedUrl = reopenedSnapshot.project.image;
assert(replacementPublished);
assert.notEqual(reopenedUrl, builtinUrl);
assert.equal(reopenedSnapshot.project.paths.length, 76);
assert.deepEqual(
  reopenedSnapshot.storage.assets[builtinReference.assetId],
  originalAssets[builtinReference.assetId],
);
assert.deepEqual(builtinUrls.events.slice(-2), [
  ['create', reopenedUrl],
  ['revoke', builtinUrl],
]);
builtinHost.dispose();
builtinHost.dispose();
assert.equal(
  builtinUrls.events.filter(
    (event) => event[0] === 'revoke' && event[1] === reopenedUrl,
  ).length,
  1,
  'dispose is idempotent',
);

// A failed replacement retains the displayed resource. Candidates that made a
// URL before session validation are still reclaimed.
const lifecycleUrls = fakeUrls();
const lifecycleOpened = sourceDocument();
const lifecycleHost = createStudioHost({
  opened: lifecycleOpened,
  presentation: presentation('old.spl'),
  urls: lifecycleUrls,
  persistence: { writeFile: async () => {}, drafts: {} },
});
const oldSnapshot = lifecycleHost.getSnapshot();
const oldUrl = oldSnapshot.project.image;
const invalidDocument = structuredClone(sourceDocument());
invalidDocument.document.version = 99;
assert.throws(
  () => lifecycleHost.open(invalidDocument, presentation('bad.spl')),
  /文档无效/,
);
assert.strictEqual(lifecycleHost.getSnapshot(), oldSnapshot);
assert.deepEqual(lifecycleUrls.events.slice(-2), [
  ['create', 'blob:studio-host-2'],
  ['revoke', 'blob:studio-host-2'],
]);
assert.throws(
  () => lifecycleHost.open(sourceDocument(), { fileName: 'bad.spl' }),
  /明确的文件名和 Blender 挤出厚度/,
);
assert.strictEqual(lifecycleHost.getSnapshot(), oldSnapshot);
const corrupt = sourceDocument();
corrupt.assets['asset:reference'][0]++;
assert.throws(
  () => lifecycleHost.open(corrupt, presentation('corrupt.spl')),
  /资源缺失或校验失败/,
);
assert.strictEqual(lifecycleHost.getSnapshot(), oldSnapshot);
assert.equal(
  lifecycleUrls.events.filter((event) => event[0] === 'revoke').length,
  1,
);
let hostOpenPublished = false;
const observeHostOpen = lifecycleHost.subscribe(() => {
  if (lifecycleHost.getSnapshot().project.image !== oldUrl) {
    hostOpenPublished = true;
    assert.equal(
      lifecycleUrls.events.some(
        (event) => event[0] === 'revoke' && event[1] === oldUrl,
      ),
      false,
    );
  }
});
lifecycleHost.open(sourceDocument(), presentation('new.spl'));
observeHostOpen();
const currentUrl = lifecycleHost.getSnapshot().project.image;
assert(hostOpenPublished);
assert.deepEqual(lifecycleUrls.events.slice(-2), [
  ['create', currentUrl],
  ['revoke', oldUrl],
]);
lifecycleHost.dispose();
assert.equal(lifecycleUrls.events.at(-1)[1], currentUrl);

// Presentation validation remains independent of the editor controller.
const noReferences = sourceDocument();
noReferences.document.references = {};
assert.throws(
  () => createStudioPresentation(noReferences, presentation('empty.spl')),
  /source view frame/,
);
const emptyLease = createStudioPresentation(
  noReferences,
  presentation('empty.spl', { referenceId: null, frame }),
);
assert.equal(emptyLease.presentation.reference, null);
emptyLease.dispose();

const manyReferences = sourceDocument();
manyReferences.document.references['reference:second'] = {
  ...manyReferences.document.references['reference:reference'],
  id: 'reference:second',
  name: 'second.png',
};
assert.throws(
  () => createStudioPresentation(manyReferences, presentation()),
  /多个参考图需要明确选择/,
);
const selectedUrls = fakeUrls();
const selected = createStudioPresentation(
  manyReferences,
  presentation('selected.spl', { referenceId: 'reference:second' }),
  selectedUrls,
);
assert.equal(selected.presentation.reference.name, 'second.png');
selected.dispose();

const affine = sourceDocument();
affine.document.references['reference:reference'].pixelToWorld[1] = 0.1;
assert.throws(
  () => createStudioPresentation(affine, presentation()),
  /仿射无法由原 Studio 坐标系精确显示/,
);
const missing = sourceDocument();
missing.assets = {};
assert.throws(
  () => createStudioPresentation(missing, presentation()),
  /资源缺失或校验失败/,
);
const wrongHash = sourceDocument();
wrongHash.assets['asset:reference'][0]++;
assert.throws(
  () => createStudioPresentation(wrongHash, presentation()),
  /资源缺失或校验失败/,
);

// If controller construction fails after the lease is created, the host owns
// and releases that initial candidate too.
const failedConstructionUrls = fakeUrls();
assert.throws(
  () =>
    createStudioHost({
      opened: sourceDocument(),
      presentation: presentation(),
      urls: failedConstructionUrls,
      persistence: {},
    }),
  /需要 encodeV4 和 writeFile 注入/,
);
assert.deepEqual(failedConstructionUrls.events, [
  ['create', 'blob:studio-host-1'],
  ['revoke', 'blob:studio-host-1'],
]);

console.log(
  'PASS: Studio host owns immutable V4 presentation resources, replacement rollback, and asset-preserving persistence.',
);
