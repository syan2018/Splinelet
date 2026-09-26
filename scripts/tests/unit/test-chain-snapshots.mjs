import assert from 'node:assert/strict';
import { createChainSnapshotStore } from '../../../src/lib/evaluation/chain-snapshots.mjs';

const token = (
  revision,
  previewId = null,
  epoch = 'epoch-a',
  previewVersion = 0,
) => ({
  epoch,
  revision,
  previewId,
  ...(previewId && { previewVersion }),
});
const stage = (status, label) => ({
  domain: 'regions',
  status,
  diagnostics: [],
  dependencies: [],
  ...(status === 'ready' || status === 'empty'
    ? { value: { label, nested: { label } } }
    : {}),
});
const planar = (components) => ({ components });
const ports = (entries) => ({ ports: Object.fromEntries(entries) });

const store = createChainSnapshotStore();
store.update(token(1));
const leftReady = stage('ready', 'left-v1');
const rightReady = stage('ready', 'right-v1');
assert.equal(
  store.accept(
    token(1),
    planar({
      'operator:left': ports([['regions', leftReady]]),
      'operator:right': ports([['regions', rightReady]]),
    }),
  ),
  true,
);
assert.equal(store.read('operator:left', 'regions').freshness, 'current');
assert.equal(
  store.read('operator:left', 'regions').lastSuccessful.stage,
  leftReady,
  'committed success is retained by reference',
);
assert.equal(
  store.read('operator:left', 'regions').current,
  store.read('operator:left', 'regions').current,
  'repeated reads retain the frozen stage reference without cloning',
);
assert.throws(() => {
  leftReady.value.nested.label = 'mutated';
}, TypeError);

store.update(token(2));
let left = store.read('operator:left', 'regions');
assert.equal(left.current, null, 'a new revision clears current display data');
assert.equal(left.freshness, 'pending');
assert.equal(left.lastSuccessful.stage, leftReady);

const leftBlocked = stage('blocked', 'left-broken');
const rightV2 = stage('ready', 'right-v2');
store.accept(
  token(2),
  planar({
    'operator:left': ports([['regions', leftBlocked]]),
    'operator:right': ports([['regions', rightV2]]),
  }),
);
left = store.read('operator:left', 'regions');
assert.equal(left.current, leftBlocked);
assert.equal(left.freshness, 'stale');
assert.equal(left.lastSuccessful.stage, leftReady);
assert.equal(
  store.read('operator:right', 'regions').lastSuccessful.stage,
  rightV2,
  'one blocked branch does not overwrite another branch history',
);

const leftEmpty = stage('empty', 'no-left-geometry');
store.update(token(3));
store.accept(
  token(3),
  planar({ 'operator:left': ports([['regions', leftEmpty]]) }),
);
left = store.read('operator:left', 'regions');
assert.equal(left.current, leftEmpty);
assert.equal(left.lastSuccessful.stage, leftEmpty);
assert.equal(left.freshness, 'current');

store.update(token(3, 'gesture-1'));
const previewReady = stage('ready', 'preview-only');
store.accept(
  token(3, 'gesture-1'),
  planar({ 'operator:left': ports([['regions', previewReady]]) }),
);
assert.equal(store.read('operator:left', 'regions').current, previewReady);
assert.equal(
  store.read('operator:left', 'regions').lastSuccessful.stage,
  leftEmpty,
  'preview success never changes committed history',
);
store.update(token(3));
assert.equal(store.read('operator:left', 'regions').current, null);
assert.equal(
  store.read('operator:left', 'regions').lastSuccessful.stage,
  leftEmpty,
);

store.update(token(3, 'gesture-2', 'epoch-a', 1));
store.accept(
  token(3, 'gesture-2', 'epoch-a', 1),
  planar({
    'operator:left': ports([['regions', stage('ready', 'preview-v1')]]),
  }),
);
store.update(token(3, 'gesture-2', 'epoch-a', 2));
assert.equal(
  store.accept(
    token(3, 'gesture-2', 'epoch-a', 1),
    planar({
      'operator:left': ports([['regions', stage('ready', 'late-v1')]]),
    }),
  ),
  false,
  'an older response for the same preview cannot replace a newer version',
);
const previewV2 = stage('ready', 'preview-v2');
store.accept(
  token(3, 'gesture-2', 'epoch-a', 2),
  planar({ 'operator:left': ports([['regions', previewV2]]) }),
);
assert.equal(store.read('operator:left', 'regions').current, previewV2);

store.update(token(4));
assert.equal(
  store.accept(
    token(3),
    planar({ 'operator:left': ports([['regions', stage('ready', 'late')]]) }),
  ),
  false,
  'older worker responses cannot replace the current revision',
);
assert.equal(
  store.read('operator:left', 'regions').lastSuccessful.stage,
  leftEmpty,
);

const curveReady = stage('ready', 'curves-only');
store.accept(
  token(4),
  planar({ 'operator:curve': ports([['curves', curveReady]]) }),
);
assert.equal(
  store.read('operator:left', 'regions').lastSuccessful.stage,
  leftEmpty,
  'a partial requested-domain snapshot does not implicitly prune history',
);
assert.equal(store.read('operator:left', 'regions').freshness, 'pending');
store.prune(['operator:curve']);
assert.equal(store.read('operator:left', 'regions').lastSuccessful, null);
assert.equal(store.read('operator:curve', 'curves').current, curveReady);

store.update(token(0, null, 'epoch-b'));
assert.equal(store.read('operator:curve', 'curves').current, null);
assert.equal(store.read('operator:curve', 'curves').lastSuccessful, null);
assert.equal(
  store.accept(
    token(4),
    planar({
      'operator:curve': ports([['curves', stage('ready', 'old-epoch')]]),
    }),
  ),
  false,
);

store.clear();
const cleared = store.read('operator:curve', 'curves');
assert.equal(cleared.current, null);
assert.equal(cleared.lastSuccessful, null);
assert.equal(cleared.currentState, null);
assert.equal(cleared.freshness, 'stale');

store.update(token(0, null, 'mesh-epoch'));
const meshStage = {
  domain: 'bodies',
  status: 'ready',
  diagnostics: [],
  dependencies: [],
  value: { positions: new Float32Array([1, 2, 3]) },
};
store.accept(
  token(0, null, 'mesh-epoch'),
  planar({ 'post:bodies:global': ports([['bodies', meshStage]]) }),
);
meshStage.value.positions[0] = 99;
const meshView = store.read('post:bodies:global', 'bodies');
assert.equal(
  meshView.lastSuccessful.stage.value.positions[0],
  1,
  'store owns its mesh buffer',
);
meshView.lastSuccessful.stage.value.positions[0] = 88;
assert.equal(
  store.read('post:bodies:global', 'bodies').lastSuccessful.stage.value
    .positions[0],
  1,
  'returned mesh buffers cannot alter retained snapshots',
);

console.log('chain snapshot store tests passed');
