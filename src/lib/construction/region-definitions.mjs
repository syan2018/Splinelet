import { stableIdentityValue, outputIdentity } from './output-identity.mjs';
import { makeOutputRef } from './provenance.mjs';
import { sha256 } from '../project-container.mjs';
import {
  createBoundarySelector,
  createBoundarySelectorContext,
  matchesBoundarySelector,
} from './boundary-selector.mjs';

const clone = (value) => structuredClone(value);
export const selectorKey = stableIdentityValue;
export const boundarySelector = createBoundarySelector;

export function definitionRef(definition) {
  const { ownerNodeId, operatorId, port, instances } = definition.context;
  return makeOutputRef(
    ownerNodeId,
    operatorId,
    port,
    definition.id,
    [],
    instances,
  );
}

/** Pure interpretation: definitions are never added or repaired by evaluation.
 * Unbound cells retain evaluation-local handles; commands alone can bind them. */
export function resolveRegionDefinitions(
  document,
  ownerNodeId,
  operatorId,
  candidates,
  { diagnostics = [], dependencies = [], provenance = [] } = {},
) {
  const definitions = Object.values(document.regionDefinitions).filter(
    (item) =>
      item.context.ownerNodeId === ownerNodeId &&
      item.context.operatorId === operatorId &&
      item.context.port === 'regions',
  );
  const boundaries = candidates
    .filter((candidate) => candidate.selector.kind === 'cell')
    .flatMap((candidate) => candidate.boundaries);
  const boundaryContext = createBoundarySelectorContext(boundaries);
  const records = candidates.map((candidate) => {
    const selector =
      candidate.selector.kind === 'cell'
        ? createBoundarySelector(candidate.boundaries[0], boundaryContext)
        : candidate.selector;
    return {
      ...candidate,
      selector,
      ref: makeOutputRef(
        ownerNodeId,
        operatorId,
        'regions',
        `cell:${sha256(new TextEncoder().encode(selectorKey([ownerNodeId, operatorId, candidate.instances || [], selector, candidate.geometry])))}`,
        [],
        candidate.instances || [],
      ),
    };
  });
  const assigned = new Set();
  const issues = [...diagnostics];
  for (const definition of definitions) {
    const matches = records.filter(
      (region) =>
        selectorKey(region.ref.instances) ===
          selectorKey(definition.context.instances) &&
        (definition.selector.kind === 'cell'
          ? region.selector.kind === 'cell' &&
            matchesBoundarySelector(
              definition.selector,
              region.boundaries[0],
              boundaryContext,
            )
          : selectorKey(definition.selector) === selectorKey(region.selector)),
    );
    if (matches.length !== 1 || assigned.has(matches[0])) {
      issues.push({
        code: matches.length
          ? 'region-definition-ambiguous'
          : 'region-definition-missing',
        severity: 'error',
        ref: definitionRef(definition),
        message: matches.length
          ? '区域定义不能唯一解析到一个当前目标'
          : '区域定义的边界条件不再成立',
      });
      continue;
    }
    assigned.add(matches[0]);
    matches[0].ref = definitionRef(definition);
  }
  return {
    domain: 'regions',
    status: records.length ? 'ready' : 'empty',
    value: {
      frame: { kind: 'local', ownerNodeId },
      regions: records,
      provenance,
    },
    diagnostics: issues,
    dependencies,
  };
}

const walkReferences = (value, visit) => {
  if (!value || typeof value !== 'object') return;
  if (value.kind === 'output') {
    visit(value);
    return;
  }
  for (const child of Object.values(value)) walkReferences(child, visit);
};

export function hasUnboundRegionReferences(document) {
  if (document.version !== 5) return false;
  let unbound = false;
  walkReferences(document, (ref) => {
    if (ref.key.startsWith('cell:')) unbound = true;
  });
  return unbound;
}

/** Bind only handles explicitly referenced by an author transaction, including
 * the dependencies of their selectors. The supplied evaluation is read-only. */
export function bindReferencedRegions(document, planar, idFactory, extra = []) {
  if (document.version !== 5) return new Map();
  const candidates = new Map();
  for (const component of Object.values(planar.components))
    for (const stage of Object.values(component.ports))
      if (stage.domain === 'regions')
        for (const region of stage.value?.regions || []) {
          if (region.ref.operatorId === component.id.slice('operator:'.length))
            candidates.set(outputIdentity(region.ref), region);
        }
  const replacements = new Map();
  const queue = [];
  walkReferences(document, (ref) => {
    if (ref.key.startsWith('cell:')) queue.push(ref);
  });
  for (let index = 0; index < queue.length; index++) {
    const ref = queue[index],
      key = outputIdentity(ref);
    if (replacements.has(key)) continue;
    const region = candidates.get(key);
    if (!region?.selector) throw Error('所选面已过期或没有可保存的区域定义');
    const duplicates = [...candidates.values()].filter(
      (item) =>
        item.ref.operatorId === ref.operatorId &&
        item.ref.ownerNodeId === ref.ownerNodeId &&
        selectorKey([item.selector, item.ref.instances]) ===
          selectorKey([region.selector, ref.instances]),
    );
    if (duplicates.length !== 1)
      throw Error('当前边界条件不足以唯一命名所选面');
    const definition = {
      id: idFactory(),
      context: {
        ownerNodeId: ref.ownerNodeId,
        operatorId: ref.operatorId,
        port: ref.port,
        instances: clone(ref.instances),
      },
      selector: clone(region.selector),
    };
    if (!definition.id || document.regionDefinitions[definition.id])
      throw Error('区域定义 ID 重复或无效');
    document.regionDefinitions[definition.id] = definition;
    replacements.set(key, definitionRef(definition));
    walkReferences(definition.selector, (parent) => {
      if (parent.key.startsWith('cell:')) queue.push(parent);
    });
  }
  const remap = (ref) => {
    const replacement = replacements.get(outputIdentity(ref));
    if (replacement) Object.assign(ref, clone(replacement));
  };
  walkReferences(document, remap);
  for (const value of extra) walkReferences(value, remap);
  return replacements;
}
