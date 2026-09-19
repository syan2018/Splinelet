import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  strFromU8,
  strToU8,
  unzipSync,
  zipSync,
} from 'three/addons/libs/fflate.module.js';
import {
  decodeDocument,
  encodeDocument,
} from '../../../src/lib/document/codec.mjs';
import { validateDocument } from '../../../src/lib/document/schema.mjs';
import { sha256 } from '../../../src/lib/project-container.mjs';

assert.equal(
  sha256(new TextEncoder().encode('abc')),
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
);
const fixture = JSON.parse(
  readFileSync(
    new URL('../fixtures/v4-document/empty-document.json', import.meta.url),
  ),
);
validateDocument(fixture);
const empty = encodeDocument(fixture);
assert.deepEqual(decodeDocument(empty), { document: fixture, assets: {} });
assert.deepEqual(encodeDocument(fixture), empty);

// Sorting must agree across manifest/document and across host locales.
const mixedCase = structuredClone(fixture);
const mixedBytes = {};
for (const id of ['z', 'A', 'a', 'Z']) {
  const bytes = new Uint8Array([1]);
  mixedCase.assets[id] = {
    id,
    path: `assets/${id}.bin`,
    mediaType: 'application/octet-stream',
    size: 1,
    sha256: sha256(bytes),
  };
  mixedBytes[id] = bytes;
}
assert.deepEqual(
  decodeDocument(encodeDocument(mixedCase, { assets: mixedBytes })),
  { document: mixedCase, assets: mixedBytes },
);

const document = structuredClone(fixture);
const first = new Uint8Array([1, 2, 3]);
const second = new Uint8Array([4, 5]);
document.assets.first = {
  id: 'first',
  path: 'assets/reference.png',
  mediaType: 'image/png',
  size: first.length,
  sha256: sha256(first),
};
document.assets.second = {
  id: 'second',
  path: 'assets/texture.bin',
  mediaType: 'application/octet-stream',
  size: second.length,
  sha256: sha256(second),
};
document.references.reference = {
  id: 'reference',
  assetId: 'first',
  name: '底图',
  pixelWidth: 1,
  pixelHeight: 1,
  pixelToWorld: [1, 0, 0, 1, 0, 0],
  visible: true,
  locked: false,
  opacity: 1,
};
const encoded = encodeDocument(document, {
  assets: { second, first },
  appVersion: '5.0.0',
});
assert.deepEqual(decodeDocument(encoded), {
  document,
  assets: { first, second },
});
assert.deepEqual(
  encoded,
  encodeDocument(document, { assets: { first, second }, appVersion: '5.0.0' }),
);

const entries = unzipSync(encoded);
const repack = (change) => {
  const copy = Object.fromEntries(
    Object.entries(entries).map(([name, value]) => [name, value.slice()]),
  );
  change(copy);
  return zipSync(copy, { mtime: new Date(2000, 0, 1) });
};
assert.throws(
  () => encodeDocument(document, { assets: { first } }),
  /一一匹配/,
);
assert.throws(
  () =>
    encodeDocument(
      {
        ...document,
        assets: {
          first: { ...document.assets.first, sha256: '0'.repeat(64) },
          second: document.assets.second,
        },
      },
      { assets: { first, second } },
    ),
  /哈希不匹配/,
);
assert.throws(
  () => decodeDocument(strToU8(JSON.stringify(fixture))),
  /ZIP 容器/,
);
assert.throws(
  () =>
    decodeDocument(
      repack((copy) => {
        copy['extra.json'] = strToU8('{}');
      }),
    ),
  /未声明条目/,
);
assert.throws(
  () =>
    decodeDocument(
      repack((copy) => {
        copy['assets/reference.png'][0] ^= 1;
      }),
    ),
  /哈希不匹配/,
);
assert.throws(
  () =>
    decodeDocument(
      repack((copy) => {
        const manifest = JSON.parse(strFromU8(copy['manifest.json']));
        manifest.documentVersion = 5;
        copy['manifest.json'] = strToU8(JSON.stringify(manifest));
      }),
    ),
  /文档版本/,
);

console.log(
  'PASS: V4 codec deterministic no-resource/multi-resource roundtrips and container rejection.',
);
