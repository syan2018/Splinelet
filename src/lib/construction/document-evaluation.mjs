import { validateDocument } from '../document/schema.mjs';
import { resolveSketch } from '../geometry/sketch.mjs';
import { resolveRelation } from '../geometry/relations.mjs';
import { resolveScalar } from '../geometry/parameters.mjs';
import { resolveDatum } from '../geometry/datums.mjs';
import { evaluateConstruction } from './evaluate.mjs';
import { createOperatorRegistry } from './registry.mjs';
import { curveOperatorSpecifications } from './operators/curves/index.mjs';
import { regionOperatorSpecifications } from './operators/regions/index.mjs';
import { fillCurves } from './operators/regions/fill.mjs';
import { declarativeRegionSpecification } from './operators/regions/declarative.mjs';
import { regionSelectOperator } from './operators/regions/select.mjs';
import { curveEndpointAttachOperator } from './operators/curves/endpoint-attach.mjs';
import { regionSnapshotSourceOperator } from './operators/regions/snapshot-source.mjs';

export const fillOperator = {
  type: 'fill',
  inputPorts: { input: { domain: 'curves', min: 1, max: 1 } },
  outputPorts: { regions: { domain: 'regions' } },
  validateParams: (params) =>
    ['even-odd', 'non-zero'].includes(params.rule) || 'Fill 需要明确填充规则',
  dependencies: () => ['settings:geometry'],
  evaluate: ({ document, ownerNodeId, operator, inputs }) => ({
    regions: fillCurves(inputs.input[0].value, {
      ownerNodeId,
      operatorId: operator.id,
      rule: operator.params.rule,
      geometrySettings: document.geometrySettings,
    }),
  }),
  rebase: (operator) => structuredClone(operator),
  copy: (operator) => structuredClone(operator),
};

export const defaultConstructionRegistry = createOperatorRegistry([
  ...curveOperatorSpecifications,
  fillOperator,
  ...regionOperatorSpecifications.map((specification) => ({
    ...specification,
    dependencies: (args) => [
      'settings:geometry',
      ...(specification.dependencies?.(args) || []),
    ],
  })),
]);

export const declarativeConstructionRegistry = createOperatorRegistry([
  ...curveOperatorSpecifications,
  regionSelectOperator,
  curveEndpointAttachOperator,
  regionSnapshotSourceOperator,
  ...[fillOperator, ...regionOperatorSpecifications].map((specification) => ({
    ...declarativeRegionSpecification(specification),
    dependencies: (args) => [
      'settings:geometry',
      ...(specification.dependencies?.(args) || []),
    ],
  })),
]);

// One adapter binds source/finite-relation services. Source consumes only its
// selected paths while the relation resolver can still read referenced entities.
export function evaluatePlanar(document, inputOptions = {}) {
  const { registry: suppliedRegistry, ...options } = inputOptions;
  const registry =
    suppliedRegistry ||
    (document.version === 5
      ? declarativeConstructionRegistry
      : defaultConstructionRegistry);
  validateDocument(document);
  const cacheInputStages =
    !suppliedRegistry &&
    ![
      options.resolveSketch,
      options.resolveScalar,
      options.resolveDatum,
      options.resolveRelation,
    ].some((resolver) => typeof resolver === 'function');
  return evaluateConstruction(document, {
    ...options,
    registry,
    cacheInputStages,
    resolveSketch: ({ document: current, sketchId, pathIds, ownerNodeId }) => {
      const source = current.sketches[sketchId];
      if (
        !source ||
        source.ownerNodeId !== ownerNodeId ||
        pathIds?.some((id) => !Object.hasOwn(source.paths, id))
      )
        return {
          domain: 'curves',
          status: 'blocked',
          diagnostics: [
            {
              code: 'invalid-source',
              message: 'Source 来源缺失或不属于当前部件',
            },
          ],
          dependencies: [`sketch:${sketchId}`],
        };
      const sketch = pathIds
        ? {
            ...source,
            paths: Object.fromEntries(
              pathIds.map((id) => [id, source.paths[id]]),
            ),
          }
        : source;
      const result = resolveSketch(
        { ...current, sketches: { ...current.sketches, [sketchId]: sketch } },
        sketchId,
        {
          resolveRelation: (args) =>
            resolveRelation({ ...args, document: current }),
        },
      );
      return {
        ...result,
        dependencies: [...result.dependencies, 'settings:geometry'],
      };
    },
    resolveScalar: ({ value }) => resolveScalar(document, value),
    resolveDatum: (id) => resolveDatum(document, id),
    resolveRelation: (args) => resolveRelation({ ...args, document }),
    ...Object.fromEntries(
      ['resolveSketch', 'resolveScalar', 'resolveDatum', 'resolveRelation']
        .filter((name) => typeof options[name] === 'function')
        .map((name) => [name, options[name]]),
    ),
  });
}

export function evaluateProgram(
  document,
  nodeId,
  registry = document.version === 5
    ? declarativeConstructionRegistry
    : defaultConstructionRegistry,
  context = {},
) {
  if (document.nodes[nodeId]?.kind !== 'shape')
    throw Error('Program 必须属于现有部件');
  const result = evaluatePlanar(document, { ...context, registry });
  const absent = (domain) => ({
    domain,
    status: 'absent',
    diagnostics: [],
    dependencies: [],
  });
  return {
    nodeId,
    curves: result.published[`${nodeId}:curves`] || absent('curves'),
    regions: result.published[`${nodeId}:regions`] || absent('regions'),
    components: result.components,
  };
}
