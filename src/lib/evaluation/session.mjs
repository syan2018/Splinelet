import { sameDocument } from '../editing/history.mjs';

const domains = new Set([
  'curves',
  'regions',
  'relief',
  'placed-relief',
  'bodies',
]);
const purposes = new Set(['interactive', 'exact']);
const clone = (value) => structuredClone(value);
// Only plain, deeply frozen DTOs can be shared. Typed buffers still cross a
// copy boundary, since Object.freeze cannot protect their contents.
const immutable = new WeakSet();
const freeze = (value) => {
  if (!value || typeof value !== 'object' || immutable.has(value)) return value;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
  const children = Object.values(value);
  children.forEach(freeze);
  Object.freeze(value);
  if (
    (Array.isArray(value) ||
      Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null) &&
    children.every(
      (child) => !child || typeof child !== 'object' || immutable.has(child),
    )
  )
    immutable.add(value);
  return value;
};
const readonly = (value) =>
  immutable.has(value) ? value : freeze(clone(value));
const ownedSnapshot = (value) => readonly(freeze(value));
const sort = (a, b) => a.localeCompare(b);
const errorMessage = (error) =>
  error instanceof Error ? error.message : String(error);
const purposeFor = (input) => {
  const purpose = input?.purpose ?? 'exact';
  if (!purposes.has(purpose))
    throw Error('求值 purpose 必须为 interactive 或 exact');
  return purpose;
};
const supersededInteractiveError = () => {
  const error = Error('交互求值已被最新请求替换');
  error.name = 'InteractiveEvaluationSupersededError';
  return error;
};
const isSupersededInteractiveError = (error) =>
  error instanceof Error &&
  error.name === 'InteractiveEvaluationSupersededError';

/**
 * Interactive display requests are replaceable. Exact requests deliberately
 * bypass this gate: inspection, capture and export must retain their request.
 */
const createInteractiveScheduler = () => {
  let active = null;
  let queued = null;
  let closed = false;
  const finish = (entry) => {
    if (active !== entry) return;
    active = null;
    if (closed || !queued) return;
    const next = queued;
    queued = null;
    launch(next);
  };
  const launch = (entry) => {
    active = entry;
    let task;
    try {
      task = entry.run();
    } catch (error) {
      entry.reject(error);
      finish(entry);
      return;
    }
    Promise.resolve(task).then(
      (value) => {
        entry.resolve(value);
        finish(entry);
      },
      (error) => {
        entry.reject(error);
        finish(entry);
      },
    );
  };
  const rejectQueued = (error) => {
    if (!queued) return;
    const entry = queued;
    queued = null;
    entry.reject(error);
  };
  return Object.freeze({
    schedule(run) {
      if (closed) return Promise.reject(Error('Evaluation session 已关闭'));
      return new Promise((resolve, reject) => {
        const entry = { run, resolve, reject };
        if (!active) launch(entry);
        else {
          rejectQueued(supersededInteractiveError());
          queued = entry;
        }
      });
    },
    discard(reason) {
      rejectQueued(Error(reason));
    },
    close(reason) {
      closed = true;
      rejectQueued(Error(reason));
    },
  });
};

export function canonicalDomains(input) {
  if (!Array.isArray(input) || !input.length)
    throw Error('domains 必须是非空集合');
  const unique = [...new Set(input)];
  if (unique.some((domain) => !domains.has(domain)))
    throw Error('domains 包含未知阶段');
  return unique.sort(sort);
}

export function assertIdentity(value) {
  if (!value || typeof value.epoch !== 'string' || !value.epoch)
    throw Error('epoch 必须是非空字符串');
  if (!Number.isInteger(value.revision) || value.revision < 0)
    throw Error('revision 必须是非负整数');
  if (
    value.previewId !== null &&
    (typeof value.previewId !== 'string' || !value.previewId)
  )
    throw Error('previewId 必须是 null 或非空字符串');
  if (
    value.previewVersion !== undefined &&
    (!Number.isInteger(value.previewVersion) || value.previewVersion < 0)
  )
    throw Error('previewVersion 必须为非负整数');
}

const keyFor = (identity, requestedDomains) =>
  `${identity.epoch}\u0000${identity.revision}\u0000${identity.previewId || ''}\u0000${identity.previewVersion ?? 0}\u0000${requestedDomains.join(',')}`;
const pendingKeyFor = (key, purpose) => `${key}\u0000${purpose}`;
const sameIdentity = (a, b) =>
  a?.epoch === b?.epoch &&
  a?.revision === b?.revision &&
  a?.previewId === b?.previewId &&
  (a?.previewVersion ?? 0) === (b?.previewVersion ?? 0);
const responseMatches = (request, response) =>
  response &&
  response.requestId === request.requestId &&
  sameIdentity(request, response) &&
  canonicalDomains(response.domains).join(',') === request.domains.join(',');
const editorCapture = (state) => {
  const previewId = state?.previewId ?? null;
  const document = previewId ? state?.preview?.document : state?.document;
  assertIdentity({
    epoch: state?.epoch,
    revision: state?.revision,
    previewId,
  });
  if (!document || typeof document !== 'object')
    throw Error('会话状态缺少当前 Document');
  return {
    epoch: state.epoch,
    revision: state.revision,
    previewId,
    ...(previewId && { previewVersion: state.preview?.version ?? 0 }),
    document: clone(document),
  };
};

/** A small Worker-compatible request broker. It also supports Node worker_threads. */
export function createWorkerClient(endpoint) {
  if (!endpoint?.postMessage) throw Error('worker endpoint 必须有 postMessage');
  const pending = new Map();
  let closed = false;
  const usedRequestIds = new Set();
  const receive = (event) => {
    const response = event?.data === undefined ? event : event.data;
    const entry = pending.get(response?.requestId);
    if (!entry) return;
    pending.delete(response.requestId);
    try {
      assertIdentity(response);
      canonicalDomains(response.domains);
      if (!['result', 'error'].includes(response.kind))
        throw Error('Worker response kind 无效');
      if (!responseMatches(entry.request, response))
        throw Error('Worker response 的身份、requestId 或 domains 不匹配');
      if (response.kind === 'error') entry.reject(Error(response.error));
      // One isolated immutable DTO crosses the client/session boundary. Plain
      // snapshots can then be shared instead of cloning the entire planar graph
      // again in execute(); mutable typed buffers still require a later copy.
      else entry.resolve(readonly(response));
    } catch (error) {
      entry.reject(error);
    }
  };
  const failAll = (error) => {
    closed = true;
    for (const entry of pending.values())
      entry.reject(Error(errorMessage(error)));
    pending.clear();
  };
  const remove = [];
  if (typeof endpoint.addEventListener === 'function') {
    endpoint.addEventListener('message', receive);
    endpoint.addEventListener('error', failAll);
    endpoint.addEventListener('messageerror', failAll);
    remove.push(() => endpoint.removeEventListener?.('message', receive));
    remove.push(() => endpoint.removeEventListener?.('error', failAll));
    remove.push(() => endpoint.removeEventListener?.('messageerror', failAll));
  } else if (typeof endpoint.on === 'function') {
    endpoint.on('message', receive);
    endpoint.on('error', failAll);
    const exited = (code) => failAll(`Worker 已退出：${code}`);
    endpoint.on('exit', exited);
    remove.push(() => endpoint.off?.('message', receive));
    remove.push(() => endpoint.off?.('error', failAll));
    remove.push(() => endpoint.off?.('exit', exited));
  } else throw Error('worker endpoint 必须支持消息订阅');

  return Object.freeze({
    request(request) {
      if (closed) return Promise.reject(Error('Worker 客户端已关闭'));
      assertIdentity(request);
      canonicalDomains(request.domains);
      if (typeof request.requestId !== 'string' || !request.requestId)
        throw Error('requestId 必须是非空字符串');
      if (usedRequestIds.has(request.requestId))
        throw Error('requestId 不能重用');
      usedRequestIds.add(request.requestId);
      return new Promise((resolve, reject) => {
        pending.set(request.requestId, { request, resolve, reject });
        try {
          endpoint.postMessage(clone(request));
        } catch (error) {
          pending.delete(request.requestId);
          reject(error);
        }
      });
    },
    cancel(requestId, reason = 'Worker 请求已取消') {
      const entry = pending.get(requestId);
      if (!entry) return false;
      pending.delete(requestId);
      entry.reject(Error(reason));
      return true;
    },
    close(reason = 'Worker 客户端已关闭') {
      failAll(reason);
      for (const listener of remove) listener();
    },
  });
}

export function createEvaluationSession(options = {}) {
  if (typeof options.evaluate !== 'function' && !options.workerClient?.request)
    throw Error('需要注入 evaluate 或 workerClient');
  const available = new Set(options.capabilities || []);
  if ([...available].some((domain) => !domains.has(domain)))
    throw Error('capabilities 包含未知阶段');
  const idFactory = options.idFactory || (() => crypto.randomUUID());
  if (typeof idFactory !== 'function') throw Error('idFactory 必须是函数');
  let sequence = 0;
  let current = null;
  let disposed = false;
  const results = new Map();
  const failures = new Map();
  const pending = new Map();
  const interactive = createInteractiveScheduler();
  const listeners = new Set();
  const notify = () => {
    if (!listeners.size) return;
    const snapshot = state();
    for (const listener of listeners)
      try {
        listener(snapshot);
      } catch {}
  };
  const state = () =>
    ownedSnapshot({
      current: current && {
        epoch: current.epoch,
        revision: current.revision,
        previewId: current.previewId,
        ...(current.previewId && { previewVersion: current.previewVersion }),
      },
      results: Object.fromEntries(results),
      failures: Object.fromEntries(failures),
      pending: [...pending.values()].map((entry) => ({
        requestId: entry.request.requestId,
        epoch: entry.request.epoch,
        revision: entry.request.revision,
        previewId: entry.request.previewId,
        ...(entry.request.previewId && {
          previewVersion: entry.request.previewVersion,
        }),
        domains: entry.request.domains,
        purpose: entry.purpose,
      })),
    });
  const requireCurrent = () => {
    if (disposed) throw Error('Evaluation session 已关闭');
    if (!current) throw Error('尚未提供编辑会话状态');
    return current;
  };
  const invalidate = (reason) => {
    interactive.discard(reason);
    for (const entry of pending.values()) {
      options.workerClient?.cancel?.(entry.request.requestId, reason);
      entry.reject(Error(reason));
    }
    pending.clear();
  };
  const requestId = () => `evaluation-${++sequence}-${idFactory()}`;
  const createRequest = (capture, requestedDomains) =>
    readonly({
      kind: 'evaluate',
      requestId: requestId(),
      epoch: capture.epoch,
      revision: capture.revision,
      previewId: capture.previewId,
      ...(capture.previewId && { previewVersion: capture.previewVersion }),
      domains: requestedDomains,
      document: capture.document,
    });
  const execute = (request, purpose) => {
    const run = async () => {
      const raw = options.workerClient
        ? await options.workerClient.request(request)
        : await options.evaluate(clone(request));
      const response =
        raw?.kind === 'result' || raw?.kind === 'error'
          ? raw
          : { ...request, kind: 'result', snapshot: raw };
      if (!responseMatches(request, response))
        throw Error('Worker response 的身份、requestId 或 domains 不匹配');
      if (response.kind === 'error') throw Error(response.error);
      return readonly(response.snapshot);
    };
    return purpose === 'interactive' ? interactive.schedule(run) : run();
  };
  const accept = (request, snapshot) => {
    const key = keyFor(request, request.domains);
    if (!sameIdentity(current, request))
      throw Error('求值结果已过期，不能覆盖当前阶段');
    results.set(
      key,
      ownedSnapshot({
        status: 'ready',
        epoch: request.epoch,
        revision: request.revision,
        previewId: request.previewId,
        ...(request.previewId && { previewVersion: request.previewVersion }),
        domains: request.domains,
        snapshot,
      }),
    );
    failures.delete(key);
  };

  return Object.freeze({
    get state() {
      return state();
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw Error('订阅者必须是函数');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(editorState) {
      const next = editorCapture(editorState);
      if (
        sameIdentity(current, next) &&
        sameDocument(current.document, next.document)
      )
        return state();
      invalidate('编辑会话身份已变化，旧求值请求作废');
      current = next;
      results.clear();
      failures.clear();
      notify();
      return state();
    },
    attach(editorSession) {
      if (!editorSession?.subscribe || !editorSession?.state)
        throw Error('editorSession 必须提供 state 和 subscribe');
      this.update(editorSession.state);
      return editorSession.subscribe((next) => this.update(next));
    },
    request(input) {
      const capture = requireCurrent();
      const requestedDomains = canonicalDomains(input?.domains);
      const purpose = purposeFor(input);
      const key = keyFor(capture, requestedDomains);
      const pendingKey = pendingKeyFor(key, purpose);
      const unavailable = requestedDomains.filter(
        (domain) => !available.has(domain),
      );
      if (unavailable.length) {
        results.set(
          key,
          readonly({
            status: 'unavailable',
            epoch: capture.epoch,
            revision: capture.revision,
            previewId: capture.previewId,
            ...(capture.previewId && {
              previewVersion: capture.previewVersion,
            }),
            domains: requestedDomains,
            unavailableDomains: unavailable,
          }),
        );
        notify();
        return Promise.resolve(state());
      }
      if (pending.has(pendingKey)) return pending.get(pendingKey).promise;
      if (results.has(key)) return Promise.resolve(state());
      const request = createRequest(capture, requestedDomains);
      let resolvePending;
      let rejectPending;
      const promise = new Promise((resolve, reject) => {
        resolvePending = resolve;
        rejectPending = reject;
      });
      pending.set(pendingKey, {
        request,
        purpose,
        promise,
        reject: rejectPending,
      });
      notify();
      execute(request, purpose).then(
        (snapshot) => {
          const entry = pending.get(pendingKey);
          if (!entry || entry.request.requestId !== request.requestId) return;
          pending.delete(pendingKey);
          try {
            accept(request, snapshot);
            resolvePending(state());
          } catch (error) {
            rejectPending(error);
          }
          notify();
        },
        (error) => {
          const entry = pending.get(pendingKey);
          if (!entry || entry.request.requestId !== request.requestId) return;
          pending.delete(pendingKey);
          if (
            sameIdentity(current, request) &&
            !isSupersededInteractiveError(error)
          )
            failures.set(
              key,
              readonly({
                epoch: request.epoch,
                revision: request.revision,
                previewId: request.previewId,
                ...(request.previewId && {
                  previewVersion: request.previewVersion,
                }),
                domains: request.domains,
                error: errorMessage(error),
              }),
            );
          rejectPending(error);
          notify();
        },
      );
      return promise;
    },
    async evaluate(input) {
      const requestedDomains = canonicalDomains(input?.domains);
      const purpose = purposeFor(input);
      if (!sameIdentity(requireCurrent(), input)) throw Error('求值身份已过期');
      await this.request({ domains: requestedDomains, purpose });
      if (!sameIdentity(requireCurrent(), input)) throw Error('求值身份已过期');
      const result = results.get(keyFor(input, requestedDomains));
      if (result?.status !== 'ready') throw Error('请求的求值阶段不可用');
      return readonly(result.snapshot);
    },
    capture({ epoch, revision, domains: requested } = {}) {
      const capture = requireCurrent();
      const requestedDomains = canonicalDomains(requested);
      if (
        capture.previewId !== null ||
        capture.epoch !== epoch ||
        capture.revision !== revision
      )
        throw Error('导出 capture 已过期或不是当前已提交 revision');
      const result = results.get(keyFor(capture, requestedDomains));
      if (!result || result.status !== 'ready')
        throw Error('指定 revision 尚无可导出的完成快照');
      return readonly({
        epoch: capture.epoch,
        revision: capture.revision,
        previewId: null,
        domains: requestedDomains,
        snapshot: result.snapshot,
      });
    },
    async awaitCommittedSnapshot({ epoch, revision, domains: requested } = {}) {
      const requestedDomains = canonicalDomains(requested);
      const capture = requireCurrent();
      if (
        capture.previewId !== null ||
        capture.epoch !== epoch ||
        capture.revision !== revision
      )
        throw Error('等待的导出 revision 已过期或不是当前提交');
      const key = keyFor(capture, requestedDomains);
      const result = results.get(key);
      if (result?.status === 'ready')
        return this.capture({ epoch, revision, domains: requestedDomains });
      const entry = pending.get(pendingKeyFor(key, 'exact'));
      if (!entry) throw Error('指定 revision 没有待完成的求值请求');
      await entry.promise;
      return this.capture({ epoch, revision, domains: requestedDomains });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      interactive.close('Evaluation session 已关闭');
      invalidate('Evaluation session 已关闭');
      listeners.clear();
    },
  });
}
