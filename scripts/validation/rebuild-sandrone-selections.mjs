// One-off, explicit authoring repair for the public Sandrone V5 sample.
// It does not infer a face correspondence at evaluation time.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createEditorSession } from '../../src/lib/editing/dispatcher.mjs';
import { createSourceCommand } from '../../src/lib/editing/commands/source.mjs';
import {
  decodeDocument,
  encodeDocument,
} from '../../src/lib/document/codec.mjs';
import { evaluatePlanar } from '../../src/lib/construction/document-evaluation.mjs';
import { evaluateDocument } from '../../src/lib/evaluation/evaluate-document.mjs';
import { outputIdentity } from '../../src/lib/construction/output-identity.mjs';
import { readGeometry } from '../../src/lib/region-engine.mjs';
import { buildBodies, cleanPlacedRelief } from '../../src/lib/solid/bodies.mjs';
import { sandroneHairRegionSelectionPlan as hair } from '../tests/fixtures/sandrone-hair-region-selections.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    input: { type: 'string' },
    output: { type: 'string' },
    report: { type: 'string' },
  },
});
assert.ok(values.input, '必须显式传入 --input <修复前 V5 .spl>');
assert.ok(values.output, '必须显式传入 --output <新 .spl>');
const inputPath = resolve(root, values.input);
const outputPath = resolve(root, values.output);
assert.notEqual(inputPath, outputPath, '--input 与 --output 不能相同');
assert.match(outputPath, /\.spl$/i, '--output 必须是 .spl');
const reportPath = resolve(
  root,
  values.report || outputPath.replace(/\.spl$/i, '-selection-rebuild.json'),
);

const clone = (value) => structuredClone(value);
const ref = (operatorId, key) => ({
  kind: 'output',
  ownerNodeId: hair.ownerNodeId,
  operatorId,
  port: 'regions',
  key,
  lineage: [],
  instances: [],
});
const port = (operatorId) => ({
  kind: 'port',
  ownerNodeId: hair.ownerNodeId,
  operatorId,
  port: 'regions',
  domain: 'regions',
  space: 'local-result',
  transform: [1, 0, 0, 1, 0, 0],
});
const curvePort = (operatorId) => ({
  kind: 'port',
  ownerNodeId: hair.ownerNodeId,
  operatorId,
  port: 'curves',
  domain: 'curves',
  space: 'local-result',
  transform: [1, 0, 0, 1, 0, 0],
});
const operatorId = (group) => `operator:author-hair-select-${group.suffix}`;
const definitionId = (group) => `region:author-hair-result-${group.suffix}`;
const propertyValue = (document, target, table) => {
  const matches = Object.values(table).filter(
    (record) => outputIdentity(record.target) === outputIdentity(target),
  );
  assert.equal(matches.length, 1, '每个旧头发面必须恰有一个属性记录');
  return clone(matches[0].value);
};
const sameValue = (left, right) =>
  JSON.stringify(left) === JSON.stringify(right);
const union = (regions) =>
  regions
    .map((region) => readGeometry(region.geometry))
    .reduce((area, geometry) => (area ? area.union(geometry) : geometry), null);
const bodySummary = (snapshot) => {
  assert.equal(
    snapshot.bodies.status,
    'ready',
    JSON.stringify(snapshot.bodies.diagnostics),
  );
  const materials = new Map();
  let volumeMM3 = 0;
  for (const body of snapshot.bodies.value.bodies) {
    assert.equal(body.report.valid, true, '实体必须有效');
    volumeMM3 += body.report.volumeMM3;
    for (const part of body.materialParts)
      materials.set(
        part.color,
        (materials.get(part.color) || 0) + part.volumeMM3,
      );
  }
  return {
    volumeMM3,
    materialsMM3: Object.fromEntries(
      [...materials].sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
};
const toleranceFor = (left, right) =>
  Math.max(0.001, Math.max(Math.abs(left), Math.abs(right)) * 1e-5);
const close = (left, right, message) =>
  assert.ok(Math.abs(left - right) <= toleranceFor(left, right), message);

const input = new Uint8Array(await readFile(inputPath));
const original = decodeDocument(input);
const baselinePlanar = evaluatePlanar(original.document);
const baselineHair =
  baselinePlanar.components[`operator:${hair.partitionId}`].ports.regions;
assert.equal(
  baselineHair.status,
  'ready',
  JSON.stringify(baselineHair.diagnostics),
);
const baselineById = new Map(
  baselineHair.value.regions.map((region) => [region.ref.key, region]),
);
const baselineSnapshot = await evaluateDocument(original.document);
const baselineBodies = bodySummary(baselineSnapshot);

const document = clone(original.document);
const program = document.programs[document.nodes[hair.ownerNodeId].programId];
assert.equal(document.version, 5, '输入必须是修复前的 V5 工程');
assert.ok(program, '输入缺少头发 Shape 的 Program');
const partition = program.operators[hair.partitionId];
assert.equal(partition.type, 'partition');
assert.ok(partition.params.endpointJoin, '头发分区必须带待迁移 endpointJoin');
assert.ok(!program.operators[hair.endpointAttachId]);
for (const group of hair.groups)
  for (const id of group.oldDefinitionIds)
    assert.ok(
      document.regionDefinitions[id],
      `输入已不是修复前样例：缺少旧头发定义 ${id}`,
    );
program.operators[hair.endpointAttachId] = {
  id: hair.endpointAttachId,
  type: 'curve-endpoint-attach',
  name: '头发 · 端点接边',
  enabled: true,
  inputs: {
    input: clone(partition.inputs.cutter),
    boundary: clone(partition.inputs.input),
  },
  params: { endpointJoin: clone(partition.params.endpointJoin) },
};
partition.inputs.cutter = [curvePort(hair.endpointAttachId)];
const { endpointJoin: _legacyEndpointJoin, ...partitionParams } =
  partition.params;
partition.params = partitionParams;
const collect = program.operators[hair.collectId];
assert.equal(collect.type, 'region-collect');
assert.equal(
  collect.inputs.input[hair.collectInputIndex].operatorId,
  hair.partitionId,
);
assert.equal(collect.params.disjointSelections, undefined);

const remaps = [];
for (const group of hair.groups) {
  const oldRefs = group.oldDefinitionIds.map((id) => ref(hair.partitionId, id));
  const appearance = propertyValue(
    document,
    oldRefs[0],
    document.appearances.overrides,
  );
  const relief = propertyValue(
    document,
    oldRefs[0],
    document.reliefDefinitions.overrides,
  );
  for (const oldRef of oldRefs) {
    assert.ok(
      baselineById.has(oldRef.key),
      `旧定义 ${oldRef.key} 必须属于头发分区输出`,
    );
    assert.ok(
      sameValue(
        appearance,
        propertyValue(document, oldRef, document.appearances.overrides),
      ),
      '一组选择只能合并相同外观',
    );
    assert.ok(
      sameValue(
        relief,
        propertyValue(document, oldRef, document.reliefDefinitions.overrides),
      ),
      '一组选择只能合并相同 relief',
    );
  }
  const selectionOperatorId = operatorId(group);
  const selectionDefinitionId = definitionId(group);
  assert.ok(!program.operators[selectionOperatorId]);
  assert.ok(!document.regionDefinitions[selectionDefinitionId]);
  program.operators[selectionOperatorId] = {
    id: selectionOperatorId,
    type: 'region-select',
    name: group.name,
    enabled: true,
    inputs: { input: [port(hair.partitionId)] },
    params: {
      anchors: clone(group.anchors),
      merge: 'union',
      coverage: 'one-per-anchor',
    },
  };
  document.regionDefinitions[selectionDefinitionId] = {
    id: selectionDefinitionId,
    context: {
      ownerNodeId: hair.ownerNodeId,
      operatorId: selectionOperatorId,
      port: 'regions',
      instances: [],
    },
    selector: { kind: 'result', role: 'selection' },
  };
  const target = ref(selectionOperatorId, selectionDefinitionId);
  remaps.push({ group, oldRefs, target, appearance, relief });
}

const oldKeys = new Set(
  remaps.flatMap((item) => item.oldRefs.map(outputIdentity)),
);
for (const [id, record] of Object.entries(document.appearances.overrides))
  if (oldKeys.has(outputIdentity(record.target)))
    delete document.appearances.overrides[id];
for (const [id, record] of Object.entries(document.reliefDefinitions.overrides))
  if (oldKeys.has(outputIdentity(record.target)))
    delete document.reliefDefinitions.overrides[id];
for (const { group, oldRefs, target, appearance, relief } of remaps) {
  document.appearances.overrides[`appearance:author-hair-${group.suffix}`] = {
    id: `appearance:author-hair-${group.suffix}`,
    target: clone(target),
    value: clone(appearance),
  };
  document.reliefDefinitions.overrides[`relief:author-hair-${group.suffix}`] = {
    id: `relief:author-hair-${group.suffix}`,
    target: clone(target),
    value: clone(relief),
  };
  for (const oldRef of oldRefs) delete document.regionDefinitions[oldRef.key];
}
collect.inputs.input.splice(
  hair.collectInputIndex,
  1,
  ...hair.groups.map((group) => port(operatorId(group))),
);
collect.params = { disjointSelections: true };

const planar = evaluatePlanar(document);
const attachedHair =
  planar.components[`operator:${hair.partitionId}`].ports.regions;
assert.equal(
  attachedHair.status,
  'ready',
  JSON.stringify(attachedHair.diagnostics),
);
assert.equal(
  attachedHair.value.regions.length,
  baselineHair.value.regions.length,
);
assert.ok(
  union(baselineHair.value.regions)
    .symDifference(union(attachedHair.value.regions))
    .getArea() <= 1e-7,
  '显式接边必须保持整个头发分区的几何',
);
assert.deepEqual(
  partition.inputs.cutter[0].transform,
  [1, 0, 0, 1, 0, 0],
  '显式接边不应引入 node pose 偏移',
);
for (const { group, oldRefs, target } of remaps) {
  const stage =
    planar.components[`operator:${target.operatorId}`].ports.regions;
  assert.equal(
    stage.status,
    'ready',
    `${group.name}: ${JSON.stringify(stage.diagnostics)}`,
  );
  assert.equal(
    stage.value.regions.length,
    1,
    `${group.name} 应产出一个 named result`,
  );
  assert.equal(
    outputIdentity(stage.value.regions[0].ref),
    outputIdentity(target),
  );
  const expected = union(oldRefs.map((item) => baselineById.get(item.key)));
  assert.ok(
    expected
      .symDifference(readGeometry(stage.value.regions[0].geometry))
      .getArea() <= 1e-7,
    `${group.name} 的合并几何必须等于旧选择的并集`,
  );
}
const rebuiltSnapshot = await evaluateDocument(document);
const rebuiltBodies = bodySummary(rebuiltSnapshot);
const meshToleranceMM = Math.min(
  document.geometrySettings.curveToleranceMM / 3,
  0.005,
);
const cleanupRadiusMM = document.manufacturing.cleanupRadiusMM ?? 0;
const oldBodyRoute = await buildBodies(
  rebuiltSnapshot.placedRelief,
  undefined,
  meshToleranceMM,
  cleanupRadiusMM,
);
const newCleanup = cleanPlacedRelief(
  rebuiltSnapshot.placedRelief,
  cleanupRadiusMM,
);
const newBodyRoute = await buildBodies(
  newCleanup,
  undefined,
  meshToleranceMM,
  cleanupRadiusMM,
);
const oldRouteSummary = bodySummary({ bodies: oldBodyRoute });
const newRouteSummary = bodySummary({ bodies: newBodyRoute });
assert.deepEqual(
  newRouteSummary,
  oldRouteSummary,
  'cleanup 拆分前后实体与分色体积必须完全一致',
);
close(
  rebuiltBodies.volumeMM3,
  baselineBodies.volumeMM3,
  '重建前后实体总体积必须一致',
);
for (const [color, volume] of Object.entries(baselineBodies.materialsMM3))
  close(
    rebuiltBodies.materialsMM3[color],
    volume,
    `颜色 ${color} 的体积必须一致`,
  );

const reopened = decodeDocument(
  encodeDocument(document, { assets: original.assets }),
);
assert.deepEqual(reopened.document, document, '容器往返必须保留显式选择模型');
const movedSession = createEditorSession(reopened.document);
const revisionBeforeMove = movedSession.state.revision;
movedSession.dispatch(
  createSourceCommand({ kind: 'set-vertex', ...hair.changedVertex }),
  { expectedRevision: movedSession.state.revision },
);
assert.equal(
  movedSession.state.revision,
  revisionBeforeMove + 1,
  '源点编辑必须只提交一个历史步骤',
);
const movedSnapshot = await evaluateDocument(movedSession.state.document);
const movedBodies = bodySummary(movedSnapshot);
for (const { group, target, relief } of remaps) {
  const match = movedSnapshot.relief.value.reliefs.filter(
    (item) => outputIdentity(item.ref) === outputIdentity(target),
  );
  assert.equal(match.length, 1, `${group.name} 在拖点后必须保持一个结果`);
  assert.deepEqual(match[0].thickness, relief.thickness);
  assert.deepEqual(match[0].placement, relief.placement);
}
assert.deepEqual(
  decodeDocument(
    encodeDocument(movedSession.state.document, { assets: original.assets }),
  ).document,
  movedSession.state.document,
  '拖点后的显式选择模型必须可重开',
);
movedSession.undo({ expectedRevision: movedSession.state.revision });
assert.deepEqual(
  movedSession.state.document,
  reopened.document,
  '一次 undo 必须恢复拖点前的显式选择文档',
);
const undonePlanar = evaluatePlanar(movedSession.state.document);
for (const { group, target } of remaps) {
  const before =
    planar.components[`operator:${target.operatorId}`].ports.regions.value
      .regions[0];
  const undone =
    undonePlanar.components[`operator:${target.operatorId}`].ports.regions.value
      .regions[0];
  assert.ok(
    readGeometry(before.geometry)
      .symDifference(readGeometry(undone.geometry))
      .getArea() <= 1e-7,
    `${group.name} 的一次 undo 必须恢复选择几何`,
  );
}
const undoneBodies = bodySummary(
  await evaluateDocument(movedSession.state.document),
);
assert.deepEqual(
  undoneBodies,
  rebuiltBodies,
  '一次 undo 必须恢复拖点前的实体与分色体积',
);

const output = encodeDocument(document, { assets: original.assets });
await writeFile(outputPath, output);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const report = {
  input: inputPath,
  output: outputPath,
  sha256: sha256(output),
  selectionGroups: remaps.map(({ group, target }) => ({
    name: group.name,
    anchors: group.anchors,
    result: target,
  })),
  baselineBodies,
  rebuiltBodies,
  initialVolumeComparison: {
    deltaMM3: rebuiltBodies.volumeMM3 - baselineBodies.volumeMM3,
    toleranceMM3: toleranceFor(
      rebuiltBodies.volumeMM3,
      baselineBodies.volumeMM3,
    ),
    materials: Object.fromEntries(
      Object.entries(baselineBodies.materialsMM3).map(([color, volume]) => [
        color,
        {
          deltaMM3: rebuiltBodies.materialsMM3[color] - volume,
          toleranceMM3: toleranceFor(rebuiltBodies.materialsMM3[color], volume),
        },
      ]),
    ),
  },
  bodyRoutes: {
    beforePostPlanSplit: oldRouteSummary,
    afterPostPlanSplit: newRouteSummary,
  },
  movedBodies,
  undoneBodies,
  assertions: {
    explicitEndpointAttachmentEqualsImplicitPartitionGeometry: true,
    initialSelectionGeometryEqualsOldGroupedUnion: true,
    initialBodyAndMaterialVolumesWithinTolerance: true,
    cleanupSplitKeepsValidBodiesAndVolumesExactlyEqual: true,
    editedPartitionSelectionAndBodiesReady: true,
    oneUndoRestoresSelectionGeometryAndBodies: true,
    encodeDecodeEqualBeforeAndAfterEdit: true,
  },
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
