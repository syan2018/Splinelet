import { stableFingerprint } from '../construction/dependencies.mjs';
import { resolveAppearanceBranch } from '../relief/appearance.mjs';
import { resolveReliefBranch } from '../relief/resolve.mjs';
import { resolveManufacturing } from '../manufacturing/placement.mjs';
import { worldMatrix } from '../scene/transforms.mjs';
import { cleanPlacedRelief, buildBodies } from '../solid/bodies.mjs';
import { aggregateReliefBranches } from './branch-stages.mjs';
import { executePostPlanDag } from './post-plan-executor.mjs';

const clone = (value) => structuredClone(value);
const cacheEntries = new WeakMap();
const stageTokens = new WeakMap();
let nextStageToken = 0;

const freeze = (value, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  // Mesh ArrayBuffers are mutable host data. Freezing them either throws or
  // gives a misleading partial guarantee, so freeze only their DTO owners.
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
  seen.add(value);
  for (const child of Object.values(value)) freeze(child, seen);
  return Object.freeze(value);
};
const tokenFor = (value) => {
  if (!value || typeof value !== 'object') return String(value);
  if (!stageTokens.has(value)) stageTokens.set(value, ++nextStageToken);
  return stageTokens.get(value);
};
const stage = (domain, status, value, diagnostics = [], dependencies = []) =>
  freeze({
    domain,
    status,
    ...(value === undefined ? {} : { value }),
    diagnostics: clone(diagnostics),
    dependencies: [...new Set(dependencies)],
  });
const absent = (domain) => stage(domain, 'absent');
const ownerScope = (record, ownerNodeId) => ({
  ...record,
  overrides: Object.fromEntries(
    Object.entries(record?.overrides || {}).filter(
      ([, item]) => item.target?.ownerNodeId === ownerNodeId,
    ),
  ),
});

/** One cache belongs to one Studio evaluation session/epoch. */
export function createPostStageCache() {
  const entries = new Map();
  const stats = { hits: 0, misses: 0 };
  const cache = {
    clear() {
      entries.clear();
    },
    stats() {
      return Object.freeze({ ...stats, size: entries.size });
    },
  };
  // Never reuse a generation after clear: downstream cache keys must remain
  // unique even when independent exact requests overlap.
  cacheEntries.set(cache, { entries, stats, nextGeneration: 0 });
  return Object.freeze(cache);
}

const entriesFor = (cache) => (cache ? cacheEntries.get(cache) || null : null);
const runCached = async (cache, key, fingerprint, evaluate) => {
  const state = entriesFor(cache);
  const hit = state?.entries.get(key);
  if (hit?.fingerprint === fingerprint) {
    state.stats.hits++;
    return hit.stage;
  }
  if (state) state.stats.misses++;
  const value = freeze(await evaluate());
  if (state) {
    const generation = ++state.nextGeneration;
    const decorated = freeze({ ...value, nodeId: key, generation });
    state.entries.set(key, { fingerprint, generation, stage: decorated });
    return decorated;
  }
  return value;
};

const stablePublishedStage = (
  document,
  planar,
  ownerNodeId,
  name,
  fallback,
) => {
  const program = document.programs?.[document.nodes?.[ownerNodeId]?.programId];
  const output = program?.outputs?.[name];
  // `published` is a fresh presentation wrapper on every planar evaluation.
  // Cached construction components retain the normalized port DTO, which is
  // the actual upstream stage for a post-plan cache key.
  return (
    planar.components?.[`operator:${output?.operatorId}`]?.ports?.[
      output?.port
    ] || fallback
  );
};
const regionInputs = (document, planar) =>
  Object.entries(planar.published)
    .filter(([, value]) => value.domain === 'regions')
    .map(([key, value]) => ({
      ownerNodeId: key.slice(0, -':regions'.length),
      stage: stablePublishedStage(
        document,
        planar,
        key.slice(0, -':regions'.length),
        'regions',
        value,
      ),
    }));
const regionBranches = (document, planar) => {
  const grouped = new Map();
  for (const { ownerNodeId, stage: input } of regionInputs(document, planar)) {
    const owners =
      input.status === 'ready'
        ? [
            ...new Set(
              (input.value?.regions || []).map(
                (region) => region.ref?.ownerNodeId,
              ),
            ),
          ]
        : [ownerNodeId];
    for (const owner of owners.length ? owners : [ownerNodeId]) {
      const branch =
        input.status === 'ready'
          ? {
              ...input,
              postInputToken: tokenFor(input),
              value: {
                ...input.value,
                regions: input.value.regions.filter(
                  (region) => region.ref?.ownerNodeId === owner,
                ),
              },
            }
          : { ...input, postInputToken: tokenFor(input) };
      if (!grouped.has(owner)) grouped.set(owner, []);
      grouped.get(owner).push(branch);
    }
  }
  for (const assignment of [
    ...Object.values(document.appearances?.overrides || {}),
    ...Object.values(document.reliefDefinitions?.overrides || {}),
  ])
    if (!grouped.has(assignment.target?.ownerNodeId))
      grouped.set(assignment.target?.ownerNodeId, []);
  return grouped;
};
const regionToken = (inputs) =>
  inputs
    .map((input) => input.postInputToken ?? tokenFor(input))
    .sort((a, b) => a - b);
const appearanceAuthor = (document, ownerNodeId) => {
  const overrides = Object.entries(document.appearances?.overrides || {})
    .filter(([, value]) => value.target?.ownerNodeId === ownerNodeId)
    .map(([id, value]) => [id, value]);
  const swatchIds = new Set([
    document.appearances?.defaults?.[ownerNodeId]?.swatchId,
    ...overrides.map(([, value]) => value.value?.swatchId),
  ]);
  return {
    version: document.version,
    default: document.appearances?.defaults?.[ownerNodeId] || null,
    overrides,
    swatches: [...swatchIds]
      .filter((id) => id !== null && id !== undefined)
      .sort((a, b) => a.localeCompare(b))
      .map((id) => [id, document.appearances?.swatches?.[id] || null]),
  };
};
const reliefAuthor = (document, ownerNodeId) => ({
  version: document.version,
  default: document.reliefDefinitions?.defaults?.[ownerNodeId] || null,
  overrides: Object.entries(document.reliefDefinitions?.overrides || {}).filter(
    ([, value]) => value.target?.ownerNodeId === ownerNodeId,
  ),
});
const manufacturingAuthor = (document) => ({
  layerHeightMM: document.manufacturing.layerHeightMM,
  cleanupRadiusMM: document.manufacturing.cleanupRadiusMM ?? 0,
  layers: document.manufacturing.layers,
  layerOrder: document.manufacturing.layerOrder,
  parts: document.manufacturing.parts,
  defaultPartId: document.manufacturing.defaultPartId,
  assignments: document.manufacturing.assignments,
  excluded: document.manufacturing.excluded,
  world: Object.values(document.nodes)
    .filter((node) => node.kind === 'shape')
    .map((node) => node.id)
    .sort((a, b) => a.localeCompare(b))
    .map((id) => [id, worldMatrix(document, id)]),
});
const aggregateAppearance = (branches) => {
  const diagnostics = branches.flatMap((branch) => branch.diagnostics || []);
  const dependencies = [
    ...new Set(branches.flatMap((branch) => branch.dependencies || [])),
  ];
  const blocked = branches.some((branch) => branch.status === 'blocked');
  const appearances = branches.flatMap(
    (branch) => branch.value?.appearances || [],
  );
  const absentBranches =
    branches.length > 0 &&
    branches.every((branch) => branch.status === 'absent');
  return stage(
    'appearance',
    blocked
      ? 'blocked'
      : appearances.length
        ? 'ready'
        : absentBranches
          ? 'absent'
          : 'empty',
    blocked || absentBranches ? undefined : { appearances },
    diagnostics,
    dependencies,
  );
};
const planNode = (id, domain, dependsOn, result, ownerNodeId = null) =>
  freeze({
    id,
    domain,
    ...(ownerNodeId === null ? {} : { ownerNodeId }),
    dependsOn: [...dependsOn],
    result,
    ports: { [domain]: result },
  });

const containsTypedBuffer = (value, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return true;
  seen.add(value);
  return Object.values(value).some((child) => containsTypedBuffer(child, seen));
};
const exposeStage = (result) => {
  // Cache entries may contain typed mesh arrays. Those cannot be frozen, so a
  // snapshot caller receives owned buffers rather than aliases into the cache.
  const owned = containsTypedBuffer(result) ? structuredClone(result) : result;
  const {
    nodeId: _nodeId,
    generation: _generation,
    branches,
    ...stage
  } = owned;
  return freeze({
    ...stage,
    ...(branches && { branches: branches.map(exposeStage) }),
  });
};

export const isPostPlanNodeId = (id) =>
  typeof id === 'string' && id.startsWith('post:');

/** All possible execution component IDs for a document, independent of one
 * requested snapshot. This mirrors planar component IDs for session pruning. */
export function postPlanComponentIds(document) {
  const owners = new Set(
    Object.values(document.programs || {}).map(
      (program) => program.ownerNodeId,
    ),
  );
  for (const assignment of [
    ...Object.values(document.appearances?.overrides || {}),
    ...Object.values(document.reliefDefinitions?.overrides || {}),
  ])
    if (assignment.target?.ownerNodeId)
      owners.add(assignment.target.ownerNodeId);
  return [
    ...[...owners]
      .sort((a, b) => a.localeCompare(b))
      .flatMap((ownerNodeId) => [
        `post:appearance:${ownerNodeId}`,
        `post:relief:${ownerNodeId}`,
      ]),
    'post:placement:global',
    'post:cleanup:global',
    'post:bodies:global',
  ];
}

/** Retrieves one port-shaped post component from a prior `postPlan` snapshot. */
export const readPostPlanComponent = (snapshot, id) =>
  snapshot?.postPlan?.components?.[id] || null;

/**
 * Names the post-plan nodes needed by a requested snapshot without evaluating
 * them. Worker/session snapshot pruning can use this alongside planar live
 * component IDs; authoring data remains outside this execution-only graph.
 */
export function postPlanNodeIds(document, planar, requestedDomains = []) {
  const compiled = compilePostEvaluationPlan(document, planar, {
    requestedDomains,
  });
  const definitions = new Map(compiled.nodes.map((node) => [node.id, node]));
  const live = new Set();
  const visit = (id) => {
    if (live.has(id) || !definitions.has(id)) return;
    live.add(id);
    for (const dependency of definitions.get(id).dependsOn) visit(dependency);
  };
  compiled.roots.forEach(visit);
  return [...live];
}

/**
 * Compiles existing author tables into a read-only post-plan. The returned
 * nodes are evaluation DTOs only; no temporary operators enter `programs`.
 */
export function compilePostEvaluationPlan(document, planar, options = {}) {
  const requested = new Set(options.requestedDomains || []);
  const wants = (...domains) => domains.some((domain) => requested.has(domain));
  const needAppearance = wants(
    'appearance',
    'relief',
    'placed-relief',
    'cleanup',
    'bodies',
  );
  const needRelief = wants('relief', 'placed-relief', 'cleanup', 'bodies');
  const needPlacement = wants('placed-relief', 'cleanup', 'bodies');
  const needCleanup = wants('cleanup', 'bodies');
  const cache = options.postStageCache || null;
  const branches = regionBranches(document, planar);
  const external = {};
  const nodes = [];
  const owners = [];
  for (const [ownerNodeId, inputs] of branches) {
    const regionId = `planar:${ownerNodeId}:regions`;
    const appearanceId = `post:appearance:${ownerNodeId}`;
    const reliefId = `post:relief:${ownerNodeId}`;
    owners.push({ ownerNodeId, regionId, appearanceId, reliefId });
    external[regionId] = inputs;
    const scopedAppearance = {
      ...document,
      appearances: ownerScope(document.appearances, ownerNodeId),
    };
    nodes.push(
      freeze({
        id: appearanceId,
        domain: 'appearance',
        ownerNodeId,
        dependsOn: [regionId],
        run: (resolved) =>
          runCached(
            cache,
            appearanceId,
            stableFingerprint({
              input: regionToken(resolved[regionId]),
              author: appearanceAuthor(document, ownerNodeId),
            }),
            () =>
              resolveAppearanceBranch(
                scopedAppearance,
                resolved[regionId],
                options.queries,
              ),
          ),
      }),
    );
    const scoped = {
      ...scopedAppearance,
      reliefDefinitions: ownerScope(document.reliefDefinitions, ownerNodeId),
    };
    nodes.push(
      freeze({
        id: reliefId,
        domain: 'relief',
        ownerNodeId,
        dependsOn: [regionId, appearanceId],
        run: (resolved) =>
          runCached(
            cache,
            reliefId,
            stableFingerprint({
              regions: regionToken(resolved[regionId]),
              appearance:
                resolved[appearanceId].generation ??
                tokenFor(resolved[appearanceId]),
              author: reliefAuthor(document, ownerNodeId),
            }),
            () =>
              resolveReliefBranch(
                scoped,
                resolved[regionId],
                options.queries,
                resolved[appearanceId],
              ),
          ),
      }),
    );
  }
  // Injected matrices are an external evaluator input. Their implementation
  // can be a closure, so retain correctness by not sharing Placement onward.
  const placementCache = options.worldMatrices === undefined ? cache : null;
  const placementId = 'post:placement:global';
  const cleanupId = 'post:cleanup:global';
  const bodiesId = 'post:bodies:global';
  const reliefIds = owners.map((owner) => owner.reliefId);
  nodes.push(
    freeze({
      id: placementId,
      domain: 'placed-relief',
      dependsOn: reliefIds,
      run: (resolved) => {
        const reliefBranches = owners.map((owner) => ({
          ownerNodeId: owner.ownerNodeId,
          ...resolved[owner.reliefId],
        }));
        const relief = aggregateReliefBranches('relief', reliefBranches);
        return runCached(
          placementCache,
          placementId,
          stableFingerprint({
            relief: reliefBranches.map((branch) => [
              branch.ownerNodeId,
              branch.generation ?? tokenFor(branch),
            ]),
            author: manufacturingAuthor(document),
          }),
          () =>
            resolveManufacturing(
              document,
              relief,
              options.worldMatrices || ((id) => worldMatrix(document, id)),
              options.queries,
            ),
        );
      },
    }),
  );
  nodes.push(
    freeze({
      id: cleanupId,
      domain: 'cleaned-placed-relief',
      dependsOn: [placementId],
      run: (resolved) =>
        runCached(
          cache,
          cleanupId,
          stableFingerprint({
            placed:
              resolved[placementId].generation ??
              tokenFor(resolved[placementId]),
            radius: document.manufacturing.cleanupRadiusMM ?? 0,
          }),
          () =>
            cleanPlacedRelief(
              resolved[placementId],
              document.manufacturing.cleanupRadiusMM ?? 0,
            ),
        ),
    }),
  );
  // Solid options commonly contain locateFile callbacks. Treat any supplied
  // options as custom execution behavior instead of serializing a function
  // into a cache fingerprint.
  const bodyCache = options.solidOptions === undefined ? cache : null;
  nodes.push(
    freeze({
      id: bodiesId,
      domain: 'bodies',
      dependsOn: [cleanupId],
      run: (resolved) =>
        runCached(
          bodyCache,
          bodiesId,
          stableFingerprint({
            cleanup:
              resolved[cleanupId].generation ?? tokenFor(resolved[cleanupId]),
            tolerance: Math.min(
              document.geometrySettings.curveToleranceMM / 3,
              0.005,
            ),
          }),
          () =>
            buildBodies(
              resolved[cleanupId],
              options.solidOptions,
              Math.min(document.geometrySettings.curveToleranceMM / 3, 0.005),
              document.manufacturing.cleanupRadiusMM ?? 0,
            ),
        ),
    }),
  );
  const roots = requested.has('bodies')
    ? [bodiesId]
    : needCleanup
      ? [cleanupId]
      : needPlacement
        ? [placementId]
        : needRelief
          ? reliefIds
          : needAppearance
            ? owners.map((owner) => owner.appearanceId)
            : [];
  return freeze({
    nodes,
    external,
    roots: roots.flat(),
    owners,
    requested: freeze({
      needAppearance,
      needRelief,
      needPlacement,
      needCleanup,
    }),
  });
}

export async function evaluatePostPlan(document, planar, options = {}) {
  const compiled = compilePostEvaluationPlan(document, planar, options);
  const values = await executePostPlanDag(compiled);
  const { owners, requested } = compiled;
  const appearanceBranches = requested.needAppearance
    ? owners.map((owner) => ({
        ownerNodeId: owner.ownerNodeId,
        ...values.get(owner.appearanceId),
      }))
    : [];
  const reliefBranches = requested.needRelief
    ? owners.map((owner) => ({
        ownerNodeId: owner.ownerNodeId,
        ...values.get(owner.reliefId),
      }))
    : [];
  const appearance = requested.needAppearance
    ? aggregateAppearance(appearanceBranches)
    : absent('appearance');
  const relief = requested.needRelief
    ? aggregateReliefBranches('relief', reliefBranches)
    : absent('relief');
  const placedRelief = requested.needPlacement
    ? values.get('post:placement:global')
    : absent('placed-relief');
  const cleanup = requested.needCleanup
    ? values.get('post:cleanup:global')
    : absent('cleanup');
  const bodies = options.requestedDomains?.includes('bodies')
    ? values.get('post:bodies:global')
    : absent('bodies');
  const publicAppearance = exposeStage(appearance);
  const publicRelief = exposeStage(relief);
  const publicPlacedRelief = exposeStage(placedRelief);
  const publicCleanup = exposeStage(cleanup);
  const publicBodies = exposeStage(bodies);
  const publicAppearanceBranches = appearanceBranches.map((branch) => ({
    ownerNodeId: branch.ownerNodeId,
    ...exposeStage(branch),
  }));
  const publicReliefBranches = reliefBranches.map((branch) => ({
    ownerNodeId: branch.ownerNodeId,
    ...exposeStage(branch),
  }));
  const definitionById = new Map(compiled.nodes.map((node) => [node.id, node]));
  const reportNode = (id, result) => {
    const definition = definitionById.get(id);
    return planNode(
      id,
      definition.domain,
      definition.dependsOn,
      result,
      definition.ownerNodeId,
    );
  };
  const appearanceNodes = publicAppearanceBranches.map((branch) =>
    reportNode(`post:appearance:${branch.ownerNodeId}`, exposeStage(branch)),
  );
  const reliefNodes = publicReliefBranches.map((branch) =>
    reportNode(`post:relief:${branch.ownerNodeId}`, exposeStage(branch)),
  );
  const nodes = {
    ...(requested.needAppearance && { appearance: appearanceNodes }),
    ...(requested.needRelief && { relief: reliefNodes }),
    ...(requested.needPlacement && {
      placement: reportNode('post:placement:global', publicPlacedRelief),
    }),
    ...(requested.needCleanup && {
      cleanup: reportNode('post:cleanup:global', publicCleanup),
    }),
    ...(options.requestedDomains?.includes('bodies') && {
      bodies: reportNode('post:bodies:global', publicBodies),
    }),
  };
  const components = [
    ...appearanceNodes,
    ...reliefNodes,
    nodes.placement,
    nodes.cleanup,
    nodes.bodies,
  ].filter(Boolean);
  return freeze({
    appearance: publicAppearance,
    relief: publicRelief,
    placedRelief: publicPlacedRelief,
    cleanup: publicCleanup,
    bodies: publicBodies,
    nodes: freeze(nodes),
    components: freeze(
      Object.fromEntries(components.map((node) => [node.id, node])),
    ),
  });
}
