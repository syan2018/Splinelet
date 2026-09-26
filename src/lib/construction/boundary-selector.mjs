import { stableIdentityValue as key } from './output-identity.mjs';

const sorted = (items) =>
  items.slice().sort((a, b) => key(a).localeCompare(key(b)));
const same = (a, b) => key(a) === key(b);
const modulo = (value, period) =>
  period ? ((value % period) + period) % period : value;
const tolerance = 1e-10;
const parameterEqual = (a, b) =>
  Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
const descriptor = (item) => {
  const { parity = 1, basisPeriod: _basisPeriod, ...rawUse } = item.source;
  // An endpoint-connected partition path is one declared cutting curve. Its
  // generated continuation is traced separately by the geometry DTO, but the
  // boundary predicate names the entire cutting use. Crossing the raw endpoint
  // must not create/delete an authoring boundary or rename the adjacent face.
  const use =
    rawUse.kind === 'generated-join'
      ? (({ endpoint: _endpoint, ...source }) => ({
          ...source,
          kind: 'curve-use',
          role: 'cutter',
        }))(rawUse)
      : rawUse;
  const direction =
    Math.sign(item.sourceParameter[1] - item.sourceParameter[0]) * parity;
  if (!direction) throw Error('边界来源没有有效逻辑方向');
  return { use, direction };
};
const branches = (edge, end) =>
  sorted(
    edge.sources.map((item) => {
      const { use } = descriptor(item);
      return {
        use,
        parameter:
          use.kind === 'curve-use'
            ? modulo(item.sourceParameter[end], item.source.basisPeriod)
            : null,
        ...(item.source.basisPeriod ? { period: item.source.basisPeriod } : {}),
      };
    }),
  );
const continuous = (left, right) => {
  const a = branches(left, 1),
    b = branches(right, 0);
  return (
    a.length === b.length &&
    a.every(
      (branch, i) =>
        same(branch.use, b[i].use) &&
        (branch.parameter === null ||
          parameterEqual(branch.parameter, b[i].parameter)),
    )
  );
};
const event = (left, right) => {
  const result = [];
  for (const branch of [...branches(left, 1), ...branches(right, 0)])
    if (
      !result.some(
        (item) =>
          same(item.use, branch.use) &&
          parameterEqual(item.parameter, branch.parameter),
      )
    )
      result.push(branch);
  return { branches: sorted(result), point: right.coordinates[0] };
};

function ringModel(edges) {
  if (!edges.length) throw Error('区域边界不能为空');
  const runs = [];
  for (const edge of edges) {
    if (!edge.sources?.length) throw Error('区域边界缺少来源');
    const sources = sorted(edge.sources.map(descriptor));
    const previous = runs.at(-1);
    if (
      previous &&
      same(previous.sources, sources) &&
      continuous(previous.last, edge)
    )
      previous.last = edge;
    else runs.push({ sources, first: edge, last: edge });
  }
  if (
    runs.length > 1 &&
    same(runs[0].sources, runs.at(-1).sources) &&
    continuous(runs.at(-1).last, runs[0].first)
  ) {
    runs[0].first = runs.at(-1).first;
    runs.pop();
  }
  return runs.map((run, index) => ({
    sources: run.sources,
    start: event(runs[(index + runs.length - 1) % runs.length].last, run.first),
    end: event(run.last, runs[(index + 1) % runs.length].first),
    // A complete closed logical loop has no distinguished start vertex.
    closed: runs.length === 1 && continuous(run.last, run.first),
  }));
}

export const boundaryModel = (boundary) => ({
  outer: ringModel(boundary.outer),
  holes: boundary.holes.map(ringModel),
});
const allEvents = (models) => {
  const byVertex = new Map(),
    events = [];
  for (const model of models)
    for (const ring of [model.outer, ...model.holes])
      for (const run of ring) {
        if (run.closed) continue;
        // Coordinates identify an already-noded graph vertex; they are never saved
        // as identity or compared by proximity. Adjacent faces may interpolate the
        // same source parameter with slightly different floating-point roundoff.
        const id = key(run.start.point),
          previous = byVertex.get(id) || [];
        const equal = (left, right) =>
          left.branches.length === right.branches.length &&
          left.branches.every(
            (branch, index) =>
              same(branch.use, right.branches[index].use) &&
              parameterEqual(branch.parameter, right.branches[index].parameter),
          );
        if (!previous.some((item) => equal(item, run.start))) {
          previous.push(run.start);
          byVertex.set(id, previous);
          events.push(run.start);
        }
      }
  return events;
};
const boundaryContext = (value) =>
  value && value.kind === 'boundary-selector-context';

/** Builds the immutable per-operator vocabulary once. The contained models,
 * canonical event set and event-match cache are evaluation-local only. */
export function createBoundarySelectorContext(contextBoundaries = []) {
  const models = new WeakMap();
  const values = contextBoundaries.map((boundary) => {
    const model = boundaryModel(boundary);
    models.set(boundary, model);
    return model;
  });
  return {
    kind: 'boundary-selector-context',
    models,
    values,
    events: allEvents(values),
    eventMatchCounts: new Map(),
  };
}

const contextFor = (contextBoundaries) =>
  boundaryContext(contextBoundaries)
    ? contextBoundaries
    : createBoundarySelectorContext(contextBoundaries);
const modelFor = (context, boundary) => {
  const existing = context.models.get(boundary);
  if (existing) return existing;
  const model = boundaryModel(boundary);
  context.models.set(boundary, model);
  return model;
};
const branchMatches = (condition, value) => {
  if (!same(condition.use, value.use)) return false;
  if (condition.domain === 'all') return true;
  const [lower, upper] = condition.domain;
  const parameter = value.period
    ? value.parameter +
      Math.round(((lower + upper) / 2 - value.parameter) / value.period) *
        value.period
    : value.parameter;
  return parameter >= lower - tolerance && parameter <= upper + tolerance;
};
const eventMatches = (condition, value) => {
  if (condition.branches.length !== value.branches.length) return false;
  const used = new Set();
  const match = (index) => {
    if (index === condition.branches.length) return true;
    return value.branches.some((branch, candidate) => {
      if (
        used.has(candidate) ||
        !branchMatches(condition.branches[index], branch)
      )
        return false;
      used.add(candidate);
      const result = match(index + 1);
      used.delete(candidate);
      return result;
    });
  };
  return match(0);
};

const eventMatchCount = (condition, context) => {
  const eventKey = key(condition);
  if (!context.eventMatchCounts.has(eventKey))
    context.eventMatchCounts.set(
      eventKey,
      context.events.filter((candidate) => eventMatches(condition, candidate))
        .length,
    );
  return context.eventMatchCounts.get(eventKey);
};

function eventCondition(value, context) {
  // Domains are named in the authored curve parameter frame at selection time.
  // Canonical dyadic subdivision distinguishes repeated intersections without
  // numbering intersection order or saving their current coordinate/parameter.
  if (value.branches.length < 2) throw Error('非闭合边界缺少可解释的交点');
  for (let depth = -1; depth < 40; depth++) {
    const condition = {
      kind: 'intersection',
      branches: value.branches.map((branch) => {
        if (depth === -1 || branch.use.kind !== 'curve-use')
          return { use: branch.use, domain: 'all' };
        const scale = 2 ** (depth - 1);
        const lower = (Math.floor(branch.parameter * scale) - 0.25) / scale;
        return { use: branch.use, domain: [lower, lower + 1.5 / scale] };
      }),
    };
    if (eventMatchCount(condition, context) === 1) return condition;
  }
  throw Error('交点在声明的逻辑参数域内不能唯一确定');
}

const rotations = (ring) =>
  ring.map((_, i) => [...ring.slice(i), ...ring.slice(0, i)]);
const reversed = (ring) =>
  ring
    .slice()
    .reverse()
    .map((run) =>
      run.closed ? run : { ...run, start: run.end, end: run.start },
    );
const canonicalRing = (ring) =>
  [...rotations(ring), ...rotations(reversed(ring))].sort((a, b) =>
    key(a).localeCompare(key(b)),
  )[0];

export function createBoundarySelector(
  boundary,
  contextBoundaries = [boundary],
) {
  const context = contextFor(contextBoundaries),
    model = modelFor(context, boundary);
  const allBranches = (event) => ({
    kind: 'intersection',
    branches: event.branches.map((branch) => ({
      use: branch.use,
      domain: 'all',
    })),
  });
  const build = (eventSelector) => {
    const ring = (runs) =>
      canonicalRing(
        runs.map((run) => ({
          sources: run.sources,
          ...(run.closed
            ? { closed: true }
            : {
                start: eventSelector(run.start),
                end: eventSelector(run.end),
              }),
        })),
      );
    return {
      kind: 'cell',
      outer: ring(model.outer),
      holes: sorted(model.holes.map(ring)),
    };
  };
  // Uniqueness belongs to the complete face predicate, not each individual
  // intersection. Do not pin an otherwise unique face to arbitrary parameter
  // boxes merely because one source pair intersects elsewhere in the graph.
  const broad = build(allBranches);
  if (context.values.filter((value) => modelMatches(broad, value)).length === 1)
    return broad;
  return build((event) => eventCondition(event, context));
}

function ringMatches(selector, runs) {
  const matchRun = (condition, run) =>
    same(condition.sources, run.sources) &&
    (condition.closed === true
      ? run.closed
      : !run.closed &&
        eventMatches(condition.start, run.start) &&
        eventMatches(condition.end, run.end));
  if (selector.length !== runs.length) return false;
  return [...rotations(runs), ...rotations(reversed(runs))].some((rotation) =>
    selector.every((run, i) => matchRun(run, rotation[i])),
  );
}

export function matchesBoundarySelector(selector, boundary, contextBoundaries) {
  if (selector.kind !== 'cell') return false;
  const context = contextFor(contextBoundaries),
    model = modelFor(context, boundary);
  return modelMatches(selector, model);
}

function modelMatches(selector, model) {
  if (
    !ringMatches(selector.outer, model.outer) ||
    selector.holes.length !== model.holes.length
  )
    return false;
  const used = new Set();
  for (const condition of selector.holes) {
    const matches = model.holes.flatMap((hole, index) =>
      !used.has(index) && ringMatches(condition, hole) ? [index] : [],
    );
    if (matches.length !== 1) return false;
    used.add(matches[0]);
  }
  return true;
}
