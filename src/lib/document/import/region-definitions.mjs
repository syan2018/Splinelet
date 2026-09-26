import { validateDocument } from '../schema.mjs';
import { initializeDocumentBasis } from '../../geometry/path-basis.mjs';
import {
  evaluatePlanar,
  declarativeConstructionRegistry,
} from '../../construction/document-evaluation.mjs';
import { createOperatorRegistry } from '../../construction/registry.mjs';
import {
  outputIdentity,
  stableIdentityValue,
} from '../../construction/output-identity.mjs';
import { definitionRef } from '../../construction/region-definitions.mjs';
import { readGeometry, polygonParts } from '../../region-engine.mjs';
import { validateDurableRegionReferences } from '../region-reference-validation.mjs';

const clone = (value) => structuredClone(value);
const walk = (value, visit) => {
  if (!value || typeof value !== 'object') return;
  if (value.kind === 'output') {
    visit(value);
    return;
  }
  for (const child of Object.values(value)) walk(child, visit);
};
const ownRegions = (stage, operatorId) =>
  (stage?.value?.regions || []).filter(
    (region) => region.ref.operatorId === operatorId,
  );
const assertEvaluated = (planar) => {
  const errors = [];
  for (const [id, component] of Object.entries(planar.components))
    for (const [port, stage] of Object.entries(component.ports))
      if (
        stage.status === 'blocked' ||
        stage.diagnostics?.some((item) => item.severity === 'error')
      )
        errors.push(
          `${id}.${port}: ${stage.diagnostics.map((item) => item.message).join('；')}`,
        );
  if (errors.length) throw Error(`区域迁移无法验证：\n${errors.join('\n')}`);
};

/** One-time import conversion. The legacy snapshot is a witness for a strict
 * bijection, never a runtime identity cache. No input document is mutated. */
export function migrateRegionDefinitions(
  source,
  { idFactory = () => globalThis.crypto.randomUUID() } = {},
) {
  validateDocument(source);
  if (source.version === 5)
    return { document: clone(source), report: { kind: 'native', regions: 0 } };
  const before = evaluatePlanar(source);
  assertEvaluated(before);
  const document = initializeDocumentBasis({
    ...clone(source),
    version: 5,
    evaluationSemanticsVersion: 1,
    regionDefinitions: {},
  });
  for (const program of Object.values(document.programs))
    for (const operator of Object.values(program.operators))
      delete operator.outputContract;
  const mapped = new Map();
  const definitions = new Map();
  const witnesses = [];
  const tolerance = source.geometrySettings.numericTolerance;
  const equivalent = (a, b) => {
    const left = readGeometry(a),
      right = readGeometry(b);
    if (!left.isValid() || !right.isValid()) return false;
    const topology = (geometry) =>
      polygonParts(geometry)
        .map((part) => part.getNumInteriorRing())
        .sort((a, b) => a - b);
    if (
      stableIdentityValue(topology(left)) !==
      stableIdentityValue(topology(right))
    )
      return false;
    // Snap rounding may move each boundary by one numeric grid unit. This bound
    // is independent of curve sampling tolerance and is not a nearest-face rule.
    const areaLimit =
      tolerance * (left.getLength() + right.getLength() + tolerance) * 4;
    return left.symDifference(right).getArea() <= areaLimit;
  };
  const registry = createOperatorRegistry(
    declarativeConstructionRegistry.types().map((type) => {
      const spec = declarativeConstructionRegistry.get(type);
      if (!spec.outputPorts.regions) return spec;
      return {
        ...spec,
        evaluate(args) {
          const result = spec.evaluate(args),
            stage = result.regions;
          if (!['ready', 'empty'].includes(stage.status)) return result;
          const operatorId = args.operator.id;
          const previous = ownRegions(
            before.components[`operator:${operatorId}`]?.ports.regions,
            operatorId,
          );
          const current = ownRegions(stage, operatorId);
          if (previous.length !== current.length)
            throw Error(
              `区域迁移输出数量不一致 ${operatorId}: ${previous.length} → ${current.length}`,
            );
          const used = new Set();
          for (const region of current) {
            const matches = previous.filter(
              (old) =>
                !used.has(old) &&
                stableIdentityValue(old.ref.instances) ===
                  stableIdentityValue(region.ref.instances) &&
                equivalent(old.geometry, region.geometry),
            );
            if (matches.length !== 1)
              throw Error(
                `区域迁移没有唯一几何见证 ${operatorId}: ${matches.length}`,
              );
            const old = matches[0];
            used.add(old);
            const definition = {
              id: idFactory(),
              context: {
                ownerNodeId: args.ownerNodeId,
                operatorId,
                port: 'regions',
                instances: clone(region.ref.instances),
              },
              selector: clone(region.selector),
            };
            if (!definition.id || definitions.has(definition.id))
              throw Error('迁移区域 ID 重复');
            definitions.set(definition.id, definition);
            mapped.set(outputIdentity(old.ref), definitionRef(definition));
            witnesses.push({
              ref: definitionRef(definition),
              geometry: region.geometry,
            });
            // During this conversion pass only, downstream legacy scopes consume
            // their exact old refs. The final document contains no legacy keys.
            region.ref = clone(old.ref);
          }
          return result;
        },
      };
    }),
  );
  assertEvaluated(evaluatePlanar(document, { registry }));
  const required = new Set();
  const remap = (ref) => {
    const target = mapped.get(outputIdentity(ref));
    if (!target) throw Error(`旧区域引用没有迁移见证 ${ref.operatorId}`);
    Object.assign(ref, clone(target));
    required.add(target.key);
  };
  walk(document, remap);
  // Selectors can refer to upstream declared results; retain their full closure.
  for (const id of required) {
    const definition = definitions.get(id);
    walk(definition.selector, remap);
    document.regionDefinitions[id] = definition;
  }
  validateDocument(document);
  validateDurableRegionReferences(document);
  const after = evaluatePlanar(document);
  assertEvaluated(after);
  for (const { ref, geometry } of witnesses) {
    if (!required.has(ref.key)) continue;
    const current =
      after.components[`operator:${ref.operatorId}`]?.ports.regions?.value
        ?.regions || [];
    const matches = current.filter(
      (region) => outputIdentity(region.ref) === outputIdentity(ref),
    );
    if (matches.length !== 1 || !equivalent(geometry, matches[0].geometry))
      throw Error(`迁移后的声明不能复现原区域 ${ref.operatorId}`);
  }
  return {
    document,
    report: {
      kind: 'region-definitions',
      regions: required.size,
      verifiedOutputs: witnesses.length,
    },
  };
}
