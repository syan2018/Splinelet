import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { buildDependencyGraph } from '../../../src/lib/construction/dependencies.mjs';
import { evaluateConstruction } from '../../../src/lib/construction/evaluate.mjs';
import { createOperatorRegistry } from '../../../src/lib/construction/registry.mjs';
import { createEvaluationSnapshot } from '../../../src/lib/construction/snapshot.mjs';

let ids = 0;
const idFactory = () => `id-${++ids}`;
const document = createDocument({ idFactory });
const shape = (id, programId, x = 0) => ({
  id,
  name: id,
  kind: 'shape',
  parentId: null,
  order: x,
  pose: { translationMM: [x, 0], rotationRad: 0 },
  visible: true,
  locked: false,
  programId,
});
document.nodes.sourceShape = shape('sourceShape', 'sourceProgram');
document.nodes.receiverShape = shape('receiverShape', 'receiverProgram', 3);
document.nodes.emptyShape = shape('emptyShape', 'emptyProgram', 6);
document.programs.sourceProgram = {
  id: 'sourceProgram',
  ownerNodeId: 'sourceShape',
  operators: {
    source: {
      id: 'source',
      type: 'source',
      name: 'Source',
      enabled: true,
      inputs: {
        paths: [
          {
            kind: 'sketch',
            sketchId: 'sourceSketch',
            pathIds: ['path-1'],
          },
        ],
      },
      params: {},
    },
  },
  outputs: {
    curves: {
      kind: 'port',
      ownerNodeId: 'sourceShape',
      operatorId: 'source',
      port: 'curves',
      domain: 'curves',
    },
  },
};
document.programs.receiverProgram = {
  id: 'receiverProgram',
  ownerNodeId: 'receiverShape',
  operators: {
    local: {
      id: 'local',
      type: 'pass',
      name: 'Local',
      enabled: true,
      inputs: {
        input: [
          {
            kind: 'port',
            ownerNodeId: 'sourceShape',
            operatorId: 'source',
            port: 'curves',
            domain: 'curves',
            space: 'local-result',
            transform: [1, 0, 0, 1, 2, 0],
          },
        ],
      },
      params: {},
    },
    world: {
      id: 'world',
      type: 'pass',
      name: 'World',
      enabled: true,
      inputs: {
        input: [
          {
            kind: 'port',
            ownerNodeId: 'sourceShape',
            operatorId: 'source',
            port: 'curves',
            domain: 'curves',
            space: 'world-result',
            transform: [1, 0, 0, 1, 0, 0],
          },
        ],
      },
      params: {},
    },
    stage: {
      id: 'stage',
      type: 'test-multi-output',
      name: 'Test multi-output',
      enabled: true,
      inputs: {
        input: [
          {
            kind: 'port',
            ownerNodeId: 'receiverShape',
            operatorId: 'local',
            port: 'curves',
            domain: 'curves',
            space: 'local-result',
            transform: [1, 0, 0, 1, 0, 0],
          },
        ],
      },
      params: {},
    },
  },
  outputs: {
    curves: {
      kind: 'port',
      ownerNodeId: 'receiverShape',
      operatorId: 'stage',
      port: 'curves',
      domain: 'curves',
    },
    regions: {
      kind: 'port',
      ownerNodeId: 'receiverShape',
      operatorId: 'stage',
      port: 'regions',
      domain: 'regions',
    },
  },
};
document.programs.emptyProgram = {
  id: 'emptyProgram',
  ownerNodeId: 'emptyShape',
  operators: {
    empty: {
      id: 'empty',
      type: 'empty',
      name: 'Empty',
      enabled: true,
      inputs: {},
      params: {},
    },
  },
  outputs: {
    curves: {
      kind: 'port',
      ownerNodeId: 'emptyShape',
      operatorId: 'empty',
      port: 'curves',
      domain: 'curves',
    },
  },
};

let evaluations = 0;
let sourceResolutions = 0;
const registry = createOperatorRegistry([
  {
    type: 'source',
    inputPorts: { paths: { domain: 'curves', min: 1, max: 1 } },
    outputPorts: { curves: { domain: 'curves' } },
    dependencies: () => [
      'sketch:missing-source',
      'parameter:height',
      'datum:origin',
      'relation:anchor',
    ],
    evaluate: ({ inputs }) => ({ curves: inputs.paths[0] }),
  },
  {
    type: 'pass',
    inputPorts: { input: { domain: 'curves', min: 1, max: 1 } },
    outputPorts: { curves: { domain: 'curves' } },
    evaluate: ({ inputs }) => {
      evaluations += 1;
      return { curves: inputs.input[0] };
    },
    bypass: { curves: 'input' },
    rebase: (operator) => operator,
  },
  {
    type: 'test-multi-output',
    inputPorts: { input: { domain: 'curves', min: 1, max: 1 } },
    outputPorts: {
      curves: { domain: 'curves' },
      regions: { domain: 'regions' },
    },
    evaluate: ({ inputs, operator }) => ({
      curves: operator.params.invalidDto
        ? {
            domain: 'curves',
            status: 'ready',
            diagnostics: [],
            dependencies: [],
          }
        : inputs.input[0],
      regions: {
        domain: 'regions',
        status: 'blocked',
        diagnostics: [{ code: 'open', message: 'open contour' }],
        value: { mustNotLeak: true },
        dependencies: [],
      },
    }),
  },
  {
    type: 'empty',
    inputPorts: {},
    outputPorts: { curves: { domain: 'curves' } },
    evaluate: () => ({
      curves: {
        domain: 'curves',
        status: 'empty',
        value: {
          frame: { kind: 'local', ownerNodeId: 'emptyShape' },
          curves: [],
          junctions: [],
          provenance: [],
        },
        diagnostics: [],
        dependencies: [],
      },
    }),
  },
]);
const resolveSketch = ({ sketchId, pathIds }) => {
  if (sketchId !== 'sourceSketch' || pathIds?.[0] !== 'path-1')
    throw Error('unexpected Sketch resolver call');
  sourceResolutions += 1;
  return {
    domain: 'curves',
    status: 'ready',
    value: {
      frame: { kind: 'local', ownerNodeId: 'sourceShape' },
      curves: [
        {
          key: 'edge-1',
          edges: [
            {
              key: 'edge-1',
              cubic: [
                [0, 0],
                [1, 0],
                [2, 0],
                [3, 0],
              ],
            },
          ],
        },
      ],
      junctions: [],
      provenance: [],
    },
    diagnostics: [],
    dependencies: [
      'sketch:sourceSketch',
      'parameter:height',
      'datum:origin',
      'relation:anchor',
    ],
  };
};

const cache = new Map();
let evaluated = evaluateConstruction(document, {
  registry,
  cache,
  resolveSketch,
});
assert.equal(evaluated.published['receiverShape:curves'].status, 'ready');
assert.equal(evaluated.published['receiverShape:regions'].status, 'blocked');
assert.equal(
  evaluated.components['operator:source'].ports.curves.status,
  'ready',
  'downstream failure does not erase current upstream curves',
);
assert.equal(
  evaluated.components['operator:stage'].ports.regions.status,
  'blocked',
);
assert.equal(
  'value' in evaluated.components['operator:stage'].ports.regions,
  false,
  'blocked results never leak a stale or partial value',
);
assert.deepEqual(
  evaluated.components['operator:stage'].ports.curves.value.curves[0].edges[0]
    .cubic[0],
  [2, 0],
  'each port input is mapped to its receiver-local frame before evaluation',
);
assert.equal(
  evaluated.components['operator:stage'].ports.curves.value.frame.ownerNodeId,
  'receiverShape',
);
assert.equal(evaluations, 2);
assert.equal(
  sourceResolutions,
  1,
  'Source data is resolved through the injected resolver',
);
assert.equal(evaluated.published['emptyShape:curves'].status, 'empty');
assert.equal(
  evaluateConstruction(document, {
    registry,
    cache,
    requestedDomains: ['curves'],
    resolveSketch,
  }).published['receiverShape:regions'].status,
  'absent',
  'unrequested domains remain absent rather than empty',
);

const graph = buildDependencyGraph(document, registry);
assert(
  !graph.components
    .get('operator:local')
    .dependencyKeys.has('node:receiverShape:world'),
);
assert(
  graph.components
    .get('operator:world')
    .dependencyKeys.has('node:receiverShape:world'),
);
assert(
  graph.components
    .get('operator:world')
    .dependencyKeys.has('node:sourceShape:world'),
);
for (const key of [
  'sketch:missing-source',
  'parameter:height',
  'datum:origin',
  'relation:anchor',
])
  assert(
    graph.dependencyNodes.has(key),
    `component DAG records ${key} as a concrete dependency node`,
  );

const recolored = structuredClone(document);
recolored.appearances.swatches.red = {
  id: 'red',
  name: 'Red',
  color: '#ff0000',
};
evaluated = evaluateConstruction(recolored, {
  registry,
  cache,
  resolveSketch,
});
assert.equal(
  evaluations,
  2,
  'appearance-only edits reuse planar construction cache',
);

const moved = structuredClone(recolored);
moved.nodes.receiverShape.pose.translationMM[0] = 8;
evaluated = evaluateConstruction(moved, { registry, cache, resolveSketch });
assert.equal(
  evaluations,
  3,
  'receiver movement invalidates only world-result consumer',
);

const movedSource = structuredClone(moved);
movedSource.nodes.sourceShape.pose.translationMM[0] = 9;
evaluated = evaluateConstruction(movedSource, {
  registry,
  cache,
  resolveSketch,
});
assert.equal(
  evaluations,
  4,
  'source movement also invalidates the world-result consumer',
);

const bypassed = structuredClone(document);
bypassed.programs.receiverProgram.operators.local.enabled = false;
evaluated = evaluateConstruction(bypassed, { registry, resolveSketch });
assert.equal(
  evaluated.components['operator:local'].ports.curves.status,
  'ready',
);
assert.deepEqual(
  evaluated.components['operator:local'].ports.curves.value.curves[0].edges[0]
    .cubic[0],
  [2, 0],
  'disabled bypass retains the evaluator-applied input frame',
);
const disabledFill = structuredClone(document);
disabledFill.programs.receiverProgram.operators.stage.enabled = false;
evaluated = evaluateConstruction(disabledFill, { registry, resolveSketch });
assert.equal(
  evaluated.components['operator:stage'].ports.regions.status,
  'blocked',
);
assert.equal(
  evaluated.components['operator:stage'].ports.regions.diagnostics[0].code,
  'disabled-without-bypass',
);

const unknown = structuredClone(document);
unknown.programs.receiverProgram.operators.stage.type = 'future-stage';
evaluated = evaluateConstruction(unknown, { registry, resolveSketch });
assert.equal(
  evaluated.components['operator:stage'].ports.regions.status,
  'blocked',
);
assert.equal(
  evaluated.components['operator:stage'].ports.regions.diagnostics[0].code,
  'unknown-operator',
);

const spoofedOwner = structuredClone(document);
spoofedOwner.programs.receiverProgram.operators.local.inputs.input[0].ownerNodeId =
  'receiverShape';
evaluated = evaluateConstruction(spoofedOwner, { registry, resolveSketch });
assert.equal(
  evaluated.components['operator:local'].ports.curves.status,
  'blocked',
  'a PortRef cannot read an operator published by a different owner',
);

const invalidDto = structuredClone(document);
invalidDto.programs.receiverProgram.operators.stage.params.invalidDto = true;
evaluated = evaluateConstruction(invalidDto, { registry, resolveSketch });
assert.equal(
  evaluated.components['operator:stage'].ports.curves.status,
  'blocked',
  'ready without a valid DTO is rejected rather than treated as success',
);
assert.equal(
  evaluated.components['operator:stage'].ports.curves.diagnostics[0].code,
  'invalid-result-dto',
);

const cycle = structuredClone(document);
cycle.programs.receiverProgram.operators.local.inputs.input[0] = {
  kind: 'port',
  ownerNodeId: 'receiverShape',
  operatorId: 'world',
  port: 'curves',
  domain: 'curves',
  space: 'local-result',
  transform: [1, 0, 0, 1, 0, 0],
};
cycle.programs.receiverProgram.operators.world.inputs.input[0] = {
  kind: 'port',
  ownerNodeId: 'receiverShape',
  operatorId: 'local',
  port: 'curves',
  domain: 'curves',
  space: 'local-result',
  transform: [1, 0, 0, 1, 0, 0],
};
evaluated = evaluateConstruction(cycle, { registry, resolveSketch });
assert.equal(
  evaluated.components['operator:local'].ports.curves.status,
  'blocked',
);
assert.equal(
  evaluated.components['operator:world'].ports.curves.status,
  'blocked',
);
assert.match(
  evaluated.diagnostics.find((item) => item.code === 'dependency-cycle')
    .message,
  /operator:local/,
);

const snapshot = createEvaluationSnapshot({
  epoch: 'open-1',
  revision: 7,
  previewId: 'preview-2',
  ...evaluated,
});
assert.equal(snapshot.epoch, 'open-1');
assert.throws(() => {
  snapshot.published = {};
}, /read only|Cannot assign/);
assert.doesNotThrow(() => structuredClone(snapshot));
assert.deepEqual(
  document.nodes.receiverShape.pose.translationMM,
  [3, 0],
  'evaluation never writes the source document',
);

console.log(
  'PASS: typed V4 evaluation dispatches per-port states, dependencies, cache, cycles, and readonly snapshots without real Fill',
);
