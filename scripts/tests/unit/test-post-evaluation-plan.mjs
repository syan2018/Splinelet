import assert from 'node:assert/strict';
import { repeatedRingDocument } from '../fixtures/v4-programs.mjs';
import { createPlanarStageCache } from '../../../src/lib/evaluation/planar-stage-cache.mjs';
import { createPostStageCache } from '../../../src/lib/evaluation/post-evaluation-plan.mjs';
import { evaluateDocument } from '../../../src/lib/evaluation/evaluate-document.mjs';
import { executePostPlanDag } from '../../../src/lib/evaluation/post-plan-executor.mjs';
import {
  buildBodies,
  cleanPlacedRelief,
} from '../../../src/lib/solid/bodies.mjs';

const domains = ['appearance', 'relief', 'placed-relief', 'cleanup', 'bodies'];
await assert.rejects(
  () =>
    executePostPlanDag({
      nodes: [
        {
          id: 'post:missing',
          dependsOn: ['planar:missing'],
          run: () => ({ status: 'ready' }),
        },
      ],
      roots: ['post:missing'],
    }),
  /缺少输入/,
  'compiled plans reject an undeclared external input',
);
await assert.rejects(
  () =>
    executePostPlanDag({
      nodes: [
        { id: 'post:a', dependsOn: ['post:b'], run: () => ({}) },
        { id: 'post:b', dependsOn: ['post:a'], run: () => ({}) },
      ],
      roots: ['post:a'],
    }),
  /依赖环/,
  'compiled plans reject cycles before executing a node',
);
const createFixture = () => {
  const document = repeatedRingDocument();
  document.appearances.swatches.red = {
    id: 'red',
    name: 'Red',
    color: '#ff0000',
  };
  document.appearances.defaults.shape = { swatchId: 'red' };
  document.reliefDefinitions.defaults.shape = {
    enabled: true,
    thickness: { kind: 'mm', value: 1 },
    mode: 'add',
    placement: { kind: 'free', zMM: 0 },
  };
  return document;
};
const resultSummary = (result) => ({
  appearance: result.appearance.status,
  relief: result.relief.status,
  placedRelief: result.placedRelief.status,
  cleanup: result.cleanup.status,
  bodies: result.bodies.status,
  appearances: result.appearance.value?.appearances,
  reliefs: result.relief.value?.reliefs.map(
    ({ geometry: _geometry, ...item }) => item,
  ),
  placed: result.placedRelief.value?.reliefs.map(
    ({ geometry: _geometry, ...item }) => item,
  ),
  cleaned: result.cleanup.value?.reliefs.map(
    ({ geometry: _geometry, ...item }) => item,
  ),
  reports: result.bodies.value?.bodies.map((body) => ({
    partId: body.partId,
    report: body.report,
    sources: body.sources,
  })),
});

const document = createFixture();
const postStageCache = createPostStageCache();
const options = {
  requestedDomains: domains,
  planarStageCache: createPlanarStageCache(),
  postStageCache,
};
const cold = await evaluateDocument(document, options);
// The planar cache canonicalizes its first component result after the first
// request. The next request establishes that stable input identity.
await evaluateDocument(document, options);
const warm = await evaluateDocument(document, options);
assert.equal(warm.appearance.status, 'ready');
assert.equal(warm.relief.status, 'ready');
assert.equal(warm.placedRelief.status, 'ready');
assert.equal(warm.cleanup.status, 'ready');
assert.equal(warm.bodies.status, 'ready');
assert.deepEqual(resultSummary(warm), resultSummary(cold));
assert(postStageCache.stats().hits >= 5, 'stable post stages are reused');
assert.equal(warm.postPlan.nodes.placement.result, warm.placedRelief);
assert.equal(
  Object.hasOwn(warm.postPlan.nodes.placement, 'generation'),
  false,
  'cache generation stays private to the session cache',
);
assert.deepEqual(warm.postPlan.nodes.placement.dependsOn, [
  'post:relief:shape',
]);
assert.deepEqual(warm.postPlan.nodes.cleanup.dependsOn, [
  'post:placement:global',
]);
assert.deepEqual(warm.postPlan.nodes.bodies.dependsOn, ['post:cleanup:global']);

const legacyCleanup = await buildBodies(
  cold.placedRelief,
  undefined,
  0.005,
  0.1,
);
const stagedCleanup = await buildBodies(
  cleanPlacedRelief(cold.placedRelief, 0.1),
  undefined,
  0.005,
  0.1,
);
assert.equal(stagedCleanup.status, legacyCleanup.status);
assert.deepEqual(
  stagedCleanup.value?.bodies.map((body) => body.report),
  legacyCleanup.value?.bodies.map((body) => body.report),
  'a cleanup DTO preserves the original cross-section simplify semantics',
);

const appearanceOnly = await evaluateDocument(document, {
  requestedDomains: ['appearance'],
  planarStageCache: createPlanarStageCache(),
  postStageCache: createPostStageCache(),
});
assert.equal(appearanceOnly.appearance.status, 'ready');
assert.equal(appearanceOnly.relief.status, 'absent');
assert.equal(appearanceOnly.cleanup.status, 'absent');
assert.equal(
  appearanceOnly.postPlan.nodes.placement,
  undefined,
  'requested closure omits unrelated post components from a snapshot',
);

const changedAppearance = structuredClone(document);
changedAppearance.appearances.swatches.red.color = '#00ff00';
const recolored = await evaluateDocument(changedAppearance, options);
assert.equal(recolored.appearance.value.appearances[0].color, '#00ff00');
assert.notEqual(
  recolored.appearance.value.appearances[0].color,
  warm.appearance.value.appearances[0].color,
  'appearance author changes invalidate the owner branch',
);

const changedCleanup = structuredClone(changedAppearance);
changedCleanup.manufacturing.cleanupRadiusMM = 0.1;
const cleaned = await evaluateDocument(changedCleanup, options);
assert.deepEqual(
  cleaned.appearance.value,
  recolored.appearance.value,
  'manufacturing cleanup does not invalidate AppearanceSet',
);
assert.deepEqual(
  cleaned.relief.value,
  recolored.relief.value,
  'manufacturing cleanup does not invalidate ReliefSet',
);
assert.notDeepEqual(
  cleaned.cleanup.value,
  recolored.cleanup.value,
  'cleanup radius invalidates its own node',
);

const changedSource = structuredClone(changedCleanup);
changedSource.sketches.sketch.vertices['outer-a'].position.value[0] += 0.01;
const beforeSourceChange = postStageCache.stats();
await evaluateDocument(changedSource, options);
assert(
  postStageCache.stats().misses > beforeSourceChange.misses,
  'changed RegionSet input invalidates the owner branch without geometry JSON keys',
);

const concurrentCache = createPostStageCache();
const leftDocument = createFixture();
const rightDocument = createFixture();
rightDocument.appearances.swatches.red.color = '#0000ff';
const [leftConcurrent, rightConcurrent] = await Promise.all([
  evaluateDocument(leftDocument, {
    requestedDomains: domains,
    postStageCache: concurrentCache,
  }),
  evaluateDocument(rightDocument, {
    requestedDomains: domains,
    postStageCache: concurrentCache,
  }),
]);
assert.equal(leftConcurrent.appearance.value.appearances[0].color, '#ff0000');
assert.equal(rightConcurrent.appearance.value.appearances[0].color, '#0000ff');
const leftAfterConcurrent = await evaluateDocument(leftDocument, {
  requestedDomains: domains,
  postStageCache: concurrentCache,
});
assert.equal(
  leftAfterConcurrent.appearance.value.appearances[0].color,
  '#ff0000',
  'overlapping documents cannot publish another fingerprint under this cache key',
);

const customWorldCache = createPostStageCache();
const placedWithWorldA = await evaluateDocument(document, {
  requestedDomains: ['placed-relief'],
  postStageCache: customWorldCache,
  worldMatrices: { shape: [1, 0, 0, 1, 10, 0] },
});
const placedWithWorldB = await evaluateDocument(document, {
  requestedDomains: ['placed-relief'],
  postStageCache: customWorldCache,
  worldMatrices: { shape: [1, 0, 0, 1, 20, 0] },
});
assert.notDeepEqual(
  placedWithWorldA.placedRelief.value?.reliefs[0].geometry.coordinates,
  placedWithWorldB.placedRelief.value?.reliefs[0].geometry.coordinates,
  'injected world matrices are not reused through a placement cache',
);

const firstTypedArray = (value, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return null;
  if (ArrayBuffer.isView(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) {
    const found = firstTypedArray(child, seen);
    if (found) return found;
  }
  return null;
};
const exposedMesh = firstTypedArray(warm.bodies);
if (exposedMesh) {
  const originalMeshValue = exposedMesh[0];
  exposedMesh[0] = originalMeshValue + 123;
  const afterMeshMutation = await evaluateDocument(document, options);
  assert.equal(
    firstTypedArray(afterMeshMutation.bodies)[0],
    originalMeshValue,
    'caller mutation of a returned typed mesh cannot alter a cached BodySet',
  );
} else {
  assert(
    Object.isFrozen(warm.bodies.value.bodies[0].mesh.positions),
    'the Node Manifold adapter returns frozen numeric mesh arrays',
  );
}

const onePart = structuredClone(cold.placedRelief);
const invalidMember = structuredClone(onePart.value.reliefs[0]);
invalidMember.ref.key = 'invalid-part';
invalidMember.partId = 'invalid-part';
invalidMember.zTop = invalidMember.zBase;
onePart.value.reliefs.push(invalidMember);
const isolatedBodies = await buildBodies(onePart);
assert.equal(isolatedBodies.status, 'blocked');
assert.equal(
  isolatedBodies.value,
  undefined,
  'a blocked aggregate cannot export a subset',
);
assert.equal(
  isolatedBodies.branches.find((branch) => branch.partId !== 'invalid-part')
    .status,
  'ready',
  'unrelated Part body remains inspectable after a local failure',
);
assert.equal(
  isolatedBodies.branches.find((branch) => branch.partId === 'invalid-part')
    .status,
  'blocked',
);

console.log(
  'PASS: typed post-evaluation plan closes Appearance → Relief → Placement → Cleanup → Body, caches only serializable stages, and isolates Part body failure.',
);
