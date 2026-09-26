import * as workerModule from '../evaluation/document-worker.ts?worker';
import { createWorkerClient } from '../evaluation/worker-client.ts';
import { createPlanarTransferDecoder } from '../evaluation/planar-transfer.mjs';
import {
  canonicalDomains,
  assertEvaluationIdentity,
} from '../evaluation/worker-protocol';
import { createStudioHost } from './studio-host.mjs';

const DocumentWorker = (
  workerModule as unknown as { default: new () => Worker }
).default;

/** Shared Web/Desktop host assembly: canonical evaluation runs off the UI thread. */
export function createBrowserStudioHost(options: Record<string, unknown>) {
  const worker = new DocumentWorker();
  const client = createWorkerClient(worker, { ownedResponses: true });
  const planarTransfer = createPlanarTransferDecoder();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    client.close();
    worker.terminate();
  };
  try {
    const host = createStudioHost({
      ...options,
      opened: options.opened,
      presentation: options.presentation,
      urls: options.urls,
      evaluate: async (
        document: unknown,
        request: {
          epoch: string;
          revision: number;
          previewId: string | null;
          previewVersion?: number;
          requestedDomains: string[];
        },
      ) => {
        assertEvaluationIdentity(request);
        const domains = canonicalDomains(request.requestedDomains);
        const base = planarTransfer.capture({ ...request, domains });
        const response = await client.request({
          kind: 'evaluate',
          requestId: crypto.randomUUID(),
          document,
          epoch: request.epoch,
          revision: request.revision,
          previewId: request.previewId,
          ...(request.previewId && {
            previewVersion: request.previewVersion ?? 0,
          }),
          domains,
          planarTransfer: true,
          ...(base && { planarBase: base.token }),
        });
        if (response.kind !== 'result') throw Error(response.error);
        return planarTransfer.decode(response, base);
      },
    });
    return Object.freeze({
      ...host,
      dispose() {
        host.dispose();
        close();
      },
    });
  } catch (error) {
    close();
    throw error;
  }
}
