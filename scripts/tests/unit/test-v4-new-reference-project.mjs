import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createReferenceProject } from '../../../src/lib/editor/new-reference-project.mjs';
import {
  encodeDocument,
  decodeDocument,
} from '../../../src/lib/document/codec.mjs';

const bytes = new Uint8Array(
  await readFile(new URL('../../../public/reference.png', import.meta.url)),
);
const input = {
  bytes,
  mediaType: 'image/png',
  name: '新底图.png',
  width: 1200,
  height: 1200,
};
const opened = createReferenceProject(input);
assert.equal(opened.kind, 'v5');
assert.equal(opened.document.version, 5);
assert.equal(opened.document.evaluationSemanticsVersion, 1);
assert.deepEqual(opened.document.regionDefinitions, {});
assert.equal(opened.dirty, true);
assert.equal(opened.target, null);
assert.deepEqual(opened.document.nodes, {});
assert.deepEqual(opened.document.sketches, {});
assert.deepEqual(opened.document.programs, {});
const reference = Object.values(opened.document.references)[0];
assert.deepEqual(reference.pixelToWorld, [1 / 12, 0, 0, -1 / 12, -50, 50]);
assert.equal(reference.name, input.name);
assert.notEqual(opened.assets[reference.assetId], bytes);
const decoded = decodeDocument(
  encodeDocument(opened.document, { assets: opened.assets }),
);
assert.deepEqual(decoded.document, opened.document);
assert.deepEqual(decoded.assets[reference.assetId], bytes);
bytes[0] ^= 255;
assert.notEqual(opened.assets[reference.assetId][0], bytes[0]);
assert.throws(() =>
  createReferenceProject({ ...input, mediaType: 'text/html' }),
);
assert.throws(() =>
  createReferenceProject({ ...input, mediaType: 'constructor' }),
);
assert.throws(() => createReferenceProject({ ...input, width: 0 }));
assert.throws(() =>
  createReferenceProject({ ...input, bytes: new Uint8Array() }),
);
console.log(
  'PASS new reference project: empty V5 authority, owned image bytes, centered frame and container roundtrip',
);
