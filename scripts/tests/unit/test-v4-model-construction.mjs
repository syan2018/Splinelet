import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createRegionPresentationCommand } from '../../../src/lib/editing/commands/region-presentations.mjs';
import {
  createModelRegionDeletionCommand,
  createModelReliefRebindCommand,
  finalizePreparedModelConstruction,
  inspectModelRegionDeletion,
  previewModelConstruction,
} from '../../../src/lib/editor/model-construction.mjs';
import { createRegionContribution } from '../../../src/lib/editor/model-contributions.mjs';

let serial = 0;
const context = () => ({ idFactory: () => `model-construction-${++serial}` });
const commit = (document, action) =>
  createAuthoringCommand(action)(document, context()).document;
const pathRefs = (document) =>
  Object.values(document.sketches).flatMap((sketch) =>
    Object.values(sketch.paths).map((path) => ({
      id: path.id,
      ref: { kind: 'path', sketchId: sketch.id, id: path.id },
    })),
  );
const regions = (document, ownerNodeId) => {
  const stage = evaluateProgram(document, ownerNodeId).regions;
  assert.equal(stage.status, 'ready');
  return stage.value.regions;
};
const owner = (document, name) =>
  Object.values(document.nodes).find((node) => node.name === name)?.id;

let document = createDocument({ version: 4 });
document = commit(document, {
  kind: 'draw-path',
  name: '轮廓',
  closed: true,
  points: [
    [0, 0],
    [20, 0],
    [20, 20],
    [0, 20],
  ],
});
const shape = owner(document, '轮廓');
const firstPath = pathRefs(document)[0];

const strokePreview = previewModelConstruction(
  document,
  { kind: 'stroke', pathId: firstPath.id, widthMM: 2 },
  { paths: { [firstPath.id]: firstPath.ref } },
  context(),
);
assert.equal(strokePreview.candidates.length, 1);
assert.equal(
  document.programs[document.nodes[shape].programId].operators[
    strokePreview.candidates[0].outputRef.operatorId
  ],
  undefined,
  'preview must not mutate the input Document',
);
const strokeResult = strokePreview.command(document, context());
assert.equal(strokeResult.changedRefs.length, 1);
assert.equal(regions(document, shape).length, 2);

let betweenDocument = createDocument({ version: 4 });
betweenDocument = commit(betweenDocument, {
  kind: 'draw-path',
  name: '母线',
  closed: false,
  points: [
    [0, 0],
    [20, 0],
  ],
});
const betweenOwner = owner(betweenDocument, '母线');
betweenDocument = commit(betweenDocument, {
  kind: 'draw-path',
  ownerNodeId: betweenOwner,
  name: '边线',
  closed: false,
  points: [
    [20, 10],
    [0, 10],
  ],
});
const [a, b] = pathRefs(betweenDocument);
const betweenPreview = previewModelConstruction(
  betweenDocument,
  { kind: 'between', pathIds: [a.id, b.id] },
  { paths: { [a.id]: a.ref, [b.id]: b.ref } },
  context(),
);
assert.equal(betweenPreview.candidates.length, 1);
betweenPreview.command(betweenDocument, context());
assert.equal(regions(betweenDocument, betweenOwner).length, 1);

let splitDocument = createDocument({ version: 4 });
splitDocument = commit(splitDocument, {
  kind: 'draw-path',
  name: '待分区',
  closed: true,
  points: [
    [0, 0],
    [20, 0],
    [20, 20],
    [0, 20],
  ],
});
const splitOwner = owner(splitDocument, '待分区');
splitDocument = commit(splitDocument, {
  kind: 'draw-path',
  name: '分割线',
  closed: false,
  points: [
    [10, 0.1],
    [10, 19.9],
  ],
});
const splitPaths = pathRefs(splitDocument);
const divider = splitPaths.find((item) => item.id !== splitPaths[0].id);
const splitBase = regions(splitDocument, splitOwner)[0].ref;
const splitSketchBefore = structuredClone(
  splitDocument.sketches[divider.ref.sketchId],
);
const dividerOwner = owner(splitDocument, '分割线');
const dividerOutputBefore = structuredClone(
  splitDocument.programs[splitDocument.nodes[dividerOwner].programId].outputs,
);
const splitPreview = previewModelConstruction(
  splitDocument,
  { kind: 'split', baseRef: splitBase, pathIds: [divider.id], joinMM: 0.15 },
  { paths: { [divider.id]: divider.ref } },
  context(),
);
assert.equal(splitPreview.candidates.length, 2);
assert.equal(
  splitPreview.diagnostics.filter(
    (item) => item.code === 'partition-endpoint-connected',
  ).length,
  2,
  'preview exposes the partition evaluator endpoint diagnostics unchanged',
);
const splitCommitted = splitPreview.command(splitDocument, context());
const splitDerivedOwner = splitCommitted.changedRefs[0].ownerNodeId;
assert.equal(regions(splitDocument, splitOwner).length, 1);
assert.ok(
  regions(splitDocument, splitOwner).some(
    (region) => JSON.stringify(region.ref) === JSON.stringify(splitBase),
  ),
  'split keeps its base published for later bottom-plate authoring',
);
assert.equal(regions(splitDocument, splitDerivedOwner).length, 2);
assert.deepEqual(
  splitDocument.sketches[divider.ref.sketchId],
  splitSketchBefore,
  'derived split never copies or mutates the cutter Sketch',
);
assert.deepEqual(
  splitDocument.programs[splitDocument.nodes[dividerOwner].programId].outputs,
  dividerOutputBefore,
  'the cutter owner gains an unpublished Source branch only',
);
const splitPartition = Object.values(
  splitDocument.programs[splitDocument.nodes[splitDerivedOwner].programId]
    .operators,
).find((item) => item.type === 'partition');
assert.deepEqual(splitPartition.params.endpointJoin, {
  toleranceMM: 0.15,
  disabled: [],
  cohorts: [[divider.id]],
});
splitDocument = createAuthoringCommand({
  kind: 'set-relief',
  target: splitBase,
  value: { enabled: true },
})(splitDocument, context()).document;
assert.ok(
  Object.values(splitDocument.reliefDefinitions.overrides).some(
    (item) => JSON.stringify(item.target) === JSON.stringify(splitBase),
  ),
  'the preserved base accepts a new relief after the derived split',
);

let booleanDocument = createDocument({ version: 4 });
booleanDocument = commit(booleanDocument, {
  kind: 'draw-path',
  name: '底面',
  closed: true,
  points: [
    [0, 0],
    [20, 0],
    [20, 20],
    [0, 20],
  ],
});
booleanDocument = commit(booleanDocument, {
  kind: 'draw-path',
  name: '切面',
  closed: true,
  points: [
    [10, 0],
    [30, 0],
    [30, 20],
    [10, 20],
  ],
});
const baseOwner = owner(booleanDocument, '底面');
const operandOwner = owner(booleanDocument, '切面');
const base = regions(booleanDocument, baseOwner)[0].ref;
const operand = regions(booleanDocument, operandOwner)[0].ref;
const booleanPreview = previewModelConstruction(
  booleanDocument,
  { kind: 'difference', baseRef: base, operandRef: operand },
  {},
  context(),
);
assert.equal(booleanPreview.candidates.length, 1);
booleanPreview.command(booleanDocument, context());
assert.equal(regions(booleanDocument, baseOwner).length, 1);
assert.equal(regions(booleanDocument, operandOwner).length, 1);
assert.ok(
  regions(booleanDocument, baseOwner).some(
    (region) => JSON.stringify(region.ref) === JSON.stringify(base),
  ),
  'boolean keeps the original base OutputRef published',
);
assert.ok(
  regions(booleanDocument, operandOwner).some(
    (region) => JSON.stringify(region.ref) === JSON.stringify(operand),
  ),
  'boolean keeps the original operand OutputRef published',
);
assert.equal(
  Object.values(booleanDocument.nodes).filter((node) => node.kind === 'shape')
    .length,
  3,
  'boolean publishes a derived Shape instead of replacing either source',
);

const splitFixture = () => {
  let value = createDocument({ version: 4 });
  value = commit(value, {
    kind: 'draw-path',
    name: '可选分区',
    closed: true,
    points: [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
    ],
  });
  const shapeId = owner(value, '可选分区');
  value = commit(value, {
    kind: 'draw-path',
    ownerNodeId: shapeId,
    name: '候选分割线',
    closed: false,
    points: [
      [10, 0],
      [10, 20],
    ],
  });
  const paths = pathRefs(value);
  return {
    document: value,
    ownerNodeId: shapeId,
    base: regions(value, shapeId)[0].ref,
    divider: paths.find((item) => item.id !== paths[0].id),
  };
};

const subsetFixture = splitFixture();
const subsetPreview = previewModelConstruction(
  subsetFixture.document,
  {
    kind: 'split',
    baseRef: subsetFixture.base,
    pathIds: [subsetFixture.divider.id],
    joinMM: 0.15,
  },
  { paths: { [subsetFixture.divider.id]: subsetFixture.divider.ref } },
  context(),
);
const subset = finalizePreparedModelConstruction(
  subsetPreview,
  { indices: [0], name: '保留左区' },
  context(),
);
assert.equal(regions(subset.document, subsetFixture.ownerNodeId).length, 1);
assert.equal(subset.changedRefs.length, 1);
assert.equal(
  regions(subset.document, subset.changedRefs[0].ownerNodeId).length,
  1,
  'candidate subset applies to the derived split only',
);
assert.equal(
  Object.values(subset.document.regionPresentations.overrides)[0].name,
  '保留左区',
  'subset commit names the canonical selected OutputRef',
);

const rebindFixture = splitFixture();
rebindFixture.document = createAuthoringCommand({
  kind: 'set-relief',
  target: rebindFixture.base,
  value: { enabled: true },
})(rebindFixture.document, context()).document;
const rebindPreview = previewModelConstruction(
  rebindFixture.document,
  {
    kind: 'split',
    baseRef: rebindFixture.base,
    pathIds: [rebindFixture.divider.id],
    joinMM: 0.15,
  },
  { paths: { [rebindFixture.divider.id]: rebindFixture.divider.ref } },
  context(),
);
const rebound = finalizePreparedModelConstruction(
  rebindPreview,
  { indices: [0], replaceTarget: rebindFixture.base, name: '替换区域' },
  context(),
);
const reboundAssignments = Object.values(
  rebound.document.reliefDefinitions.overrides,
);
assert.equal(reboundAssignments.length, 1);
assert.deepEqual(reboundAssignments[0].target, rebound.changedRefs[0]);
assert.ok(
  regions(rebound.document, rebindFixture.ownerNodeId).some(
    (region) =>
      JSON.stringify(region.ref) === JSON.stringify(rebindFixture.base),
  ),
  'replacing the preview target does not erase the retained split base',
);
assert.equal(
  Object.values(rebound.document.regionPresentations.overrides)[0].name,
  '替换区域',
);

let deletionDocument = createDocument({ version: 4 });
deletionDocument = commit(deletionDocument, {
  kind: 'draw-path',
  name: '保留源 Sketch',
  closed: true,
  points: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
});
const deletionOwner = owner(deletionDocument, '保留源 Sketch');
deletionDocument = commit(deletionDocument, {
  kind: 'draw-path',
  ownerNodeId: deletionOwner,
  name: '待删区域',
  closed: true,
  points: [
    [20, 0],
    [30, 0],
    [30, 10],
    [20, 10],
  ],
});
const deletionTarget = regions(deletionDocument, deletionOwner)[0].ref;
const retainedSource = regions(deletionDocument, deletionOwner)[1].ref;
const deletionSketchIds = Object.keys(deletionDocument.sketches).sort();
deletionDocument = createAuthoringCommand({
  kind: 'set-relief',
  target: deletionTarget,
  value: { enabled: true },
})(deletionDocument, context()).document;
const retainedConsumer = createRegionContribution(
  deletionDocument,
  retainedSource,
  { enabled: true },
  { partId: deletionDocument.manufacturing.defaultPartId },
  context(),
);
deletionDocument = retainedConsumer.document;
deletionDocument = createRegionPresentationCommand({
  kind: 'set-region-presentation',
  target: retainedConsumer.target,
  value: { name: '保留消费者' },
})(deletionDocument, context()).document;
assert.throws(
  () =>
    createModelRegionDeletionCommand([deletionTarget])(
      structuredClone(deletionDocument),
      context(),
    ),
  /浮雕赋值会失去目标/,
);
const deleted = createModelRegionDeletionCommand([deletionTarget], {
  discardAssignments: true,
})(deletionDocument, context());
assert.equal(regions(deleted.document, deletionOwner).length, 1);
const retainedOutput = regions(deleted.document, deletionOwner)[0].ref;
const retainedConsumerOwner = retainedConsumer.target.ownerNodeId;
const retainedConsumerProgram =
  deleted.document.programs[
    deleted.document.nodes[retainedConsumerOwner].programId
  ];
const retainedConsumerOperator =
  retainedConsumerProgram.operators[
    retainedConsumerProgram.outputs.regions.operatorId
  ];
assert.deepEqual(retainedConsumerOperator.params.scope.refs, [retainedOutput]);
assert.deepEqual(
  retainedConsumerOperator.inputs.input[0].operatorId,
  deleted.document.programs[deleted.document.nodes[deletionOwner].programId]
    .outputs.regions.operatorId,
  'external consumer input follows the newly published selector',
);
const retainedConsumerStage = evaluateProgram(
  deleted.document,
  retainedConsumerOwner,
).regions;
assert.equal(retainedConsumerStage.status, 'ready');
const retainedConsumerOutput = retainedConsumerStage.value.regions[0].ref;
assert.ok(
  Object.values(deleted.document.reliefDefinitions.overrides).some(
    (record) =>
      JSON.stringify(record.target) === JSON.stringify(retainedConsumerOutput),
  ),
  'consumer relief authoring follows its changed OutputRef',
);
assert.ok(
  Object.values(deleted.document.manufacturing.assignments).some(
    (record) =>
      JSON.stringify(record.target) === JSON.stringify(retainedConsumerOutput),
  ),
  'consumer manufacturing assignment follows its changed OutputRef',
);
assert.equal(
  Object.values(deleted.document.regionPresentations.overrides).find(
    (record) =>
      JSON.stringify(record.target) === JSON.stringify(retainedConsumerOutput),
  )?.name,
  '保留消费者',
);
assert.deepEqual(
  Object.keys(deleted.document.sketches).sort(),
  deletionSketchIds,
  'deleting a region retains its source Sketch',
);

let firstReliefDocument = createDocument({ version: 4 });
firstReliefDocument = commit(firstReliefDocument, {
  kind: 'draw-path',
  name: '首体块旧来源',
  closed: true,
  points: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
});
firstReliefDocument = commit(firstReliefDocument, {
  kind: 'draw-path',
  ownerNodeId: owner(firstReliefDocument, '首体块旧来源'),
  name: '首体块新来源',
  closed: true,
  points: [
    [20, 0],
    [30, 0],
    [30, 10],
    [20, 10],
  ],
});
const firstOldOwner = owner(firstReliefDocument, '首体块旧来源');
const [firstOldRegion, firstNewRegion] = regions(
  firstReliefDocument,
  firstOldOwner,
);
const firstOldRef = firstOldRegion.ref;
const firstNewRef = firstNewRegion.ref;
firstReliefDocument.reliefDefinitions.defaults[firstOldOwner] = {
  enabled: true,
  thickness: { kind: 'mm', value: 2.75 },
  mode: 'add',
  placement: { kind: 'free', zMM: 0 },
};
const firstSwatchId = 'first-rebind-swatch';
firstReliefDocument.appearances.swatches[firstSwatchId] = {
  id: firstSwatchId,
  name: '首体块颜色',
  color: '#336699',
};
firstReliefDocument.appearances.defaults[firstOldOwner] = {
  swatchId: firstSwatchId,
};
firstReliefDocument = createRegionPresentationCommand({
  kind: 'set-region-presentation',
  target: firstOldRef,
  value: { name: '首体块作者态' },
})(firstReliefDocument, context()).document;
const firstReliefRebound = createModelReliefRebindCommand(
  firstOldRef,
  firstNewRef,
)(firstReliefDocument, context());
assert.ok(
  regions(firstReliefRebound.document, firstOldOwner).some(
    (region) => JSON.stringify(region.ref) === JSON.stringify(firstOldRef),
  ),
  'ordinary rebind retains the old source geometry',
);
assert.equal(
  Object.values(firstReliefRebound.document.reliefDefinitions.overrides).find(
    (record) => JSON.stringify(record.target) === JSON.stringify(firstOldRef),
  )?.suppressed,
  true,
);
const firstConsumerRef = firstReliefRebound.changedRefs[0];
const firstConsumerRelief = Object.values(
  firstReliefRebound.document.reliefDefinitions.overrides,
).find(
  (record) =>
    JSON.stringify(record.target) === JSON.stringify(firstConsumerRef) &&
    !record.suppressed,
);
assert.equal(firstConsumerRelief?.value.thickness.value, 2.75);
assert.ok(
  Object.values(firstReliefRebound.document.manufacturing.assignments).some(
    (record) =>
      JSON.stringify(record.target) === JSON.stringify(firstConsumerRef) &&
      record.partId === firstReliefDocument.manufacturing.defaultPartId,
  ),
);
assert.equal(
  Object.values(firstReliefRebound.document.regionPresentations.overrides).find(
    (record) => JSON.stringify(record.target) === JSON.stringify(firstOldRef),
  )?.name,
  '首体块作者态',
);
const firstConsumerOwner = firstConsumerRef.ownerNodeId;
assert.equal(
  firstReliefRebound.document.appearances.defaults[firstConsumerOwner]
    ?.swatchId,
  firstSwatchId,
);
assert.equal(
  firstReliefRebound.document.appearances.defaults[firstOldOwner]?.swatchId,
  firstSwatchId,
);

let contributionDocument = createDocument({ version: 4 });
contributionDocument = commit(contributionDocument, {
  kind: 'draw-path',
  name: '旧来源',
  closed: true,
  points: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
});
contributionDocument = commit(contributionDocument, {
  kind: 'draw-path',
  name: '新来源',
  closed: true,
  points: [
    [20, 0],
    [30, 0],
    [30, 10],
    [20, 10],
  ],
});
const oldSource = owner(contributionDocument, '旧来源');
const newSource = owner(contributionDocument, '新来源');
const oldSourceRef = regions(contributionDocument, oldSource)[0].ref;
const newSourceRef = regions(contributionDocument, newSource)[0].ref;
const contribution = createRegionContribution(
  contributionDocument,
  oldSourceRef,
  { enabled: true },
  {},
  context(),
);
const contributionDependencies = inspectModelRegionDeletion(
  contribution.document,
  [oldSourceRef],
);
assert.equal(contributionDependencies.programScopes.length, 1);
assert.throws(
  () =>
    createModelRegionDeletionCommand([oldSourceRef], {
      discardAssignments: true,
    })(structuredClone(contribution.document), context()),
  /仍有作者态消费者引用将删除的区域/,
  'deletion must not leave an independent consumer bound to a removed OutputRef',
);
const reliefRebound = createModelReliefRebindCommand(
  contribution.target,
  newSourceRef,
)(contribution.document, context());
const contributionOwner = reliefRebound.changedRefs[0].ownerNodeId;
const contributionProgram =
  contribution.document.programs[
    contribution.document.nodes[contributionOwner].programId
  ];
assert.deepEqual(
  contributionProgram.operators[contributionProgram.outputs.regions.operatorId]
    .params.scope.refs,
  [newSourceRef],
);
assert.deepEqual(
  Object.values(reliefRebound.document.reliefDefinitions.overrides)[0].target,
  reliefRebound.changedRefs[0],
  'single relief rebind migrates only the consumer authoring state',
);

console.log(
  'PASS model construction preview/commit uses canonical programs only',
);
