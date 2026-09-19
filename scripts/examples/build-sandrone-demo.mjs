// Reproducible local example. The private source image is never included in the app.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { emptyModel, validateModel } from '../../lib/model-schema.mjs';
import { previewRegion, evaluateRegions } from '../../lib/region-engine.mjs';
import { buildSolid, meshSTL } from '../../lib/solid-engine.mjs';

const [source, directory] = process.argv.slice(2);
if (!source || !directory)
  throw Error(
    'Usage: node scripts/examples/build-sandrone-demo.mjs source.bezier.json output-directory',
  );
const bytes = fs.readFileSync(source),
  project = JSON.parse(bytes),
  originalPaths = JSON.stringify(project.paths);
assert.equal(
  project.paths.length,
  71,
  'This demonstration uses the supplied 71-path Sandrone project',
);
project.version = 2;
project.model = emptyModel();
project.model.manufacturingMM = 0.02;
project.model.parts[0].name = '桑多涅 · 分层浮雕';
const model = project.model,
  ps = project.paths;
const colors = {
  cream: '#e8d8bc',
  black: '#242832',
  gold: '#a98b58',
  hair: '#95826a',
  red: '#9e3040',
  skin: '#f4dfc5',
};
function region(id, name, spec, color = colors.cream) {
  model.regions.push({ id, name, color, visible: false, ...spec });
  return id;
}
for (let i = 0; i < ps.length; i++)
  if (ps[i].closed)
    region('source-' + i, ps[i].name, {
      kind: 'path',
      pathId: ps[i].id,
      repair: true,
    });
function feature(id, name, sourceRegion, top, color, clip = true) {
  const regionId = clip
    ? region(
        'clip-' + id,
        name,
        { kind: 'intersection', a: sourceRegion, b: 'source-0' },
        color,
      )
    : sourceRegion;
  model.regions.find((r) => r.id === regionId).color = color;
  model.regions.find((r) => r.id === regionId).visible = true;
  model.features.push({
    id: 'body-' + id,
    name,
    regionId,
    partId: 'main',
    mode: 'add',
    zMM: 0,
    heightMM: Number((id === 'base' ? top : top - 2).toFixed(3)),
    attachId: id === 'base' ? '' : 'body-base',
    enabled: true,
    color,
  });
}
feature('base', '底板 / 外框', 'source-0', 2, colors.cream, false);
feature('black', '黑色衬底', 'source-1', 2.45, colors.black);
for (let i = 2; i < ps.length; i++) {
  if (!ps[i].closed || [11, 37, 66].includes(i)) continue;
  const name = ps[i].name,
    group = project.groups.find((g) => g.id === ps[i].groupId)?.name;
  let height = 3.1,
    color = colors.cream;
  if (group === '头饰') height = 3.15;
  if (['头发', '后发', '前发'].includes(group)) {
    height = 3.85;
    color = colors.hair;
  }
  if (group === '杯子') {
    height = i === 23 ? 3.6 : [24, 25].includes(i) ? 3.2 : 3.75;
    color = i === 23 ? colors.cream : colors.gold;
  }
  if (group === '发饰') {
    height = /红|飘带/.test(name) ? 3 : /黑/.test(name) ? 3.05 : 3.1;
    color = /红|飘带/.test(name)
      ? colors.red
      : /黑/.test(name)
        ? colors.black
        : colors.gold;
  }
  if (group === '面部') {
    height = 3.9;
    color = colors.gold;
  }
  if (group === '胸饰') {
    height = i === 50 ? 3.25 : 3.1;
    color = i === 50 ? colors.gold : colors.black;
  }
  if (group === '胸前') {
    height = [51, 52].includes(i) ? 3.8 : [53, 54].includes(i) ? 3.15 : 3.2;
    color = [51, 52].includes(i)
      ? colors.skin
      : [53, 54].includes(i)
        ? colors.black
        : colors.cream;
  }
  feature(String(i), name, 'source-' + i, height, color);
}
const split = {
  kind: 'split',
  baseId: 'source-11',
  pathIds: ps.slice(16, 23).map((p) => p.id),
  joinMM: 0.7,
};
const preview = previewRegion(project, split);
assert.equal(preview.candidates.length, 11);
for (let i = 0; i < preview.candidates.length; i++) {
  const c = preview.candidates[i],
    id = region(
      'hair-' + i,
      '头发分区 ' + (i + 1),
      {
        ...split,
        seed: c.seed,
        seedWidthMM: project.widthMM,
        expectedCount: 11,
      },
      colors.hair,
    );
  feature(
    'hair-' + i,
    '头发分区 ' + (i + 1),
    id,
    i === 0 ? 4.05 : c.areaMM2 > 50 ? 4.55 : c.areaMM2 > 10 ? 4.3 : 3.75,
    colors.hair,
  );
}
for (const i of [39, 40])
  region(
    'source-' + i,
    ps[i].name,
    { kind: 'path', pathId: ps[i].id, close: true, repair: true },
    colors.black,
  );
region('face-tools', '嘴与眉工具面', {
  kind: 'union',
  a: 'source-39',
  b: 'source-40',
});
region(
  'face-cut',
  '面部 / 嘴与眉凹口',
  { kind: 'difference', a: 'source-37', b: 'face-tools' },
  colors.skin,
);
feature('face', '面部 / 嘴与眉凹口', 'face-cut', 3.7, colors.skin);
for (const [a, b] of [
  [60, 61],
  [62, 63],
  [64, 65],
  [67, 68],
  [69, 70],
]) {
  let id = region(
    'band-' + a,
    '头饰嵌线 ' + (a + 1),
    { kind: 'between', pathIds: [ps[a].id, ps[b].id], repair: true },
    colors.gold,
  );
  id = region(
    'band-limit-' + a,
    '头饰嵌线范围 ' + (a + 1),
    { kind: 'intersection', a: id, b: 'source-8' },
    colors.gold,
  );
  if (a === 64)
    id = region(
      'band-hole',
      '头饰嵌线 / 菱形孔',
      { kind: 'difference', a: id, b: 'source-66' },
      colors.gold,
    );
  feature('band-' + a, '头饰嵌线 ' + (a + 1), id, 3.48, colors.gold);
}
region(
  'border',
  '边框 / 扣除黑色衬底',
  { kind: 'difference', a: 'source-0', b: 'source-1' },
  colors.cream,
);
validateModel(model);
const regions = evaluateRegions(project),
  errors = regions.filter((r) => r.error);
assert.deepEqual(errors, [], 'Every face must remain recomputable');
const solid = await buildSolid(project);
assert.ok(solid.report.valid, 'Closed oriented mesh');
assert.equal(solid.report.components, 1, 'Connected object');
assert.equal(
  JSON.stringify(project.paths),
  originalPaths,
  'All original Bezier source data preserved exactly',
);
assert.deepEqual(fs.readFileSync(source), bytes, 'Original file untouched');
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(
  path.join(directory, 'Sandrone-relief.bezier.json'),
  JSON.stringify(project),
);
fs.writeFileSync(
  path.join(directory, 'Sandrone-relief.stl'),
  Buffer.from(meshSTL(solid.mesh)),
);
fs.writeFileSync(path.join(directory, 'mesh.json'), JSON.stringify(solid.mesh));
fs.writeFileSync(
  path.join(directory, 'validation.json'),
  JSON.stringify(
    {
      sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      sourcePaths: ps.length,
      sourceCubics: ps.reduce((s, p) => s + p.curves.length, 0),
      regions: regions.length,
      features: model.features.length,
      hairSplit: {
        count: 11,
        connections: preview.connections,
        warnings: preview.warnings,
      },
      report: solid.report,
      warnings: solid.warnings,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      directory,
      regions: regions.length,
      features: model.features.length,
      ...solid.report,
    },
    null,
    2,
  ),
);
