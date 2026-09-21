import { createWorkerClient as createRuntimeWorkerClient } from './session.mjs';
import type {
  WorkerEvaluationRequest,
  WorkerEvaluationResponse,
} from './worker-protocol.ts';

export type WorkerEndpoint = {
  postMessage(message: WorkerEvaluationRequest): void;
  addEventListener?: (
    type: 'message' | 'error',
    listener: (event: MessageEvent<WorkerEvaluationResponse>) => void,
  ) => void;
  removeEventListener?: (
    type: 'message' | 'error',
    listener: (event: MessageEvent<WorkerEvaluationResponse>) => void,
  ) => void;
};

export type WorkerClient = Readonly<{
  request(request: WorkerEvaluationRequest): Promise<WorkerEvaluationResponse>;
  cancel(requestId: string, reason?: string): boolean;
  close(reason?: string): void;
}>;

/** Runtime stays in .mjs so protocol tests run directly in Node. */
export const createWorkerClient = createRuntimeWorkerClient as (
  endpoint: WorkerEndpoint,
) => WorkerClient;
