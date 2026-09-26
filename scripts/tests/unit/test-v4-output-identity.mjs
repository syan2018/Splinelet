import assert from 'node:assert/strict';
import {
  createOutputIdentity,
  createOutputRefIndex,
  outputIdentity,
  sameOutputRef,
} from '../../../src/lib/construction/output-identity.mjs';
import {
  proposeAssignmentInheritance,
  resolveOutputReference,
  resolveRegionScope,
} from '../../../src/lib/construction/provenance.mjs';
import {
  partForRelief,
  isExcluded,
} from '../../../src/lib/manufacturing/parts.mjs';
import { resolveAppearance } from '../../../src/lib/relief/appearance.mjs';
import { createOutputQueries } from '../../../src/lib/relief/output-queries.mjs';
import { resolveReliefDefinition } from '../../../src/lib/relief/resolve.mjs';

const legacyStable = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(legacyStable).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${legacyStable(value[key])}`)
    .join(',')}}`;
};
const legacyIdentity = (ref) =>
  legacyStable([
    ref.ownerNodeId,
    ref.operatorId,
    ref.port,
    ref.key,
    ref.instances,
    ref.lineage,
  ]);
const legacySame = (left, right) =>
  legacyIdentity(left) === legacyIdentity(right);

const ref = (
  ownerNodeId = 'shape-a',
  operatorId = 'fill-a',
  port = 'regions',
  key = 'region-a',
  lineage = ['edge:a'],
  instances = [],
) => ({
  kind: 'output',
  ownerNodeId,
  operatorId,
  port,
  key,
  lineage,
  instances,
});
const region = (value) => ({ ref: value });
const assignment = (id, target, value) => ({ id, target, value });

function legacyResolveRegionScope(regions, scope) {
  if (scope?.kind === 'all')
    return { status: 'ready', selected: regions, untouched: [] };
  if (scope?.kind !== 'selected' || !Array.isArray(scope.refs))
    throw Error('区域作用范围必须明确为 all 或 selected');
  const identities = new Set();
  const diagnostics = [];
  for (const reference of scope.refs) {
    const matches = regions.filter((item) => legacySame(item.ref, reference));
    if (matches.length !== 1)
      diagnostics.push({
        code: 'unresolved-scope',
        ref: reference,
        message: '所选区域无法唯一解析',
        candidates: matches.map((item) => item.ref),
      });
    else identities.add(legacyIdentity(matches[0].ref));
  }
  if (diagnostics.length) return { status: 'blocked', diagnostics };
  return {
    status: 'ready',
    selected: regions.filter((item) =>
      identities.has(legacyIdentity(item.ref)),
    ),
    untouched: regions.filter(
      (item) => !identities.has(legacyIdentity(item.ref)),
    ),
  };
}

function legacyInheritance(regions, assignments) {
  const proposals = [];
  const conflicts = [];
  const unresolved = [];
  const used = new Set();
  for (const item of regions) {
    const exact = assignments.filter((candidate) =>
      legacySame(candidate.target, item.ref),
    );
    const candidates = exact.length
      ? exact
      : assignments.filter(
          (candidate) =>
            candidate.target.ownerNodeId === item.ref.ownerNodeId &&
            legacyStable(candidate.target.instances) ===
              legacyStable(item.ref.instances) &&
            candidate.target.lineage.length &&
            candidate.target.lineage.every((token) =>
              item.ref.lineage.includes(token),
            ),
        );
    if (!candidates.length) continue;
    candidates.forEach((candidate) => used.add(candidate.id));
    if (
      new Set(candidates.map((candidate) => legacyStable(candidate.value)))
        .size > 1
    )
      conflicts.push({
        target: item.ref,
        assignmentIds: candidates.map((candidate) => candidate.id),
      });
    else
      proposals.push({
        target: item.ref,
        value: structuredClone(candidates[0].value),
        assignmentIds: candidates.map((candidate) => candidate.id),
      });
  }
  for (const item of assignments)
    if (!used.has(item.id)) unresolved.push(structuredClone(item));
  return { proposals, conflicts, unresolved };
}

// A deterministic product of valid, but not necessarily normalized, wire refs.
const combinations = [];
for (const owner of ['shape-a', 'shape-b'])
  for (const key of ['region-a', 'region-b'])
    for (const lineage of [
      ['edge:a', 'edge:b'],
      ['edge:b', 'edge:a'],
      ['edge:a', 'edge:a'],
    ])
      for (const instances of [
        [],
        [{ operatorId: 'array-a', index: 0 }],
        [
          { operatorId: 'array-a', index: 0 },
          { operatorId: 'mirror-a', index: 1 },
        ],
      ])
        combinations.push(
          ref(owner, 'fill-a', 'regions', key, lineage, instances),
        );

for (const value of combinations)
  assert.equal(outputIdentity(value), legacyIdentity(value));
for (const left of combinations)
  for (const right of combinations)
    assert.equal(sameOutputRef(left, right), legacySame(left, right));

// Non-schema values remain null-safe and retain the old encoding wherever it
// was previously callable. The construction wrapper intentionally still rejects
// null; this runtime helper is used by diagnostic/read-only paths.
const malformed = [
  {},
  { ownerNodeId: 'shape-a' },
  { ...ref(), instances: [undefined] },
  { ...ref(), lineage: [undefined] },
  { ...ref(), instances: [{ index: 0, operatorId: 'array-a' }] },
  { ...ref(), lineage: ['edge:a'], extra: { ignored: true } },
];
for (const value of malformed)
  assert.equal(outputIdentity(value), legacyIdentity(value));
for (const left of malformed)
  for (const right of malformed)
    assert.equal(sameOutputRef(left, right), legacySame(left, right));
assert.doesNotThrow(() => outputIdentity(null));
assert.doesNotThrow(() => sameOutputRef(null, undefined));
assert.equal(sameOutputRef(null, undefined), true);

const indexedItems = [
  ...combinations
    .slice(0, 8)
    .map((target, index) => ({ id: `valid-${index}`, target })),
  ...malformed.map((target, index) => ({ id: `malformed-${index}`, target })),
];
const index = createOutputRefIndex(indexedItems, (item) => item.target);
for (const query of [...combinations.slice(0, 10), ...malformed])
  assert.deepEqual(
    index.get(query).map((item) => item.id),
    indexedItems
      .filter((item) => legacySame(item.target, query))
      .map((item) => item.id),
  );
const returned = index.get(combinations[0]);
const expectedLength = returned.length;
returned.length = 0;
assert.equal(index.get(combinations[0]).length, expectedLength);

const selectedRegions = [
  region(combinations[0]),
  region(combinations[1]),
  region(combinations[0]),
];
for (const scope of [
  { kind: 'all' },
  { kind: 'selected', refs: [combinations[1]] },
  { kind: 'selected', refs: [combinations[0]] },
  { kind: 'selected', refs: [{ ...combinations[1], key: 'missing' }] },
])
  assert.deepEqual(
    resolveRegionScope(selectedRegions, scope),
    legacyResolveRegionScope(selectedRegions, scope),
  );

// Construction references kept the old filter's lazy null behavior: a missing
// reference throws only after a non-empty region set requires a comparison.
for (const missing of [null, undefined]) {
  assert.throws(
    () => resolveOutputReference([region(combinations[0])], missing),
    TypeError,
  );
  assert.throws(
    () =>
      resolveRegionScope([region(combinations[0])], {
        kind: 'selected',
        refs: [missing],
      }),
    TypeError,
  );
  assert.deepEqual(resolveOutputReference([], missing), {
    status: 'unresolved',
    candidates: [],
  });
  assert.deepEqual(
    resolveRegionScope([], { kind: 'selected', refs: [missing] }),
    {
      status: 'blocked',
      diagnostics: [
        {
          code: 'unresolved-scope',
          ref: missing,
          message: '所选区域无法唯一解析',
          candidates: [],
        },
      ],
    },
  );
}
assert.throws(
  () => resolveRegionScope([region(null)], { kind: 'selected', refs: [] }),
  TypeError,
);

const inherited = ref(
  'shape-a',
  'derived',
  'regions',
  'derived',
  ['edge:a', 'edge:b', 'child'],
  [{ operatorId: 'array-a', index: 0 }],
);
const exact = structuredClone(inherited);
const inheritedAssignments = [
  assignment(
    'subset-first',
    { ...inherited, key: 'old-a', lineage: ['edge:a'] },
    { swatchId: 'red' },
  ),
  assignment(
    'subset-second',
    { ...inherited, key: 'old-b', lineage: ['edge:b'] },
    { swatchId: 'red' },
  ),
  assignment(
    'wrong-instances',
    { ...inherited, key: 'old-c', instances: [] },
    { swatchId: 'red' },
  ),
  assignment(
    'empty-lineage',
    { ...inherited, key: 'old-d', lineage: [] },
    { swatchId: 'red' },
  ),
];
assert.deepEqual(
  proposeAssignmentInheritance([region(inherited)], inheritedAssignments),
  legacyInheritance([region(inherited)], inheritedAssignments),
);
const exactPriorityAssignments = [
  assignment('exact', exact, { swatchId: 'green' }),
  assignment(
    'would-inherit',
    { ...inherited, key: 'old', lineage: ['edge:a'] },
    { swatchId: 'blue' },
  ),
];
assert.deepEqual(
  proposeAssignmentInheritance([region(inherited)], exactPriorityAssignments),
  legacyInheritance([region(inherited)], exactPriorityAssignments),
);
const duplicateExact = [
  assignment('duplicate-1', exact, { swatchId: 'gold' }),
  assignment('duplicate-2', structuredClone(exact), { swatchId: 'blue' }),
];
assert.deepEqual(
  proposeAssignmentInheritance([region(inherited)], duplicateExact),
  legacyInheritance([region(inherited)], duplicateExact),
);

const mutable = ref('shape-a', 'fill-a', 'regions', 'mutable', ['before']);
const memoBeforeEdit = createOutputIdentity();
const before = memoBeforeEdit(mutable);
mutable.lineage = ['after'];
assert.notEqual(outputIdentity(mutable), before);
assert.equal(
  memoBeforeEdit(mutable),
  before,
  'memo belongs to its original synchronous operation',
);
assert.equal(createOutputIdentity()(mutable), outputIdentity(mutable));

const target = ref('shape-a', 'fill-a', 'regions', 'painted', ['edge:a']);
const document = {
  appearances: {
    defaults: { 'shape-a': { swatchId: 'default' } },
    swatches: {
      default: { color: '#000000' },
      red: { color: '#ff0000' },
      blue: { color: '#0000ff' },
    },
    overrides: {
      'appearance-one': assignment('appearance-one', target, {
        swatchId: 'red',
      }),
      'appearance-two': assignment('appearance-two', structuredClone(target), {
        swatchId: 'blue',
      }),
    },
  },
  reliefDefinitions: {
    defaults: {},
    overrides: {
      'relief-one': assignment('relief-one', target, { enabled: true }),
      'relief-two': assignment('relief-two', structuredClone(target), {
        enabled: false,
      }),
    },
  },
  manufacturing: {
    defaultPartId: 'main',
    parts: { main: { id: 'main' }, alternate: { id: 'alternate' } },
    assignments: {
      'part-one': { id: 'part-one', target, partId: 'main' },
      'part-two': {
        id: 'part-two',
        target: structuredClone(target),
        partId: 'alternate',
      },
    },
    excluded: [structuredClone(target), structuredClone(target)],
  },
};
const conflictingQueries = createOutputQueries(document);
assert.equal(
  resolveAppearance(document, 'shape-a', target, conflictingQueries).status,
  'blocked',
);
assert.equal(
  resolveReliefDefinition(document, 'shape-a', target, conflictingQueries)
    .status,
  'blocked',
);
assert.throws(
  () => partForRelief(document, { ref: target }, conflictingQueries),
  /多个制造 Part/,
);
assert.equal(isExcluded(document, { ref: target }, conflictingQueries), true);

delete document.appearances.overrides['appearance-two'];
delete document.reliefDefinitions.overrides['relief-two'];
delete document.manufacturing.assignments['part-two'];
document.appearances.overrides['appearance-one'].target.lineage = [
  'after-command',
];
const changedTarget = { ...target, lineage: ['after-command'] };
const freshQueries = createOutputQueries(document);
assert.deepEqual(
  resolveAppearance(document, 'shape-a', changedTarget, freshQueries),
  resolveAppearance(document, 'shape-a', changedTarget),
);
assert.deepEqual(
  resolveReliefDefinition(document, 'shape-a', changedTarget, freshQueries),
  resolveReliefDefinition(document, 'shape-a', changedTarget),
);
assert.equal(
  partForRelief(document, { ref: changedTarget }, freshQueries),
  partForRelief(document, { ref: changedTarget }),
);
assert.equal(
  isExcluded(document, { ref: changedTarget }, freshQueries),
  isExcluded(document, { ref: changedTarget }),
);

console.log(
  'PASS: V4 output identity preserves legacy matching, ordering, conflicts, and operation-scoped query semantics.',
);
