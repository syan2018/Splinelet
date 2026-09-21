import { createEvaluationSession } from './session.mjs';
import { evaluateDocument } from './evaluate-document.mjs';
import { sameDocument } from '../editing/history.mjs';

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
  const session = createEvaluationSession({
    capabilities: documentEvaluationDomains,
    evaluate: (request) =>
      evaluate(request.document, {
        ...request,
        requestedDomains: request.domains,
      }),
  });
  const detach = session.attach(editorSession);
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
    async snapshot(state, domains) {
      assertCurrent(state);
      try {
        return await session.evaluate({ ...identity(state), domains });
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
      session.dispose();
    },
  });
}
