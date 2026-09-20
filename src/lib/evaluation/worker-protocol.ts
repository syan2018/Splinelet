export const evaluationDomains = [
  'curves',
  'regions',
  'relief',
  'placed-relief',
  'bodies',
] as const;

export type EvaluationDomain = (typeof evaluationDomains)[number];
export type EvaluationIdentity = Readonly<{
  epoch: string;
  revision: number;
  previewId: string | null;
  previewVersion?: number;
}>;
export type WorkerEvaluationRequest = Readonly<
  EvaluationIdentity & {
    kind: 'evaluate';
    requestId: string;
    domains: readonly EvaluationDomain[];
    document: unknown;
  }
>;
export type WorkerEvaluationResult = Readonly<
  EvaluationIdentity & {
    kind: 'result';
    requestId: string;
    domains: readonly EvaluationDomain[];
    snapshot: unknown;
  }
>;
export type WorkerEvaluationFailure = Readonly<
  EvaluationIdentity & {
    kind: 'error';
    requestId: string;
    domains: readonly EvaluationDomain[];
    error: string;
  }
>;
export type WorkerEvaluationResponse =
  | WorkerEvaluationResult
  | WorkerEvaluationFailure;

const allowed = new Set<string>(evaluationDomains);
const clone = <T>(value: T): T => structuredClone(value);
const freeze = <T>(value: T): Readonly<T> => Object.freeze(value);

export function canonicalDomains(
  domains: readonly string[],
): EvaluationDomain[] {
  if (!Array.isArray(domains) || !domains.length)
    throw Error('domains 必须是非空集合');
  const unique = [...new Set(domains)];
  if (unique.some((domain) => !allowed.has(domain)))
    throw Error('domains 包含未知阶段');
  return unique.sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  ) as EvaluationDomain[];
}

export function assertEvaluationIdentity(
  value: unknown,
): asserts value is EvaluationIdentity {
  const identity = value as Partial<EvaluationIdentity>;
  if (!identity || typeof identity.epoch !== 'string' || !identity.epoch)
    throw Error('epoch 必须是非空字符串');
  if (
    typeof identity.revision !== 'number' ||
    !Number.isInteger(identity.revision) ||
    identity.revision < 0
  )
    throw Error('revision 必须是非负整数');
  if (
    identity.previewId !== null &&
    (typeof identity.previewId !== 'string' || !identity.previewId)
  )
    throw Error('previewId 必须是 null 或非空字符串');
  if (
    identity.previewVersion !== undefined &&
    (!Number.isInteger(identity.previewVersion) || identity.previewVersion < 0)
  )
    throw Error('previewVersion 必须为非负整数');
}

export function createWorkerRequest(
  value: Omit<WorkerEvaluationRequest, 'kind' | 'domains'> & {
    domains: readonly string[];
  },
): WorkerEvaluationRequest {
  assertEvaluationIdentity(value);
  if (typeof value.requestId !== 'string' || !value.requestId)
    throw Error('requestId 必须是非空字符串');
  return freeze({
    kind: 'evaluate',
    requestId: value.requestId,
    epoch: value.epoch,
    revision: value.revision,
    previewId: value.previewId,
    ...(value.previewId && { previewVersion: value.previewVersion ?? 0 }),
    domains: freeze(canonicalDomains(value.domains)),
    document: clone(value.document),
  });
}

export function assertWorkerResponse(
  value: unknown,
): asserts value is WorkerEvaluationResponse {
  assertEvaluationIdentity(value);
  const response = value as WorkerEvaluationResponse;
  if (
    !response ||
    (response.kind !== 'result' && response.kind !== 'error') ||
    typeof response.requestId !== 'string' ||
    !response.requestId
  )
    throw Error('Worker response 无效');
  canonicalDomains(response.domains || []);
  if (response.kind === 'error' && typeof response.error !== 'string')
    throw Error('Worker error response 缺少错误信息');
}
