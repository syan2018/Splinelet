import assert from 'node:assert/strict';
import {
  strFromU8,
  strToU8,
  unzipSync,
  zipSync,
} from 'three/addons/libs/fflate.module.js';
import {
  decodeProject,
  encodeProject,
  SPL_MIME,
} from '../../../lib/project-format.mjs';

const png = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
]);
const project = {
  version: 3,
  image: `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
  imageName: 'reference.png',
  width: 20,
  height: 10,
  widthMM: 100,
  depthMM: 2,
  paths: [],
};

const encoded = encodeProject(project, { appVersion: '1.2.3' });
assert.ok(encoded instanceof Uint8Array);
assert.deepEqual(decodeProject(encoded), project);
assert.deepEqual(encodeProject(project), encodeProject(project));

const entries = unzipSync(encoded);
assert.equal(strFromU8(entries.mimetype), SPL_MIME);
assert.equal(
  JSON.parse(strFromU8(entries['manifest.json'])).appVersion,
  '1.2.3',
);
assert.deepEqual(JSON.parse(strFromU8(entries['project.json'])).image, {
  asset: 'reference',
});
assert.deepEqual(entries['assets/reference.png'], png);

assert.deepEqual(decodeProject(JSON.stringify(project)), project);
assert.deepEqual(decodeProject(strToU8(JSON.stringify(project))), project);

const repack = (change) => {
  const copy = Object.fromEntries(
    Object.entries(entries).map(([name, value]) => [name, value.slice()]),
  );
  change(copy);
  return zipSync(copy, { mtime: new Date(2000, 0, 1) });
};

assert.throws(
  () =>
    decodeProject(
      repack((copy) => {
        const manifest = JSON.parse(strFromU8(copy['manifest.json']));
        manifest.containerVersion = 2;
        copy['manifest.json'] = strToU8(JSON.stringify(manifest));
      }),
    ),
  /更新版本/,
);
assert.throws(
  () =>
    decodeProject(
      repack((copy) => {
        delete copy['assets/reference.png'];
      }),
    ),
  /缺少参考图片资源/,
);
assert.throws(
  () =>
    decodeProject(
      repack((copy) => {
        copy['assets/reference.png'][8] ^= 1;
      }),
    ),
  /哈希不匹配/,
);
assert.throws(() => decodeProject(encoded.subarray(0, encoded.length - 10)));
assert.throws(() => decodeProject(strToU8('{broken')));

console.log(
  'PASS: .spl stable ZIP roundtrip, legacy JSON, manifest/version, missing asset, hash, and corruption checks.',
);
