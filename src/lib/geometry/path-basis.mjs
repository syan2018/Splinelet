const span = (value) =>
  Array.isArray(value) &&
  value.length === 2 &&
  value.every((item) => Number.isFinite(item));

const unitSpan = (value) =>
  span(value) && value[0] >= 0 && value[1] <= 1 && value[0] < value[1];

export const hasPathBasis = (document) => document?.version >= 5;

export const cloneSpan = (value) => {
  if (!span(value)) throw Error('Path basisSpan 无效');
  return [value[0], value[1]];
};

export const withBasisSpan = (document, use, basisSpan) =>
  hasPathBasis(document)
    ? { ...use, basisSpan: cloneSpan(basisSpan) }
    : { ...use };

/** The containing Path is the implicit basis namespace until a composite Path
 * carries an explicit one on the use. */
export const basisIdForUse = (path, use) => use.basisId || path.id;

export const basisPeriodForUse = (path, use) => {
  const basisId = basisIdForUse(path, use);
  const catalog = path.basisCatalog?.[basisId];
  if (catalog?.period !== undefined) return catalog.period;
  return basisId === path.id ? path.basisPeriod : undefined;
};

const clonePiece = (piece) => ({
  t: cloneSpan(piece.t),
  basisId: piece.basisId,
  span: cloneSpan(piece.span),
});

/** Returns the one authoritative parameter map for a directed Path use. */
export const basisPiecesForUse = (path, use) => {
  const pieces = use.basisPieces;
  if (pieces === undefined)
    return [
      {
        t: [0, 1],
        basisId: basisIdForUse(path, use),
        span: cloneSpan(use.basisSpan),
      },
    ];
  if (!Array.isArray(pieces) || !pieces.length)
    throw Error('Path basisPieces 不能为空');
  let cursor = 0;
  const result = pieces.map((piece) => {
    if (
      !piece ||
      typeof piece !== 'object' ||
      typeof piece.basisId !== 'string' ||
      !unitSpan(piece.t) ||
      !span(piece.span)
    )
      throw Error('Path basisPiece 无效');
    if (piece.t[0] !== cursor)
      throw Error('Path basisPieces 必须连续覆盖 use 参数域');
    cursor = piece.t[1];
    return clonePiece(piece);
  });
  if (cursor !== 1) throw Error('Path basisPieces 必须覆盖完整 use 参数域');
  return result;
};

/** Adjacent pieces are interchangeable with one piece only when they express
 * the same affine t-to-basis map. Continuity alone would silently replace an
 * explicit non-uniform author mapping with a new linear parameterization. */
const samePieceSource = (left, right) =>
  left.basisId === right.basisId &&
  left.span[1] === right.span[0] &&
  (left.span[1] - left.span[0]) * (right.t[1] - right.t[0]) ===
    (right.span[1] - right.span[0]) * (left.t[1] - left.t[0]);
const compactPieces = (pieces) =>
  pieces.reduce((result, piece) => {
    const previous = result.at(-1);
    if (
      previous &&
      previous.t[1] === piece.t[0] &&
      samePieceSource(previous, piece)
    ) {
      previous.t[1] = piece.t[1];
      previous.span[1] = piece.span[1];
    } else result.push(clonePiece(piece));
    return result;
  }, []);

const ensurePieceBases = (path, pieces) => {
  const missing = [...new Set(pieces.map((piece) => piece.basisId))].filter(
    (basisId) => !Object.hasOwn(path.basisCatalog || {}, basisId),
  );
  if (!missing.length) return;
  path.basisCatalog = {
    ...path.basisCatalog,
    ...Object.fromEntries(missing.map((basisId) => [basisId, {}])),
  };
};

/** Writes a canonical single source map when possible; compound maps have no
 * misleading top-level basisSpan/basisId fallback. */
export const withBasisPieces = (document, path, use, pieces) => {
  if (!hasPathBasis(document)) return { ...use };
  const normalized = compactPieces(pieces);
  if (
    normalized.length === 1 &&
    normalized[0].t[0] === 0 &&
    normalized[0].t[1] === 1
  ) {
    const piece = normalized[0];
    const next = { ...use, basisSpan: cloneSpan(piece.span) };
    delete next.basisPieces;
    if (piece.basisId === path.id) delete next.basisId;
    else next.basisId = piece.basisId;
    return next;
  }
  // A composite map may explicitly use the Path's otherwise implicit basis.
  // Schema records every piece basis in the catalog so this durable map remains
  // self-contained across copy and reload.
  ensurePieceBases(path, normalized);
  const next = { ...use, basisPieces: normalized };
  delete next.basisSpan;
  delete next.basisId;
  return next;
};

const clipPieces = (pieces, start, end) => {
  if (!(Number.isFinite(start) && Number.isFinite(end) && start < end))
    throw Error('basisPieces 截取范围无效');
  const width = end - start;
  const result = [];
  for (const piece of pieces) {
    const from = Math.max(start, piece.t[0]);
    const to = Math.min(end, piece.t[1]);
    if (!(from < to)) continue;
    const sourceAt = (value) =>
      piece.span[0] +
      ((piece.span[1] - piece.span[0]) * (value - piece.t[0])) /
        (piece.t[1] - piece.t[0]);
    result.push({
      t: [(from - start) / width, (to - start) / width],
      basisId: piece.basisId,
      span: [sourceAt(from), sourceAt(to)],
    });
  }
  return result;
};

export const splitBasisPieces = (path, use, storageT) => {
  if (!(Number.isFinite(storageT) && storageT > 0 && storageT < 1))
    throw Error('basisPieces 拆分参数无效');
  const cut = use.reversed ? 1 - storageT : storageT;
  const pieces = basisPiecesForUse(path, use);
  return {
    first: clipPieces(pieces, 0, cut),
    second: clipPieces(pieces, cut, 1),
  };
};

/** Explicit replacement mapping may take a directed subinterval from an old
 * use. A descending interval reverses provenance; no geometry is consulted. */
export const basisPiecesForSourceInterval = (path, use, interval) => {
  if (!span(interval) || interval[0] === interval[1])
    throw Error('basisPieces 来源区间无效');
  const forward = interval[0] < interval[1];
  const result = clipPieces(
    basisPiecesForUse(path, use),
    Math.min(...interval),
    Math.max(...interval),
  );
  if (!result.length) throw Error('basisPieces 来源区间为空');
  return forward
    ? result
    : result.toReversed().map((piece) => ({
        t: [1 - piece.t[1], 1 - piece.t[0]],
        basisId: piece.basisId,
        span: [piece.span[1], piece.span[0]],
      }));
};

export const reverseBasisPieces = (path, use) =>
  basisPiecesForUse(path, use)
    .toReversed()
    .map((piece) => ({
      t: [1 - piece.t[1], 1 - piece.t[0]],
      basisId: piece.basisId,
      span: [piece.span[1], piece.span[0]],
    }));

const scalePieces = (pieces, start, end) =>
  pieces.map((piece) => ({
    ...clonePiece(piece),
    t: [start + (end - start) * piece.t[0], start + (end - start) * piece.t[1]],
  }));

/** A node delete explicitly reparameterizes the fitted replacement: the left
 * old use occupies the first half and the right old use the second half. */
export const concatenateBasisPieces = (path, left, right) =>
  compactPieces([
    ...scalePieces(basisPiecesForUse(path, left), 0, 0.5),
    ...scalePieces(basisPiecesForUse(path, right), 0.5, 1),
  ]);

export const pathHasCompositeBasis = (path) => {
  const ids = new Set();
  for (const use of path.edges || []) {
    if (use.basisPieces?.length > 1) return true;
    ids.add(basisIdForUse(path, use));
  }
  return ids.size > 1;
};

export const withBasisId = (document, use, basisId) =>
  hasPathBasis(document)
    ? { ...use, ...(basisId === undefined ? {} : { basisId }) }
    : { ...use };

export const pathBasisDirection = (path) => {
  for (const use of path.edges || []) {
    if (!span(use.basisSpan)) continue;
    const delta = use.basisSpan[1] - use.basisSpan[0];
    if (delta) return Math.sign(delta);
  }
  return 1;
};

export const sequentialBasisUses = (document, uses) =>
  uses.map((use, index) => withBasisSpan(document, use, [index, index + 1]));

export const pathIsClosed = (sketch, uses) => {
  if (!uses.length) return false;
  let first;
  let previous;
  for (const use of uses) {
    const edge = sketch.edges[use.edgeId];
    if (!edge) return false;
    const start = use.reversed ? edge.endVertexId : edge.startVertexId;
    const end = use.reversed ? edge.startVertexId : edge.endVertexId;
    if (first === undefined) first = start;
    else if (previous !== start) return false;
    previous = end;
  }
  return previous === first;
};

/**
 * Assigns source-order logical coordinates once. It never reconstructs an
 * existing coordinate system from geometry or changes a complete basis.
 */
export const initializePathBasis = (sketch, path) => {
  const hasAny = path.edges.some(
    (use) => use.basisSpan !== undefined || use.basisPieces !== undefined,
  );
  const hasEvery = path.edges.every(
    (use) => span(use.basisSpan) || Array.isArray(use.basisPieces),
  );
  if (hasAny && !hasEvery) throw Error('Path basisSpan 不能部分初始化');
  if (hasEvery) return path;
  path.edges = path.edges.map((use, index) => ({
    ...use,
    basisSpan: [index, index + 1],
  }));
  if (pathIsClosed(sketch, path.edges)) path.basisPeriod = path.edges.length;
  else delete path.basisPeriod;
  return path;
};

/** Explicit V4-to-V5 migration hook; ordinary V4 commands must not call it. */
export const initializeDocumentBasis = (document) => {
  if (document?.version < 5) throw Error('只能为 V5 文档初始化 Path basis');
  for (const sketch of Object.values(document.sketches || {}))
    for (const path of Object.values(sketch.paths || {}))
      initializePathBasis(sketch, path);
  return document;
};

export const splitBasisSpan = (use, t) => {
  const [start, end] = cloneSpan(use.basisSpan);
  const middle = start + (end - start) * (use.reversed ? 1 - t : t);
  return use.reversed
    ? { first: [middle, end], second: [start, middle] }
    : { first: [start, middle], second: [middle, end] };
};

const shiftedEnd = (leftEnd, rightStart, rightEnd, period) => {
  if (leftEnd === rightStart) return rightEnd;
  if (!(Number.isFinite(period) && period > 0))
    throw Error('相邻 Path basisSpan 不连续');
  const shift = Math.round((leftEnd - rightStart) / period);
  if (rightStart + shift * period !== leftEnd)
    throw Error('闭合 Path basisSpan 无法在周期内连接');
  return rightEnd + shift * period;
};

export const mergeBasisSpans = (left, right, period) => {
  const [start, end] = cloneSpan(left);
  const [rightStart, rightEnd] = cloneSpan(right);
  return [start, shiftedEnd(end, rightStart, rightEnd, period)];
};

export const replacementBasisSpans = (uses, count) => {
  if (!Number.isInteger(count) || count < 1)
    throw Error('replacement basis 段数无效');
  const [start] = cloneSpan(uses[0].basisSpan);
  const [, end] = cloneSpan(uses.at(-1).basisSpan);
  return Array.from({ length: count }, (_, index) => [
    start + ((end - start) * index) / count,
    start + ((end - start) * (index + 1)) / count,
  ]);
};
