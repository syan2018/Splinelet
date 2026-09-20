import assert from 'node:assert/strict';
import {
  compileModelFeatureChange,
  projectModelPanel,
} from '../../../src/lib/editor/model-panel-adapter.mjs';
import { creationCellKey } from '../../../src/lib/editor/creation-view.mjs';

const output = (ownerNodeId, key) => ({
  kind: 'output',
  ownerNodeId,
  operatorId: `${ownerNodeId}-fill`,
  port: 'regions',
  key,
  instances: [],
  lineage: [`${ownerNodeId}-source`],
});
const geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 0],
    ],
  ],
};
const ready = (value) => ({ status: 'ready', value, diagnostics: [] });
const blocked = (message) => ({
  status: 'blocked',
  diagnostics: [{ message }],
});
const relief = ({
  enabled = false,
  mode = 'add',
  thickness = { kind: 'mm', value: 2 },
  placement = { kind: 'free', zMM: 0 },
} = {}) => ready({ enabled, mode, thickness, placement });
const region = (name, authoredRelief, options = {}) => {
  const outputRef = output(
    options.ownerNodeId || `node-${name}`,
    `key-${name}`,
  );
  return {
    id: creationCellKey(outputRef),
    key: creationCellKey(outputRef),
    name: options.name || `区域 ${name}`,
    color: options.color || '#1177aa',
    outputRef,
    geometry,
    areaMM2: 4,
    components: 1,
    holes: 0,
    reliefDefined: options.reliefDefined ?? true,
    authoredRelief,
    part: options.part || { status: 'ready', id: 'main' },
  };
};

const target = region('target', relief({ enabled: true }));
const disabled = region('disabled', relief({ enabled: false }));
const cut = region(
  'cut',
  relief({
    enabled: true,
    mode: 'cut',
    thickness: { kind: 'mm', value: 2 },
    placement: { kind: 'free', zMM: 5 },
  }),
);
const attached = region(
  'attached',
  relief({
    enabled: true,
    mode: 'cut',
    thickness: { kind: 'mm', value: 2 },
    placement: { kind: 'attached', target: target.outputRef, offsetMM: 4 },
  }),
);
const nodeAttached = region(
  'node-attached',
  relief({
    enabled: true,
    placement: {
      kind: 'attached',
      target: { kind: 'node', id: 'node-target' },
      offsetMM: 1,
    },
  }),
);
const layered = region(
  'layered',
  relief({
    enabled: true,
    thickness: { kind: 'layers', count: 2 },
    placement: { kind: 'layer', layerId: 'layer-1', offsetMM: 0 },
  }),
);
const blockedPart = region('blocked-part', relief({ enabled: true }), {
  part: { status: 'blocked', message: '同一输出存在多个制造 Part 赋值' },
});
const conflicting = region(
  'conflicting',
  blocked('同一输出存在多个 relief override'),
  {
    reliefDefined: true,
  },
);
const implicitDisabled = region(
  'implicit-disabled',
  relief({ enabled: false }),
  {
    reliefDefined: false,
  },
);
const view = {
  geometrySettings: { curveToleranceMM: 0.015 },
  cleanupRadiusMM: 0.03,
  layerHeightMM: 0.2,
  slicerTemplate: { version: 1, kind: 'bambu', name: 'profile' },
  parts: [{ id: 'main', name: '主体' }],
  creation: {
    creation: {
      objects: [
        { id: 'node-target', name: '节点目标' },
        { id: 'node-target-2', name: '另一个节点' },
      ],
    },
  },
  regions: [
    target,
    disabled,
    cut,
    attached,
    nodeAttached,
    layered,
    blockedPart,
    conflicting,
    implicitDisabled,
  ],
};
const beforeView = structuredClone(view);
const panel = projectModelPanel(view);

assert.equal(panel.model.version, 1);
assert.equal(panel.model.toleranceMM, 0.015);
assert.equal(panel.model.manufacturingMM, 0.03);
assert.deepEqual(panel.model.parts, [{ id: 'main', name: '主体' }]);
assert.deepEqual(panel.model.regions[0], {
  id: target.id,
  name: '区域 target',
  color: '#1177aa',
  kind: 'output',
  visible: true,
});
assert.equal(
  panel.model.regions.some((item) => 'pathId' in item || 'a' in item),
  false,
  'evaluated output cells do not impersonate legacy construction recipes',
);
assert.deepEqual(view, beforeView, 'read projection does not write the view');
assert.ok(Object.isFrozen(panel));
assert.ok(Object.isFrozen(panel.model.features));
assert.throws(() => {
  panel.model.features[0].enabled = false;
}, TypeError);

const feature = (id) => panel.model.features.find((item) => item.id === id);
assert.equal(
  feature(disabled.id).enabled,
  false,
  'defined disabled relief stays visible',
);
assert.equal(feature(implicitDisabled.id), undefined);
assert.equal(feature(cut.id).zMM, 7, 'cut reads canonical bottom as old top');
assert.equal(
  feature(attached.id).zMM,
  6,
  'attached cut offset reads as old top',
);
assert.equal(feature(attached.id).attachId, target.id);
assert.equal(feature(attached.id).attachmentLabel, '区域 target');
assert.equal(feature(nodeAttached.id).attachId, 'node:node-target');
assert.equal(feature(nodeAttached.id).attachmentLabel, '节点目标');
assert.deepEqual(
  {
    heightMM: feature(layered.id).heightMM,
    heightLayers: feature(layered.id).heightLayers,
  },
  { heightMM: 0.4, heightLayers: 2 },
  'layer placement projects integer print layers as authoritative',
);
assert.equal(
  feature(blockedPart.id),
  undefined,
  'blocked part never chooses a part',
);
assert.match(
  panel.regions.find((item) => item.id === blockedPart.id).error,
  /多个制造 Part/,
);
assert.equal(
  feature(conflicting.id),
  undefined,
  'conflicting relief never becomes a fake feature',
);
assert.match(
  panel.regions.find((item) => item.id === conflicting.id).error,
  /多个 relief override/,
);

const unchanged = structuredClone(view);
const enabledOnly = { enabled: true };
assert.deepEqual(compileModelFeatureChange(view, disabled.id, enabledOnly), {
  regionIds: [disabled.id],
  changes: { enabled: true },
});
assert.deepEqual(enabledOnly, { enabled: true });
assert.deepEqual(view, unchanged, 'compile is a pure adapter');

assert.deepEqual(compileModelFeatureChange(view, cut.id, { heightMM: 4 }), {
  regionIds: [cut.id],
  changes: {
    thickness: { kind: 'mm', value: 4 },
    placement: { kind: 'free', zMM: 3 },
  },
});
assert.deepEqual(compileModelFeatureChange(view, cut.id, { zMM: 10 }), {
  regionIds: [cut.id],
  changes: { placement: { kind: 'free', zMM: 8 } },
});
assert.deepEqual(
  compileModelFeatureChange(view, attached.id, { heightMM: 4 }),
  {
    regionIds: [attached.id],
    changes: {
      thickness: { kind: 'mm', value: 4 },
      placement: {
        kind: 'attached',
        target: target.outputRef,
        offsetMM: 2,
      },
    },
  },
  'attached cut depth retains its top/start offset',
);
assert.deepEqual(
  compileModelFeatureChange(view, attached.id, { attachId: disabled.id }),
  {
    regionIds: [attached.id],
    changes: {
      placement: {
        kind: 'attached',
        target: disabled.outputRef,
        offsetMM: 4,
      },
    },
  },
  'an attachment selects that exact output, never the first feature',
);
assert.deepEqual(
  compileModelFeatureChange(view, nodeAttached.id, { attachId: '' }),
  {
    regionIds: [nodeAttached.id],
    changes: { placement: { kind: 'free', zMM: 1 } },
  },
);
assert.deepEqual(
  compileModelFeatureChange(view, disabled.id, {
    attachId: 'node:node-target',
  }),
  {
    regionIds: [disabled.id],
    changes: {
      placement: {
        kind: 'attached',
        target: { kind: 'node', id: 'node-target' },
        offsetMM: 0,
      },
    },
  },
);
assert.deepEqual(
  compileModelFeatureChange(view, layered.id, { heightMM: 0.6 }),
  {
    regionIds: [layered.id],
    changes: { thickness: { kind: 'layers', count: 3 } },
  },
);
assert.deepEqual(
  compileModelFeatureChange(view, cut.id, { mode: 'add', zMM: 999 }),
  {
    regionIds: [cut.id],
    changes: { mode: 'add', placement: { kind: 'free', zMM: 999 } },
  },
  'a mode change preserves the old panel coordinate when it explicitly supplies one',
);
assert.deepEqual(
  compileModelFeatureChange(view, cut.id, { regionId: cut.id }),
  {
    regionIds: [cut.id],
    changes: {},
  },
);

for (const changes of [
  { name: 'renamed' },
  { color: '#000000' },
  { partId: 'main' },
  { regionId: disabled.id },
  { heightMM: -1 },
  { heightLayers: 1.5 },
])
  assert.throws(() => compileModelFeatureChange(view, cut.id, changes));
assert.throws(() => compileModelFeatureChange(view, layered.id, { zMM: 2 }));
assert.throws(() =>
  compileModelFeatureChange(view, layered.id, { attachId: '' }),
);
assert.throws(() =>
  compileModelFeatureChange(view, attached.id, { attachId: attached.id }),
);
assert.throws(() =>
  compileModelFeatureChange(view, cut.id, { attachId: 'missing' }),
);
assert.throws(() =>
  compileModelFeatureChange(view, conflicting.id, { enabled: true }),
);
assert.deepEqual(
  view,
  unchanged,
  'all rejected writes leave captured input intact',
);

console.log(
  'PASS V4 model panel adapter projects evaluated outputs and compiles sparse canonical relief patches',
);
