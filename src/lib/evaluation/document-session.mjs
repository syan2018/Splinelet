import { createEvaluationSession } from './session.mjs';
import { evaluateDocument } from './evaluate-document.mjs';
import { sameDocument } from '../editing/history.mjs';
import { createChainSnapshotStore } from './chain-snapshots.mjs';
import { createPlanarStageCache } from './planar-stage-cache.mjs';
import {
  createPostStageCache,
  postPlanComponentIds,
} from './post-evaluation-plan.mjs';
import { worldMatrix } from '../scene/transforms.mjs';

export const documentEvaluationDomains = Object.freeze([
  'curves',
  'regions',
  'relief',
  'placed-relief',
  'bodies',
]);
const documentOf = (state) =>
  state.previewId ? state.preview.document : state.document;
const identity = (state) => ({
  epoch: state.epoch,
  revision: state.revision,
  previewId: state.previewId ?? null,
  ...(state.previewId && { previewVersion: state.preview?.version ?? 0 }),
});

/** One current-document broker shared by GUI and Agent. Prepared candidates
 * deliberately bypass its cache: their document is not an editor revision. */
export function createDocumentEvaluationSession({
  editorSession,
  evaluate = evaluateDocument,
}) {
  // References never affect geometry. Reuse domain results across image-only edits,
  // while the broker still validates each caller's full revision/preview identity.
  let geometryKey = null;
  const geometryResults = new Map();
  let cacheEpoch = null;
  let planarStageCache = createPlanarStageCache();
  let postStageCache = createPostStageCache();
  const evaluateCurrent = (request) => {
    if (cacheEpoch !== request.epoch) {
      cacheEpoch = request.epoch;
      planarStageCache = createPlanarStageCache();
      postStageCache = createPostStageCache();
    }
    const {
      references: _references,
      assets: _assets,
      ...geometry
    } = request.document;
    const key = JSON.stringify([request.epoch, geometry]);
    if (key !== geometryKey) {
      geometryKey = key;
      geometryResults.clear();
    }
    const domains = [...request.domains]
      .sort((a, b) => a.localeCompare(b))
      .join(',');
    if (!geometryResults.has(domains)) {
      const pending = Promise.resolve(
        evaluate(request.document, {
          ...request,
          requestedDomains: request.domains,
          planarStageCache,
          postStageCache,
        }),
      );
      geometryResults.set(domains, pending);
      pending.catch(() => {
        if (geometryResults.get(domains) === pending)
          geometryResults.delete(domains);
      });
    }
    return geometryResults.get(domains);
  };
  const session = createEvaluationSession({
    capabilities: documentEvaluationDomains,
    evaluate: evaluateCurrent,
  });
  const detach = session.attach(editorSession);
  const chainSnapshots = createChainSnapshotStore();
  const updateChain = (state) => {
    chainSnapshots.update(identity(state));
    chainSnapshots.prune([
      ...Object.values(state.document.programs).flatMap((program) =>
        Object.keys(program.operators).map((id) => `operator:${id}`),
      ),
      ...postPlanComponentIds(state.document),
    ]);
  };
  updateChain(editorSession.state);
  const detachChain = editorSession.subscribe(updateChain);
  let disposed = false;
  const assertCurrent = (state) => {
    if (disposed) throw Error('求值会话已关闭');
    const current = editorSession.state;
    if (
      JSON.stringify(identity(state)) !== JSON.stringify(identity(current)) ||
      !sameDocument(documentOf(state), documentOf(current))
    )
      throw Error('求值期间工程已变化，结果已过期');
  };
  return Object.freeze({
    session,
    readChainSnapshot(componentId, port) {
      assertCurrent(editorSession.state);
      return chainSnapshots.read(componentId, port);
    },
    readChainStatus(componentId, port) {
      assertCurrent(editorSession.state);
      return chainSnapshots.readStatus(componentId, port);
    },
    async snapshot(state, domains, { purpose = 'exact' } = {}) {
      assertCurrent(state);
      try {
        const snapshot = await session.evaluate({
          ...identity(state),
          domains,
          purpose,
        });
        assertCurrent(state);
        if (snapshot.planar)
          chainSnapshots.accept(identity(state), snapshot.planar, {
            worldMatrices: Object.fromEntries(
              Object.values(documentOf(state).nodes)
                .filter((node) => node.kind === 'shape')
                .map((node) => [
                  node.id,
                  worldMatrix(documentOf(state), node.id),
                ]),
            ),
          });
        if (snapshot.postPlan?.components)
          chainSnapshots.accept(identity(state), {
            components: snapshot.postPlan.components,
          });
        return snapshot;
      } finally {
        assertCurrent(state);
      }
    },
    async candidate(document, state, domains) {
      assertCurrent(state);
      const result = await evaluate(document, {
        ...identity(state),
        requestedDomains: domains,
      });
      assertCurrent(state);
      return result;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      detach();
      detachChain();
      chainSnapshots.clear();
      geometryResults.clear();
      geometryKey = null;
      postStageCache.clear();
      planarStageCache = createPlanarStageCache();
      session.dispose();
    },
  });
}
