const statuses = new Set(['ready', 'empty', 'absent', 'blocked']);
const immutable = new WeakSet();
const mutableBuffers = new WeakSet();

const freeze = (value, seen = new WeakSet()) => {
  if (!value || typeof value !== 'object' || immutable.has(value)) return value;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    mutableBuffers.add(value);
    return value;
  }
  if (seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) {
    freeze(child, seen);
    if (child && typeof child === 'object' && mutableBuffers.has(child))
      mutableBuffers.add(value);
  }
  Object.freeze(value);
  immutable.add(value);
  return value;
};

const sameState = (left, right) =>
  left?.epoch === right?.epoch &&
  left?.revision === right?.revision &&
  left?.previewId === right?.previewId &&
  left?.previewVersion === right?.previewVersion;

const stateOf = (value) => {
  if (!value || typeof value.epoch !== 'string' || !value.epoch)
    throw Error('chain snapshot state 缺少 epoch');
  if (!Number.isInteger(value.revision) || value.revision < 0)
    throw Error('chain snapshot state revision 无效');
  if (
    value.previewId !== null &&
    value.previewId !== undefined &&
    (typeof value.previewId !== 'string' || !value.previewId)
  )
    throw Error('chain snapshot state previewId 无效');
  const suppliedVersion = value.previewVersion ?? value.preview?.version ?? 0;
  if (
    value.previewVersion !== undefined &&
    value.preview?.version !== undefined &&
    value.previewVersion !== value.preview.version
  )
    throw Error('chain snapshot state preview version 不一致');
  if (!Number.isInteger(suppliedVersion) || suppliedVersion < 0)
    throw Error('chain snapshot state previewVersion 无效');
  if ((value.previewId ?? null) === null && suppliedVersion !== 0)
    throw Error('chain snapshot committed state 不能有 previewVersion');
  return freeze({
    epoch: value.epoch,
    revision: value.revision,
    previewId: value.previewId ?? null,
    previewVersion: suppliedVersion,
  });
};

const stageOf = (value) => {
  if (!value || typeof value !== 'object' || !statuses.has(value.status))
    throw Error('chain snapshot stage 无效');
  const stage = freeze(value);
  // Own mutable mesh buffers; callers cannot mutate the retained result.
  return mutableBuffers.has(stage) ? freeze(structuredClone(stage)) : stage;
};

const componentPorts = (planar) => {
  if (!planar || typeof planar !== 'object' || !planar.components)
    throw Error('chain snapshot 需要 planar components');
  if (typeof planar.components !== 'object' || Array.isArray(planar.components))
    throw Error('chain snapshot components 无效');
  return Object.entries(planar.components).map(([id, component]) => {
    if (!id || !component || typeof component !== 'object')
      throw Error('chain snapshot component 无效');
    if (!component.ports || typeof component.ports !== 'object')
      throw Error('chain snapshot component ports 无效');
    return [id, Object.entries(component.ports)];
  });
};

/**
 * Display-only index for a construction chain. It never supplies an evaluator
 * input and it never serializes StageResult data into the Document.
 *
 * `accept()` merges snapshots for the same token, so domain-partial reads do
 * not erase ports absent from that read. Historical entries are pruned only by
 * an explicit `prune(liveComponentIds)` call; a partial domain snapshot cannot
 * prove that an omitted component was deleted from the Program.
 */
export function createChainSnapshotStore() {
  let currentState = null;
  let current = new Map();
  let history = new Map();

  const clearEpoch = () => {
    current = new Map();
    history = new Map();
  };
  const portsFor = (map, componentId, create = false) => {
    if (!map.has(componentId) && create) map.set(componentId, new Map());
    return map.get(componentId);
  };
  const view = (componentId, port) => {
    const stage = portsFor(current, componentId)?.get(port) || null;
    const lastSuccessful = portsFor(history, componentId)?.get(port) || null;
    const result = freeze({
      current: stage,
      lastSuccessful,
      freshness: !currentState
        ? 'stale'
        : !stage
          ? 'pending'
          : ['ready', 'empty'].includes(stage.status)
            ? 'current'
            : 'stale',
      currentState,
    });
    return mutableBuffers.has(result)
      ? freeze(structuredClone(result))
      : result;
  };

  return Object.freeze({
    update(value) {
      const next = stateOf(value);
      if (currentState?.epoch !== next.epoch) {
        clearEpoch();
        currentState = next;
        return currentState;
      }
      if (next.revision < currentState.revision) return currentState;
      if (
        next.revision === currentState.revision &&
        next.previewId === currentState.previewId &&
        next.previewVersion < currentState.previewVersion
      )
        return currentState;
      if (!sameState(currentState, next)) {
        currentState = next;
        current = new Map();
      }
      return currentState;
    },
    accept(value, planar, { worldMatrices = {} } = {}) {
      const token = stateOf(value);
      if (!sameState(currentState, token)) return false;
      for (const [componentId, ports] of componentPorts(planar)) {
        const target = portsFor(current, componentId, true);
        for (const [port, stage] of ports) {
          const immutableStage = stageOf(stage);
          target.set(port, immutableStage);
          if (
            token.previewId === null &&
            ['ready', 'empty'].includes(immutableStage.status)
          )
            portsFor(history, componentId, true).set(
              port,
              freeze({
                ...token,
                stage: immutableStage,
                ...(worldMatrices[immutableStage.value?.frame?.ownerNodeId] && {
                  worldMatrix: structuredClone(
                    worldMatrices[immutableStage.value.frame.ownerNodeId],
                  ),
                }),
              }),
            );
        }
      }
      return true;
    },
    prune(liveComponentIds) {
      if (!Array.isArray(liveComponentIds))
        throw Error('chain snapshot liveComponentIds 必须是数组');
      const live = new Set(liveComponentIds);
      if (
        [...live].some(
          (componentId) => typeof componentId !== 'string' || !componentId,
        )
      )
        throw Error('chain snapshot component id 无效');
      for (const map of [current, history])
        for (const componentId of map.keys())
          if (!live.has(componentId)) map.delete(componentId);
    },
    clear() {
      currentState = null;
      clearEpoch();
    },
    read(componentId, port) {
      if (typeof componentId !== 'string' || !componentId)
        throw Error('chain snapshot component id 无效');
      if (typeof port !== 'string' || !port)
        throw Error('chain snapshot port 无效');
      return view(componentId, port);
    },
    readStatus(componentId, port) {
      const stage = portsFor(current, componentId)?.get(port);
      const previous = portsFor(history, componentId)?.get(port);
      return freeze({
        status: stage?.status || 'pending',
        diagnostics: stage?.diagnostics || [],
        lastRevision: previous?.revision ?? null,
      });
    },
  });
}
