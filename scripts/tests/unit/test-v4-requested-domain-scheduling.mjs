import assert from 'node:assert/strict';
import { evaluateConstruction } from '../../../src/lib/construction/evaluate.mjs';
import { createOperatorRegistry } from '../../../src/lib/construction/registry.mjs';

const node = (id) => ({
  id,
  parentId: null,
  pose: { translationMM: [0, 0], rotationRad: 0 },
});
const port = (ownerNodeId, operatorId, name, domain) => ({
  kind: 'port',
  ownerNodeId,
  operatorId,
  port: name,
  domain,
  space: 'local-result',
  transform: [1, 0, 0, 1, 0, 0],
});
const stage = (domain, ownerNodeId) => ({
  domain,
  status: 'empty',
  diagnostics: [],
  dependencies: [],
  value:
    domain === 'curves'
      ? {
          frame: { kind: 'local', ownerNodeId },
          curves: [],
          junctions: [],
          provenance: [],
        }
      : {
          frame: { kind: 'local', ownerNodeId },
          regions: [],
          provenance: [],
        },
});
const program = (ownerNodeId, operator, output) => ({
  ownerNodeId,
  operators: { [operator.id]: operator },
  outputs: {
    [output.domain]: port(ownerNodeId, operator.id, output.name, output.domain),
  },
});
const operator = (id, type, inputs = {}) => ({
  id,
  type,
  name: id,
  enabled: true,
  inputs,
  params: {},
});
const baseDocument = (programs) => ({
  id: 'requested-domain-schedule',
  version: 4,
  geometrySettings: { curveToleranceMM: 0.1 },
  nodes: Object.fromEntries(
    Object.values(programs).map((entry) => [
      entry.ownerNodeId,
      node(entry.ownerNodeId),
    ]),
  ),
  sketches: {},
  datums: {},
  relations: {},
  parameters: {},
  programs,
});

const calls = new Map();
const counted = (operator, ownerNodeId, domain) => {
  calls.set(operator.id, (calls.get(operator.id) || 0) + 1);
  return stage(domain, ownerNodeId);
};
const registry = createOperatorRegistry([
  {
    type: 'curve-source',
    inputPorts: {},
    outputPorts: { curves: { domain: 'curves' } },
    evaluate: ({ operator, ownerNodeId }) => ({
      curves: counted(operator, ownerNodeId, 'curves'),
    }),
  },
  {
    type: 'region-source',
    inputPorts: {},
    outputPorts: { regions: { domain: 'regions' } },
    evaluate: ({ operator, ownerNodeId }) => ({
      regions: counted(operator, ownerNodeId, 'regions'),
    }),
  },
  {
    type: 'curve-from-region',
    inputPorts: { input: { domain: 'regions', min: 1, max: 1 } },
    outputPorts: { curves: { domain: 'curves' } },
    evaluate: ({ operator, ownerNodeId }) => ({
      curves: counted(operator, ownerNodeId, 'curves'),
    }),
  },
  {
    type: 'region-pass',
    inputPorts: { input: { domain: 'regions', min: 1, max: 1 } },
    outputPorts: { regions: { domain: 'regions' } },
    evaluate: ({ operator, ownerNodeId }) => ({
      regions: counted(operator, ownerNodeId, 'regions'),
    }),
  },
]);

const independent = baseDocument({
  curves: program('curves', operator('curve-source', 'curve-source'), {
    name: 'curves',
    domain: 'curves',
  }),
  regions: program('regions', operator('region-source', 'region-source'), {
    name: 'regions',
    domain: 'regions',
  }),
});
const onlyCurves = evaluateConstruction(independent, {
  registry,
  requestedDomains: ['curves'],
});
assert.equal(calls.get('curve-source'), 1);
assert.equal(calls.get('region-source') || 0, 0);
assert.deepEqual(Object.keys(onlyCurves.components), ['operator:curve-source']);
assert.equal(onlyCurves.published['regions:regions'].status, 'absent');

const complete = evaluateConstruction(independent, { registry });
const explicitlyComplete = evaluateConstruction(independent, {
  registry,
  requestedDomains: ['curves', 'regions'],
});
assert.deepEqual(
  explicitlyComplete,
  complete,
  'all requested domains preserve full evaluation results',
);

calls.clear();
const upstream = baseDocument({
  regions: program('regions', operator('upstream-region', 'region-source'), {
    name: 'regions',
    domain: 'regions',
  }),
  curves: program(
    'curves',
    operator('curve-needs-region', 'curve-from-region', {
      input: [port('regions', 'upstream-region', 'regions', 'regions')],
    }),
    { name: 'curves', domain: 'curves' },
  ),
});
evaluateConstruction(upstream, { registry, requestedDomains: ['curves'] });
assert.deepEqual(Object.fromEntries(calls), {
  'upstream-region': 1,
  'curve-needs-region': 1,
});

calls.clear();
const cache = new Map();
evaluateConstruction(independent, {
  registry,
  cache,
  requestedDomains: ['curves'],
});
evaluateConstruction(independent, { registry, cache });
evaluateConstruction(independent, {
  registry,
  cache,
  requestedDomains: ['curves'],
});
assert.deepEqual(
  Object.fromEntries(calls),
  { 'curve-source': 1, 'region-source': 1 },
  'switching requested domains reuses retained component cache entries',
);

calls.clear();
const cyclic = baseDocument({
  curves: program('curves', operator('independent-curve', 'curve-source'), {
    name: 'curves',
    domain: 'curves',
  }),
  a: program(
    'a',
    operator('cycle-a', 'region-pass', {
      input: [port('b', 'cycle-b', 'regions', 'regions')],
    }),
    { name: 'regions', domain: 'regions' },
  ),
  b: program(
    'b',
    operator('cycle-b', 'region-pass', {
      input: [port('a', 'cycle-a', 'regions', 'regions')],
    }),
    { name: 'regions', domain: 'regions' },
  ),
});
const curveSlice = evaluateConstruction(cyclic, {
  registry,
  requestedDomains: ['curves'],
});
assert.equal(
  curveSlice.components['operator:independent-curve'].ports.curves.status,
  'empty',
);
assert.equal(calls.get('independent-curve'), 1);
assert.equal(calls.get('cycle-a') || 0, 0);
assert.equal(calls.get('cycle-b') || 0, 0);
assert.equal(
  curveSlice.diagnostics.some(
    (diagnostic) => diagnostic.code === 'dependency-cycle',
  ),
  false,
  'unrequested cycles do not diagnose or block a selected domain',
);
const regionSlice = evaluateConstruction(cyclic, {
  registry,
  requestedDomains: ['regions'],
});
assert.equal(
  regionSlice.diagnostics.filter(
    (diagnostic) => diagnostic.code === 'dependency-cycle',
  ).length,
  2,
  'requested cycles remain diagnosed per component',
);
assert.equal(
  regionSlice.components['operator:cycle-a'].ports.regions.status,
  'blocked',
);
assert.equal(
  regionSlice.components['operator:cycle-b'].ports.regions.status,
  'blocked',
);

console.log(
  'PASS: requested construction domains schedule matching outputs and upstream dependencies only',
);
