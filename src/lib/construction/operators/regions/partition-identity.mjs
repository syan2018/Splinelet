const text = (value) => JSON.stringify(value);
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const mapId = (value, idMap) => idMap[value] || value;

const splitStructured = (value, separator) => {
  const parts = [];
  let start = 0,
    depth = 0,
    quoted = false,
    escaped = false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '[' || character === '{') depth++;
    else if (character === ']' || character === '}') depth--;
    else if (character === separator && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  if (quoted || depth !== 0)
    throw Error('partition identity contains invalid JSON');
  parts.push(value.slice(start));
  return parts;
};

const remapCompositeCurveKey = (value, idMap) => {
  if (idMap[value]) return idMap[value];
  for (const [before, after] of Object.entries(idMap)) {
    const marker = `@${before}:`;
    const position = value.lastIndexOf(marker);
    if (position < 0 || !/^\d+$/.test(value.slice(position + marker.length)))
      continue;
    return `${remapCompositeCurveKey(value.slice(0, position), idMap)}@${after}:${value.slice(position + marker.length)}`;
  }
  return value;
};

const normalizeInstances = (instances, idMap) =>
  instances.map((instance) => ({
    ...structuredClone(instance),
    operatorId: mapId(instance.operatorId, idMap),
  }));

const normalizeEdgeToken = (value, idMap) => {
  let token;
  try {
    token = JSON.parse(value);
  } catch {
    throw Error('partition cutter identity is not an edge token');
  }
  if (
    !Array.isArray(token) ||
    token.length !== 3 ||
    typeof token[0] !== 'string' ||
    typeof token[1] !== 'string' ||
    !Array.isArray(token[2])
  )
    throw Error('partition cutter identity is not an edge token');
  return text([
    mapId(token[0], idMap),
    mapId(token[1], idMap),
    normalizeInstances(token[2], idMap),
  ]);
};

const normalizeLineage = (lineage, idMap) =>
  lineage.map((token) => normalizeEncoded(token, idMap)).sort(compare);

const normalizeOutputKeyValue = (value, idMap) => {
  if (!Array.isArray(value) || typeof value[0] !== 'string')
    throw Error('partition base identity is not a construction output key');
  const tag = value[0];
  if (tag === 'fill') return [tag, normalizeLineage(value[1], idMap)];
  if (tag === 'path')
    return [tag, value[1], remapCompositeCurveKey(value[2], idMap)];
  if (tag === 'stroke')
    return [
      tag,
      remapCompositeCurveKey(value[1], idMap),
      value[2].map((token) => normalizeEdgeToken(token, idMap)).sort(compare),
    ];
  if (tag === 'between')
    return [
      tag,
      remapCompositeCurveKey(value[1], idMap),
      remapCompositeCurveKey(value[2], idMap),
      value[3].map((token) => normalizeEdgeToken(token, idMap)).sort(compare),
    ];
  if (tag === 'offset') return [tag, normalizeOutputKey(value[1], idMap)];
  if (tag === 'region-array')
    return [tag, normalizeOutputKey(value[1], idMap), value[2]];
  if (tag === 'region-reference')
    return [
      tag,
      normalizeOutputKey(value[1], idMap),
      normalizeInstances(value[2], idMap),
    ];
  if (tag === 'boolean')
    return [
      tag,
      value[1],
      normalizeOutputKey(value[2], idMap),
      normalizeLineage(value[3], idMap),
    ];
  if (tag === 'partition')
    return [
      tag,
      normalizeOutputKey(value[1], idMap),
      normalizePartitionTopology(value[2], idMap),
    ];
  throw Error(`partition base identity uses unsupported output key ${tag}`);
};

function normalizeOutputKey(value, idMap) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw Error('partition base identity is not encoded JSON');
  }
  return text(normalizeOutputKeyValue(parsed, idMap));
}

const normalizeSource = (value, idMap) => {
  const direction = value.at(-1);
  if (!['+', '-'].includes(direction))
    throw Error('partition contour source has no direction');
  const source = value.slice(0, -1);
  if (source.startsWith('base:'))
    return `base:${normalizeOutputKey(source.slice(5), idMap)}${direction}`;
  if (source.startsWith('cutter:')) {
    const tokens = splitStructured(source.slice(7), '|')
      .map((token) => normalizeEdgeToken(token, idMap))
      .sort(compare);
    return `cutter:${tokens.join('|')}${direction}`;
  }
  throw Error('partition contour source has an unsupported kind');
};

const normalizeLabel = (value, idMap) =>
  [
    ...new Set(
      splitStructured(value, '&').map((source) =>
        normalizeSource(source, idMap),
      ),
    ),
  ]
    .sort(compare)
    .join('&');

const normalizeRing = (value, idMap) => {
  let labels;
  try {
    labels = JSON.parse(value);
  } catch {
    throw Error('partition contour ring is not encoded JSON');
  }
  if (
    !Array.isArray(labels) ||
    labels.some((label) => typeof label !== 'string')
  )
    throw Error('partition contour ring is invalid');
  const normalized = labels.map((label) => normalizeLabel(label, idMap));
  return (
    normalized
      .map((_, index) =>
        text([...normalized.slice(index), ...normalized.slice(0, index)]),
      )
      .sort(compare)[0] || '[]'
  );
};

function normalizePartitionTopology(value, idMap) {
  let topology;
  try {
    topology = JSON.parse(value);
  } catch {
    throw Error('partition topology is not encoded JSON');
  }
  if (
    !Array.isArray(topology) ||
    topology.length !== 2 ||
    typeof topology[0] !== 'string' ||
    !Array.isArray(topology[1])
  )
    throw Error('partition topology is invalid');
  return text([
    normalizeRing(topology[0], idMap),
    topology[1].map((ring) => normalizeRing(ring, idMap)).sort(compare),
  ]);
}

function normalizeEncoded(value, idMap) {
  if (typeof value !== 'string') return value;
  if (idMap[value]) return idMap[value];
  if (value[0] !== '[') return remapCompositeCurveKey(value, idMap);
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return remapCompositeCurveKey(value, idMap);
  }
  if (
    Array.isArray(parsed) &&
    parsed.length === 3 &&
    typeof parsed[0] === 'string' &&
    typeof parsed[1] === 'string' &&
    Array.isArray(parsed[2]) &&
    parsed[2].every((item) => item && typeof item === 'object')
  )
    return normalizeEdgeToken(value, idMap);
  if (
    Array.isArray(parsed) &&
    parsed.length === 2 &&
    typeof parsed[0] === 'string' &&
    Array.isArray(parsed[1]) &&
    (() => {
      try {
        return Array.isArray(JSON.parse(parsed[0]));
      } catch {
        return false;
      }
    })()
  )
    return normalizePartitionTopology(value, idMap);
  return text(normalizeOutputKeyValue(parsed, idMap));
}

const regionOutputTags = new Set([
  'fill',
  'path',
  'stroke',
  'between',
  'offset',
  'region-array',
  'region-reference',
  'boolean',
  'partition',
]);

export const isCanonicalRegionOutputKey = (value) => {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && regionOutputTags.has(parsed[0]);
  } catch {
    return false;
  }
};

export const remapCanonicalRegionOutputReference = (reference, idMap) => ({
  ...structuredClone(reference),
  ownerNodeId: mapId(reference.ownerNodeId, idMap),
  operatorId: mapId(reference.operatorId, idMap),
  key: normalizeOutputKey(reference.key, idMap),
  lineage: normalizeLineage(reference.lineage, idMap),
  instances: normalizeInstances(reference.instances, idMap),
});

export const remapPartitionOperator = (operator, idMap) => {
  const copied = structuredClone(operator);
  if (copied.params.endpointJoin) {
    copied.params.endpointJoin.cohorts = copied.params.endpointJoin.cohorts.map(
      (cohort) => cohort.map((pathId) => mapId(pathId, idMap)),
    );
    if (copied.params.endpointJoin.disabled)
      copied.params.endpointJoin.disabled =
        copied.params.endpointJoin.disabled.map((item) => ({
          ...item,
          pathId: mapId(item.pathId, idMap),
        }));
  }
  if (copied.outputContract)
    copied.outputContract.members = copied.outputContract.members.map(
      (member) => ({
        ...member,
        key: normalizeOutputKey(member.key, idMap),
        lineage: normalizeLineage(member.lineage, idMap),
        ...(member.topology
          ? { topology: normalizePartitionTopology(member.topology, idMap) }
          : {}),
      }),
    );
  return copied;
};
