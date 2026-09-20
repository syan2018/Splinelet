import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { createModelPropertyCommand } from '../../../src/lib/editor/model-properties.mjs';

let serial = 0;
const context = (revision = 4) => ({
  epoch: 'property-epoch',
  revision,
  idFactory: () => `property-${++serial}`,
});
const commit = (document, action) =>
  createAuthoringCommand(action)(document, context()).document;

let document = createDocument();
document.appearances.swatches.red = {
  id: 'red',
  name: '红色',
  color: '#ff0000',
};
document = commit(document, {
  kind: 'draw-path',
  name: '双区域',
  closed: true,
  points: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
});
const owner = Object.values(document.nodes).find(
  (node) => node.name === '双区域',
).id;
document = commit(document, {
  kind: 'draw-path',
  ownerNodeId: owner,
  name: '第二轮廓',
  closed: true,
  points: [
    [20, 0],
    [30, 0],
    [30, 10],
    [20, 10],
  ],
});
const stage = evaluateProgram(document, owner).regions;
assert.equal(stage.status, 'ready');
assert.equal(stage.value.regions.length, 2);
const view = {
  epoch: 'property-epoch',
  revision: 4,
  previewId: null,
  regions: stage.value.regions.map((region, index) => ({
    id: `region-${index}`,
    objectId: owner,
    outputRef: region.ref,
  })),
};

const color = createModelPropertyCommand(
  'set-region-swatch',
  { regionId: 'region-0', swatchId: 'red' },
  view,
);
const colorResult = color(document, context());
assert.equal(colorResult.changedRefs.length, 1);
assert.equal(Object.keys(document.appearances.overrides).length, 1);
assert.equal(Object.keys(document.reliefDefinitions.overrides).length, 0);
assert.equal(
  Object.values(document.appearances.overrides)[0].value.swatchId,
  'red',
  'color must be an explicit swatch assignment',
);

const regionVisibility = createModelPropertyCommand(
  'set-region-visible',
  { regionId: 'region-0', value: false },
  view,
)(document, context());
assert.equal(
  Object.values(regionVisibility.document.regionPresentations.overrides)[0]
    .visible,
  false,
);
assert.equal(
  document.nodes[owner].visible,
  true,
  'region visibility does not change owner visibility',
);
const visibility = createModelPropertyCommand(
  'set-owner-visible',
  { regionId: 'region-0', scope: 'owner', value: false },
  view,
)(document, context());
assert.deepEqual(visibility.changedRefs, [{ kind: 'node', id: owner }]);
assert.equal(document.nodes[owner].visible, false);
createModelPropertyCommand(
  'set-owner-name',
  { regionId: 'region-1', scope: 'owner', value: '整体新名' },
  view,
)(document, context());
assert.equal(document.nodes[owner].name, '整体新名');

createModelPropertyCommand(
  'set-curve-tolerance',
  { scope: 'document', curveToleranceMM: 0.02 },
  view,
)(document, context());
assert.equal(document.geometrySettings.curveToleranceMM, 0.02);
createModelPropertyCommand(
  'set-manufacturing-cleanup',
  { scope: 'document', cleanupRadiusMM: 0.02 },
  view,
)(document, context());
assert.equal(document.manufacturing.cleanupRadiusMM, 0.02);
createModelPropertyCommand(
  'set-model-options',
  {
    scope: 'document',
    curveToleranceMM: 0.01,
    cleanupRadiusMM: 0.04,
  },
  view,
)(document, context());
assert.equal(document.geometrySettings.curveToleranceMM, 0.01);
assert.equal(document.manufacturing.cleanupRadiusMM, 0.04);
const beforeInvalidOptions = structuredClone(document);
assert.throws(
  () =>
    createModelPropertyCommand(
      'set-model-options',
      {
        scope: 'document',
        curveToleranceMM: 0.03,
        cleanupRadiusMM: -1,
      },
      view,
    )(document, context()),
  /cleanupRadiusMM/,
);
assert.deepEqual(
  document,
  beforeInvalidOptions,
  'combined model options validate atomically before either write',
);
assert.throws(
  () =>
    createModelPropertyCommand(
      'set-region-swatch',
      { regionId: 'region-0', swatchId: 'red' },
      view,
    )(document, context(5)),
  /已过期/,
);

console.log('PASS model properties preserve V4 assignment and owner scopes');
