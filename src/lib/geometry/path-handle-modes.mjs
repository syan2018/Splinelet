export const PATH_HANDLE_MODES = Object.freeze([
  'corner',
  'smooth',
  'symmetric',
]);

const EPSILON = 1e-10;
const finiteVec2 = (value) =>
  Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
const sameHandle = (left, right) =>
  left?.edgeId === right?.edgeId && left?.end === right?.end;
const handle = (edgeId, end) => ({ edgeId, end });
const edgeEnd = (edge, atStart) =>
  atStart
    ? { vertexId: edge.startVertexId, handle: handle(edge.id, 'start') }
    : { vertexId: edge.endVertexId, handle: handle(edge.id, 'end') };

const pathSlots = (sketch, path) => {
  if (!path.edges.length && path.startVertexId) {
    if (!sketch.vertices[path.startVertexId]) throw Error('Path 起点不存在');
    return [{ vertexId: path.startVertexId, incoming: null, outgoing: null }];
  }
  const slots = [];
  for (const use of path.edges) {
    const edge = sketch.edges[use.edgeId];
    if (!edge) throw Error(`Path 引用的 Edge 不存在：${use.edgeId}`);
    const start = edgeEnd(edge, !use.reversed);
    const end = edgeEnd(edge, use.reversed);
    const last = slots.at(-1);
    if (last?.vertexId === start.vertexId && !last.outgoing)
      last.outgoing = start.handle;
    else
      slots.push({
        vertexId: start.vertexId,
        incoming: null,
        outgoing: start.handle,
      });
    slots.push({
      vertexId: end.vertexId,
      incoming: end.handle,
      outgoing: null,
    });
  }
  const first = slots[0];
  const last = slots.at(-1);
  if (
    slots.length > 1 &&
    first.vertexId === last.vertexId &&
    !first.incoming &&
    !last.outgoing
  ) {
    first.incoming = last.incoming;
    slots.pop();
  }
  return slots;
};

const uniqueSlot = (sketch, path, vertexId) => {
  const matches = pathSlots(sketch, path).filter(
    (slot) => slot.vertexId === vertexId,
  );
  if (!matches.length) throw Error('Vertex 不属于所选 Path');
  if (matches.length !== 1)
    throw Error('Vertex 在所选 Path 中多次出现，控制柄语义不明确');
  return matches[0];
};

const requirePath = (sketch, pathId) => {
  const path = sketch.paths[pathId];
  if (!path) throw Error('Path 不存在');
  return path;
};

const handleSlot = (sketch, ref) => {
  const edge = sketch.edges[ref?.edgeId];
  if (!edge || !['start', 'end'].includes(ref?.end))
    throw Error('控制柄不存在');
  const key = ref.end === 'start' ? 'startHandle' : 'endHandle';
  return { edge, key, value: edge[key] };
};

const requireFree = (sketch, ref) => {
  const slot = handleSlot(sketch, ref);
  if (slot.value.kind !== 'free')
    throw Error('受 Relation 驱动的 Handle 必须由关系命令编辑');
  return slot;
};

const oppositeVertexId = (sketch, ref) => {
  const { edge } = handleSlot(sketch, ref);
  return ref.end === 'start' ? edge.endVertexId : edge.startVertexId;
};

const freeVertexValue = (sketch, vertexId) => {
  const vertex = sketch.vertices[vertexId];
  if (!vertex || vertex.position.kind !== 'free')
    throw Error('零长度控制柄自动对齐需要自由相邻 Vertex');
  return vertex.position.value;
};

const length = (vector) => Math.hypot(vector[0], vector[1]);
const oppositeVector = (driver, oppositeLength, mode) => {
  const driverLength = length(driver);
  if (mode === 'smooth' && driverLength < EPSILON) return null;
  const targetLength = mode === 'symmetric' ? driverLength : oppositeLength;
  return [
    -(driver[0] / (driverLength || 1)) * targetLength,
    -(driver[1] / (driverLength || 1)) * targetLength,
  ];
};

const writeMode = (path, vertexId, mode) => {
  if (mode === 'corner') {
    if (!path.handleModes) return;
    delete path.handleModes[vertexId];
    if (!Object.keys(path.handleModes).length) delete path.handleModes;
    return;
  }
  path.handleModes = { ...path.handleModes, [vertexId]: mode };
};

export const pathHandleMode = (path, vertexId) =>
  path.handleModes?.[vertexId] ?? 'corner';

export function locatePathHandle(sketch, pathId, edgeId, end) {
  const path = requirePath(sketch, pathId);
  const selected = handle(edgeId, end);
  handleSlot(sketch, selected);
  const matches = pathSlots(sketch, path).filter(
    (slot) =>
      sameHandle(slot.incoming, selected) ||
      sameHandle(slot.outgoing, selected),
  );
  if (!matches.length) throw Error('控制柄不属于所选 Path');
  if (matches.length !== 1)
    throw Error('控制柄在所选 Path 中多次出现，语义不明确');
  const slot = uniqueSlot(sketch, path, matches[0].vertexId);
  const selectedIsIncoming = sameHandle(slot.incoming, selected);
  return {
    path,
    vertexId: slot.vertexId,
    selected,
    opposite: selectedIsIncoming ? slot.outgoing : slot.incoming,
    incoming: slot.incoming,
    outgoing: slot.outgoing,
  };
}

export function movePathHandle(sketch, edit) {
  if (!finiteVec2(edit.vector)) throw Error('Handle 向量必须是有限 Vec2');
  const located = locatePathHandle(sketch, edit.pathId, edit.edgeId, edit.end);
  const selected = requireFree(sketch, located.selected);
  const mode = pathHandleMode(located.path, located.vertexId);
  let opposite;
  let nextOpposite = null;
  if (mode !== 'corner') {
    if (!located.opposite) throw Error('连续模式需要节点两侧都有曲线');
    opposite = requireFree(sketch, located.opposite);
    nextOpposite = oppositeVector(
      edit.vector,
      length(opposite.value.vector),
      mode,
    );
  }
  selected.value.vector = [...edit.vector];
  if (nextOpposite) opposite.value.vector = nextOpposite;
  return located;
}

export function setPathHandleMode(sketch, edit) {
  if (!PATH_HANDLE_MODES.includes(edit.mode))
    throw Error('Path 控制柄模式无效');
  const path = requirePath(sketch, edit.pathId);
  const slot = uniqueSlot(sketch, path, edit.vertexId);
  if (edit.mode === 'corner') {
    writeMode(path, edit.vertexId, edit.mode);
    return { path, vertexId: edit.vertexId, changedHandles: [] };
  }
  if (!slot.incoming || !slot.outgoing)
    throw Error('连续模式需要节点两侧都有曲线');
  const incoming = requireFree(sketch, slot.incoming);
  const outgoing = requireFree(sketch, slot.outgoing);
  let driver = [...outgoing.value.vector];
  if (length(driver) < EPSILON) driver = incoming.value.vector.map((v) => -v);
  if (length(driver) < EPSILON) {
    const previous = freeVertexValue(
      sketch,
      oppositeVertexId(sketch, slot.incoming),
    );
    const next = freeVertexValue(
      sketch,
      oppositeVertexId(sketch, slot.outgoing),
    );
    driver = [(next[0] - previous[0]) / 6, (next[1] - previous[1]) / 6];
  }
  const nextIncoming = oppositeVector(
    driver,
    length(incoming.value.vector),
    edit.mode,
  );
  writeMode(path, edit.vertexId, edit.mode);
  outgoing.value.vector = driver;
  if (nextIncoming) incoming.value.vector = nextIncoming;
  return {
    path,
    vertexId: edit.vertexId,
    changedHandles: [slot.incoming, slot.outgoing],
  };
}

export function setStoredPathHandleMode(path, vertexId, mode) {
  if (!PATH_HANDLE_MODES.includes(mode)) throw Error('Path 控制柄模式无效');
  writeMode(path, vertexId, mode);
}

export function cleanPathHandleModes(sketch, path) {
  if (!path.handleModes) return;
  const slots = pathSlots(sketch, path);
  const counts = new Map();
  for (const slot of slots) {
    const current = counts.get(slot.vertexId) || [];
    current.push(slot);
    counts.set(slot.vertexId, current);
  }
  for (const vertexId of Object.keys(path.handleModes)) {
    const matches = counts.get(vertexId) || [];
    if (matches.length !== 1 || !matches[0].incoming || !matches[0].outgoing)
      writeMode(path, vertexId, 'corner');
  }
}
