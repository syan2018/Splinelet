import { resolveAppearance, sameOutputRef } from './appearance.mjs';
import {
  assignmentsForTarget,
  proposeOutputAssignmentInheritance,
  unresolvedAssignments,
} from './assignments.mjs';

const clone = (value) => structuredClone(value);
const unique = (values) => [...new Set(values)];
const diagnostic = (kind, message, ref) => ({
  severity: 'error',
  kind,
  ...(ref && { ref }),
  message,
});
const stage = (status, value, diagnostics = [], dependencies = []) => ({
  domain: 'relief',
  status,
  ...(value === undefined ? {} : { value }),
  diagnostics,
  dependencies: unique(dependencies),
});
const blocked = (diagnostics, dependencies) =>
  stage('blocked', undefined, diagnostics, dependencies);

const defaultRelief = () => ({
  enabled: false,
  thickness: { kind: 'mm', value: 1 },
  mode: 'add',
  placement: { kind: 'free', zMM: 0 },
});
const validOutputRef = (ref) =>
  ref &&
  ref.kind === 'output' &&
  ['ownerNodeId', 'operatorId', 'port', 'key'].every(
    (key) => typeof ref[key] === 'string' && ref[key],
  ) &&
  Array.isArray(ref.instances) &&
  Array.isArray(ref.lineage);

function normalizeResults(regionResults) {
  if (Array.isArray(regionResults)) return regionResults;
  if (regionResults && typeof regionResults === 'object')
    return [regionResults];
  return [];
}

/** Authored defaults and overrides, including disabled regions. This read does
 * not depend on successful thickness/placement/body evaluation. */
export function resolveReliefDefinition(document, shapeId, target) {
  const matches = assignmentsForTarget(
    Object.values(document.reliefDefinitions?.overrides || {}),
    target,
  );
  if (matches.length > 1)
    return {
      status: 'blocked',
      diagnostics: [
        diagnostic(
          'conflicting-assignment',
          '同一输出存在多个 relief override',
          target,
        ),
      ],
    };
  return {
    status: 'ready',
    value: clone({
      ...defaultRelief(),
      ...document.reliefDefinitions?.defaults?.[shapeId],
      ...matches[0]?.value,
    }),
  };
}

function invalidAssignments(document, regions) {
  const all = [
    ...Object.values(document.appearances?.overrides || {}),
    ...Object.values(document.reliefDefinitions?.overrides || {}),
  ];
  return unresolvedAssignments(regions, all).map((assignment) =>
    diagnostic(
      'unresolved-reference',
      `赋值目标未在当前 RegionSet 中唯一解析：${assignment.id}`,
      assignment.target,
    ),
  );
}

/**
 * Turns read-only RegionSet stage results into ReliefSet members. It preserves
 * per-output color, thickness authority, mode, and placement intent; T10 owns
 * layer/mm conversion and all placement/manufacturing solving.
 */
export function resolveRelief(document, regionResults) {
  const inputs = normalizeResults(regionResults);
  const dependencies = [];
  const diagnostics = [];
  const regions = [];
  let sawEmpty = false;
  let sawAbsent = false;
  for (const input of inputs) {
    if (!input || input.domain !== 'regions')
      return blocked(
        [
          diagnostic(
            'invalid-input',
            'resolveRelief 需要 RegionSet StageResult',
          ),
        ],
        dependencies,
      );
    dependencies.push(...(input.dependencies || []));
    diagnostics.push(...(input.diagnostics || []));
    if (input.status === 'blocked')
      return blocked(
        [...diagnostics, diagnostic('blocked-input', '上游 RegionSet 被阻断')],
        dependencies,
      );
    if (input.status === 'absent') {
      sawAbsent = true;
      continue;
    }
    if (input.status === 'empty') {
      sawEmpty = true;
      continue;
    }
    if (input.status !== 'ready' || !Array.isArray(input.value?.regions))
      return blocked(
        [...diagnostics, diagnostic('invalid-input', 'RegionSet DTO 无效')],
        dependencies,
      );
    regions.push(...input.value.regions);
  }
  if (!regions.length) {
    if (sawAbsent && !sawEmpty)
      return stage('absent', undefined, diagnostics, dependencies);
    return stage(
      'empty',
      {
        reliefs: [],
        provenance: [],
        assignmentProposals: { appearance: [], relief: [] },
      },
      diagnostics,
      dependencies,
    );
  }

  const invalid = invalidAssignments(document, regions);
  if (invalid.length)
    return blocked([...diagnostics, ...invalid], dependencies);
  const reliefs = [];
  for (const region of regions) {
    if (!validOutputRef(region.ref) || !region.geometry)
      return blocked(
        [
          ...diagnostics,
          diagnostic(
            'invalid-region',
            'Region 缺少完整 OutputRef 或 geometry',
            region.ref,
          ),
        ],
        dependencies,
      );
    const shape = document?.nodes?.[region.ref.ownerNodeId];
    if (!shape || shape.kind !== 'shape')
      return blocked(
        [
          ...diagnostics,
          diagnostic(
            'unresolved-reference',
            'Region OutputRef owner Shape 不存在',
            region.ref,
          ),
        ],
        dependencies,
      );
    const appearance = resolveAppearance(document, shape.id, region.ref);
    if (appearance.status !== 'ready')
      return blocked([...diagnostics, ...appearance.diagnostics], dependencies);
    const definition = resolveReliefDefinition(document, shape.id, region.ref);
    if (definition.status !== 'ready')
      return blocked([...diagnostics, ...definition.diagnostics], dependencies);
    // A default swatch is presentation only. It cannot turn an unpainted
    // candidate into an enabled product member.
    if (!definition.value.enabled) continue;
    reliefs.push({
      ref: clone(region.ref),
      geometry: clone(region.geometry),
      color: appearance.value.color,
      swatchId: appearance.value.swatchId,
      enabled: true,
      thickness: clone(definition.value.thickness),
      mode: definition.value.mode,
      placement: clone(definition.value.placement),
    });
  }
  const appearanceAssignments = Object.values(
    document.appearances?.overrides || {},
  );
  const reliefAssignments = Object.values(
    document.reliefDefinitions?.overrides || {},
  );
  const value = {
    reliefs,
    provenance: reliefs.map((relief) => ({
      ref: clone(relief.ref),
      sources: clone(relief.ref.lineage),
    })),
    // Proposals are informational and never affect the effective values above.
    assignmentProposals: {
      appearance: proposeOutputAssignmentInheritance(
        regions,
        appearanceAssignments,
      ),
      relief: proposeOutputAssignmentInheritance(regions, reliefAssignments),
    },
  };
  return stage(
    reliefs.length ? 'ready' : 'empty',
    value,
    diagnostics,
    dependencies,
  );
}

export const resolveReliefOutput = (document, regionResults, target) => {
  const result = resolveRelief(document, regionResults);
  if (result.status !== 'ready') return result;
  const matches = result.value.reliefs.filter((relief) =>
    sameOutputRef(relief.ref, target),
  );
  return matches.length === 1
    ? {
        ...result,
        value: {
          ...result.value,
          reliefs: matches,
          provenance: result.value.provenance.filter((item) =>
            sameOutputRef(item.ref, target),
          ),
        },
      }
    : blocked(
        [diagnostic('unresolved-reference', 'Relief 输出未唯一解析', target)],
        result.dependencies,
      );
};
