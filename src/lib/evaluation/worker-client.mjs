// Transport only: callers own document revisions and decide whether a result is
// still current. No request or response is allowed to mutate the document here.
/**
 * @param {Worker} worker
 * @param {{ onError?: (error: Error) => void }} [options]
 */
export function createWorkerClient(worker, { onError = () => {} } = {}) {
  let sequence = 0;
  let closed = null;
  const pending = new Map();
  const message = ({ data }) => {
    const request = pending.get(data?.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(Error(String(data.error)));
    else request.resolve(data.result);
  };
  const close = (reason = Error('工作空间已关闭')) => {
    if (closed) return;
    closed = reason;
    worker.removeEventListener('message', message);
    worker.removeEventListener('error', failure);
    worker.removeEventListener('messageerror', messageFailure);
    worker.terminate();
    for (const request of pending.values()) request.reject(reason);
    pending.clear();
  };
  const failure = (event) => {
    const error = Error(event.message || '几何引擎加载失败');
    close(error);
    onError(error);
  };
  const messageFailure = () => failure({ message: '几何引擎响应无法读取' });
  worker.addEventListener('message', message);
  worker.addEventListener('error', failure);
  worker.addEventListener('messageerror', messageFailure);
  return {
    request(payload) {
      if (closed) return Promise.reject(closed);
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve, reject });
        try {
          worker.postMessage({ ...payload, id });
        } catch (error) {
          pending.delete(id);
          reject(error);
        }
      });
    },
    close,
  };
}
