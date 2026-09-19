import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js';
import { liveSurfaces, rectangle } from '../fixtures/live-surfaces.mjs';
import { export3MF, pack3MF } from '../../../src/lib/three-mf.mjs';
import { buildSolid } from '../../../src/lib/solid-engine.mjs';

const p = liveSurfaces();
p.creation.objects[0].roles.hole = 'guide';
p.paths.push(rectangle('detail', 20, 20, 60, 60));
p.creation.objects[0].pathIds.push('detail');
p.model.regions.push({
  id: 'detail-face',
  kind: 'path',
  pathId: 'detail',
  name: '细节 <测试> & "色块"',
  color: '#d2b777',
});
p.model.features.push({
  ...p.model.features[0],
  id: 'detail-body',
  regionId: 'detail-face',
  name: '细节 <测试> & "色块"',
  color: '#d2b777',
  zMM: 1,
});
p.creation.objects[0].featureIds.push('detail-body');
p.creation.objects[0].featureSwatches['detail-body'] = 'gold';
const original = structuredClone(p);
const solid = await buildSolid(p, 'main', undefined, { materials: true });
assert(solid.report.valid);
assert.equal(solid.materialParts.length, 2);
assert(solid.materialParts.every((p) => p.report.valid));
assert(
  Math.abs(
    solid.materialParts.reduce((s, p) => s + p.report.volumeMM3, 0) - 14400,
  ) < 0.001,
);
const result = await export3MF(p);
assert.deepEqual(p, original);
assert.equal(result.materials.length, 2);
const archive = unzipSync(new Uint8Array(result.bytes));
assert.deepEqual(
  Object.keys(archive).sort(),
  ['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels'].sort(),
);
const xml = strFromU8(archive['3D/3dmodel.model']);
assert(xml.includes('unit="millimeter"'));
assert.equal((xml.match(/<base /g) || []).length, 2);
assert.equal((xml.match(/<component /g) || []).length, 2);
assert.equal((xml.match(/<item /g) || []).length, 1);
assert(xml.includes('&lt;测试&gt; &amp; &quot;色块&quot;'));
assert.throws(
  () =>
    pack3MF([
      { name: 'bad', color: '#123456', mesh: { positions: [], triangles: [] } },
    ]),
  /有效闭合/,
);
// A cutting feature must be removed from every material volume, not merely
// from the single-colour merged check mesh.
p.model.features.push({
  ...p.model.features[0],
  id: 'cut',
  name: '贯穿孔',
  regionId: 'detail-face',
  mode: 'through',
});
p.creation.objects[0].featureIds.push('cut');
const cut = await export3MF(p);
assert.equal(cut.parts.length, 1);
assert(Math.abs(cut.report.volumeMM3 - (6400 - 1600) * 2) < 0.001);
console.log(
  'PASS: two disjoint material volumes, exact union volume, source immutability, ZIP/OPC/core references, XML escaping, cuts and invalid mesh rejection',
);
