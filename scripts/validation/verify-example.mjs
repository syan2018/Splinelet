// Read-only validation for a committed native example project.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'three/addons/libs/fflate.module.js';
import { resolveOutputReference } from '../../src/lib/construction/provenance.mjs';
import { createOutputRefIndex } from '../../src/lib/construction/output-identity.mjs';
import {
  decodeDocument,
  encodeDocument,
} from '../../src/lib/document/codec.mjs';
import { evaluateDocument } from '../../src/lib/evaluation/evaluate-document.mjs';
import { exportSnapshot } from '../../src/lib/export/snapshot.mjs';

const defaultInput = fileURLToPath(
  new URL('../../public/sandrone-example.spl', import.meta.url),
);
const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    input: { type: 'string' },
    'output-dir': { type: 'string' },
  },
  allowPositionals: true,
});

assert.ok(positionals.length <= 1, '最多只能提供一个输入路径');
assert.ok(!(values.input && positionals[0]), '输入路径只能指定一次');
const inputPath = resolve(values.input || positionals[0] || defaultInput);
const outputDir = values['output-dir'] && resolve(values['output-dir']);
const input = new Uint8Array(await readFile(inputPath));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const decoded = decodeDocument(input);

const roundtrip = encodeDocument(decoded.document, { assets: decoded.assets });
assert.deepEqual(
  decodeDocument(roundtrip),
  decoded,
  'codec roundtrip 必须保留文档和全部资源',
);
assert.deepEqual(
  encodeDocument(decoded.document, { assets: decoded.assets }),
  roundtrip,
  'codec roundtrip 必须稳定',
);

const document = decoded.document;
const snapshot = await evaluateDocument(document);
const ready = (name, result) => {
  assert.equal(result?.status, 'ready', `${name} 未就绪`);
  return result.value;
};
const readyMany = (name, results) => {
  assert.ok(Array.isArray(results) && results.length, `${name} 没有已发布输出`);
  results.forEach((result, index) => ready(`${name}[${index}]`, result));
  return results;
};
const curves = readyMany('curves', snapshot.curves);
const regionStages = readyMany('regions', snapshot.regions);
const relief = ready('relief', snapshot.relief);
const placedRelief = ready('placed-relief', snapshot.placedRelief);
const bodySet = ready('bodies', snapshot.bodies);
const published = regionStages.flatMap((result) => result.value.regions);
assert.ok(published.length, '没有已发布 Region 输出');

const regionIndex = createOutputRefIndex(published, (region) => region.ref);
const duplicateOutputs = published.filter(
  (region) => regionIndex.get(region.ref).length !== 1,
);
assert.equal(duplicateOutputs.length, 0, '已发布 OutputRef 必须能唯一解析');

const references = [];
const nodeReferences = [];
const referenceCategories = [
  'appearance',
  'relief',
  'presentation',
  'manufacturing',
  'excluded',
  'relief-attachment',
  'default-attachment',
];
const outputReference = (category, id, target) => {
  if (target?.kind === 'output') references.push({ category, id, target });
};
const nodeReference = (category, id, target) => {
  if (target?.kind !== 'node') return;
  const node = document.nodes[target.id];
  assert.equal(node?.kind, 'shape', `${category}:${id} 的 Shape 引用无效`);
  nodeReferences.push({ category, id });
};
for (const [id, item] of Object.entries(document.appearances.overrides))
  outputReference('appearance', id, item.target);
for (const [id, item] of Object.entries(document.reliefDefinitions.overrides)) {
  outputReference('relief', id, item.target);
  if (item.value.placement?.kind === 'attached') {
    outputReference('relief-attachment', id, item.value.placement.target);
    nodeReference('relief-attachment', id, item.value.placement.target);
  }
}
for (const [id, item] of Object.entries(document.reliefDefinitions.defaults))
  if (item.placement?.kind === 'attached') {
    outputReference('default-attachment', id, item.placement.target);
    nodeReference('default-attachment', id, item.placement.target);
  }
for (const [id, item] of Object.entries(
  document.regionPresentations?.overrides || {},
))
  outputReference('presentation', id, item.target);
for (const [id, item] of Object.entries(document.manufacturing.assignments)) {
  outputReference('manufacturing', id, item.target);
  nodeReference('manufacturing', id, item.target);
}
document.manufacturing.excluded.forEach((target, index) => {
  outputReference('excluded', String(index), target);
  nodeReference('excluded', String(index), target);
});

const unresolvedReferences = references.flatMap(({ category, id, target }) => {
  const result = resolveOutputReference(published, target, regionIndex);
  return result.status === 'resolved'
    ? []
    : [{ category, id, status: result.status }];
});
assert.deepEqual(
  unresolvedReferences,
  [],
  '逐输出赋值和附着 OutputRef 必须唯一解析到当前 published Region',
);

assert.ok(
  Array.isArray(bodySet.bodies) && bodySet.bodies.length,
  '没有有效实体',
);
const materialVolumes = new Map();
const bodyReports = [];
let bodyVolumeMM3 = 0;
for (const body of bodySet.bodies) {
  assert.equal(body.report?.valid, true, `Part ${body.partId} 实体无效`);
  assert.ok(
    Number.isFinite(body.report.volumeMM3) && body.report.volumeMM3 > 0,
    `Part ${body.partId} 实体体积无效`,
  );
  bodyVolumeMM3 += body.report.volumeMM3;
  assert.ok(body.materialParts.length, `Part ${body.partId} 没有分色材料体`);
  let materialVolumeMM3 = 0;
  for (const material of body.materialParts) {
    assert.equal(material.report?.valid, true, '分色材料体无效');
    assert.ok(
      Number.isFinite(material.volumeMM3) && material.volumeMM3 > 0,
      '分色材料体积无效',
    );
    assert.equal(typeof material.color, 'string', '分色材料体缺少颜色');
    materialVolumeMM3 += material.volumeMM3;
    materialVolumes.set(
      material.color,
      (materialVolumes.get(material.color) || 0) + material.volumeMM3,
    );
  }
  const materialToleranceMM3 = Math.max(0.001, body.report.volumeMM3 * 1e-5);
  assert.ok(
    Math.abs(materialVolumeMM3 - body.report.volumeMM3) <= materialToleranceMM3,
    `Part ${body.partId} 的分色体积与实体体积不一致`,
  );
  bodyReports.push({
    partId: body.partId,
    report: body.report,
    materialVolumeMM3,
    materialToleranceMM3,
  });
}

const capture = {
  epoch: 'verify-example',
  revision: 0,
  previewId: null,
  snapshot,
};
const archiveSummary = (result, bambu) => {
  const entries = unzipSync(new Uint8Array(result.data));
  const model = strFromU8(entries['3D/3dmodel.model'] || new Uint8Array());
  assert.ok(entries['3D/3dmodel.model'], '3MF 缺少 3D 模型');
  assert.match(model, /<model unit="millimeter"/, '3MF 单位必须是 mm');
  if (bambu) {
    assert.ok(
      entries['Metadata/model_settings.config'],
      'Bambu 包缺少模型设置',
    );
    assert.ok(
      entries['Metadata/project_settings.config'],
      'Bambu 包缺少项目设置',
    );
    assert.match(model, /bamboo_slicer:Version3mf/, 'Bambu 包缺少 Bambu 标记');
  } else assert.doesNotMatch(model, /bamboo_slicer:Version3mf/);
  return {
    bytes: result.data.byteLength,
    entries: Object.keys(entries).sort(),
    modelObjectCount: (model.match(/<object id="\d+" type="model"/g) || [])
      .length,
    meshObjectCount: (model.match(/<mesh>/g) || []).length,
  };
};
const generic = await exportSnapshot(capture, {
  format: '3mf',
  stage: 'bodies',
});
assert.equal(generic.mimeType, 'model/3mf');
const bambu = await exportSnapshot(capture, {
  format: '3mf-bambu',
  stage: 'bodies',
  slicerTemplate: document.manufacturing.slicerTemplate,
});
assert.equal(bambu.mimeType, 'model/3mf');
assert.deepEqual(
  encodeDocument(document, { assets: decoded.assets }),
  roundtrip,
  '求值和导出不得改写文档或资源 authority',
);

const report = {
  input: inputPath,
  sha256: sha256(input),
  documentVersion: document.version,
  authorityStableAfterEvaluationAndExport: true,
  roundtrip: {
    bytes: roundtrip.byteLength,
    assetCount: Object.keys(decoded.assets).length,
  },
  stages: {
    curves: curves.length,
    regions: regionStages.length,
    publishedRegions: published.length,
    reliefs: relief.reliefs.length,
    placedReliefs: placedRelief.reliefs.length,
    bodies: bodySet.bodies.length,
  },
  references: Object.fromEntries(
    referenceCategories.map((category) => [
      category,
      references.filter((item) => item.category === category).length,
    ]),
  ),
  nodeReferences: Object.fromEntries(
    referenceCategories.map((category) => [
      category,
      nodeReferences.filter((item) => item.category === category).length,
    ]),
  ),
  volumesMM3: {
    bodies: bodyVolumeMM3,
    materialsByColor: Object.fromEntries(materialVolumes),
  },
  bodies: bodyReports,
  exports: {
    generic: archiveSummary(generic, false),
    bambu: archiveSummary(bambu, true),
  },
};

if (outputDir) {
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(
      resolve(outputDir, 'verify-example-report.json'),
      JSON.stringify(report, null, 2) + '\n',
    ),
    writeFile(resolve(outputDir, 'example.3mf'), new Uint8Array(generic.data)),
    writeFile(
      resolve(outputDir, 'example-bambu.3mf'),
      new Uint8Array(bambu.data),
    ),
  ]);
}
console.log(JSON.stringify(report, null, 2));
