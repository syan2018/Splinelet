/** Mounts the versioned API on browser transports without introducing a document store. */
export function mountV4BrowserAPI(
  api,
  {
    host = window,
    modelContext = document.modelContext,
    onError = (_error) => {},
  } = {},
) {
  const previous = host.traceStudio;
  host.traceStudio = api;
  host.traceStudioV4 = api;
  const controller = new AbortController();
  for (const action of api.capabilities.actions) {
    if (!modelContext?.registerTool) break;
    const write = /^(authoring|preview)\.|^(undo|redo)$/.test(action);
    const definition = {
      name: `splinelet_${action.replaceAll('.', '_')}`,
      description: `Splinelet API 5.0 ${action}. ${write ? 'Use current expectedRevision; entity references are stable IDs.' : 'Read current V4 state or explicitly requested evaluation/export stage.'}`,
      inputSchema: {
        type: 'object',
        properties: {
          expectedRevision: { type: 'integer', minimum: 0 },
          epoch: { type: 'string' },
          revision: { type: 'integer', minimum: 0 },
          previewId: { type: 'string' },
          action: { type: 'object' },
          domains: { type: 'array', items: { type: 'string' } },
          format: { type: 'string' },
          stage: { type: 'string' },
          options: { type: 'object' },
        },
        ...(write ? { required: ['expectedRevision'] } : {}),
      },
      execute: async (args = {}) => ({
        content: [
          { type: 'text', text: JSON.stringify(await api.call(action, args)) },
        ],
      }),
    };
    Promise.resolve(
      modelContext.registerTool(definition, { signal: controller.signal }),
    ).catch(onError);
  }
  return () => {
    controller.abort();
    if (host.traceStudio === api) {
      if (previous) host.traceStudio = previous;
      else delete host.traceStudio;
    }
    if (host.traceStudioV4 === api) delete host.traceStudioV4;
  };
}

/** One serial poll at a time. Abort prevents queued writes after the editor unmounts. */
export function connectV4Companion(
  api,
  {
    fetch: fetcher = globalThis.fetch,
    onError = (_error) => {},
    intervalMS = 750,
  } = {},
) {
  const controller = new AbortController();
  let timer;
  const post = async (path, body) => {
    const response = await fetcher(`http://127.0.0.1:4318/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw Error(`本地 Agent ${response.status}`);
    return response.json();
  };
  const poll = async () => {
    try {
      const state = await api.call('document.get');
      const tasks = await post('next', {
        apiVersion: api.version,
        epoch: state.epoch,
        revision: state.revision,
        previewId: state.previewId,
        capabilities: api.capabilities,
      });
      for (const task of tasks) {
        if (controller.signal.aborted) return;
        let result;
        try {
          result = {
            id: task.id,
            result: await api.call(task.action, task.args),
          };
        } catch (error) {
          result = {
            id: task.id,
            error: error instanceof Error ? error.message : String(error),
          };
        }
        await post('result', result);
      }
    } catch (error) {
      if (!controller.signal.aborted) onError(error);
    } finally {
      if (!controller.signal.aborted) timer = setTimeout(poll, intervalMS);
    }
  };
  void poll();
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}
