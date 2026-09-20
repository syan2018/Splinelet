import { evaluateDocument } from './evaluate-document.mjs';
import { assertEvaluationIdentity, canonicalDomains } from './worker-protocol';
import type {
  WorkerEvaluationRequest,
  WorkerEvaluationResponse,
} from './worker-protocol';
import wasmURL from 'manifold-3d/manifold.wasm?url';

self.onmessage = async ({ data }: MessageEvent<WorkerEvaluationRequest>) => {
  try {
    assertEvaluationIdentity(data);
    const domains = canonicalDomains(data.domains);
    if (data.kind !== 'evaluate' || !data.requestId)
      throw Error('无效求值请求');
    const snapshot = await evaluateDocument(data.document, {
      requestedDomains: domains,
      solidOptions: { locateFile: () => wasmURL },
    });
    const response: WorkerEvaluationResponse = {
      kind: 'result',
      epoch: data.epoch,
      revision: data.revision,
      previewId: data.previewId,
      ...(data.previewId && { previewVersion: data.previewVersion ?? 0 }),
      requestId: data.requestId,
      domains,
      snapshot,
    };
    self.postMessage(response);
  } catch (error) {
    self.postMessage({
      kind: 'error',
      epoch: data.epoch,
      revision: data.revision,
      previewId: data.previewId,
      ...(data.previewId && { previewVersion: data.previewVersion ?? 0 }),
      requestId: data.requestId,
      domains: data.domains,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
