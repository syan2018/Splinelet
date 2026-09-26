import { resolveAppearance, sameOutputRef } from './appearance.mjs';
import { aggregateReliefBranches } from '../evaluation/branch-stages.mjs';
import { createOutputQueries } from './output-queries.mjs';
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
export function resolveReliefDefinition(document, shapeId, target, queries) {
  const matches =
    queries?.relief(target) ??
    assignmentsForTarget(
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
      ...(matches[0]?.suppressed ? { enabled: false } : {}),
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
export function resolveReliefBranch(
  document,
  regionResults,
  queries,
  appearanceResult = null,
) {
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
    if (
      document.version === 5 &&
      input.diagnostics?.some((item) => item.severity === 'error')
    )
      return blocked(diagnostics, dependencies);
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
  const invalid = invalidAssignments(document, regions);
  if (invalid.length)
    return blocked([...diagnostics, ...invalid], dependencies);
  const resolvedAppearances = new Map();
  if (appearanceResult) {
    if (appearanceResult.domain !== 'appearance')
      return blocked(
        [
          ...diagnostics,
          diagnostic('invalid-input', 'Relief 需要 AppearanceSet'),
        ],
        dependencies,
      );
    dependencies.push(...(appearanceResult.dependencies || []));
    diagnostics.push(...(appearanceResult.diagnostics || []));
    if (appearanceResult.status === 'blocked')
      return blocked(
        [
          ...diagnostics,
          diagnostic('blocked-input', '上游 AppearanceSet 被阻断'),
        ],
        dependencies,
      );
    if (
      appearanceResult.status === 'ready' &&
      Array.isArray(appearanceResult.value?.appearances)
    )
      for (const appearance of appearanceResult.value.appearances)
        resolvedAppearances.set(JSON.stringify(appearance.ref), appearance);
    else if (regions.length)
      return blocked(
        [...diagnostics, diagnostic('invalid-input', 'AppearanceSet DTO 无效')],
        dependencies,
      );
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
    const cachedAppearance = appearanceResult
      ? resolvedAppearances.get(JSON.stringify(region.ref))
      : null;
    const appearance = cachedAppearance
      ? { status: 'ready', value: cachedAppearance }
      : resolveAppearance(document, shape.id, region.ref, queries);
    if (appearance.status !== 'ready')
      return blocked([...diagnostics, ...appearance.diagnostics], dependencies);
    const definition = resolveReliefDefinition(
      document,
      shape.id,
      region.ref,
      queries,
    );
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
      appearance:
        document.version === 5
          ? []
          : proposeOutputAssignmentInheritance(regions, appearanceAssignments),
      relief:
        document.version === 5
          ? []
          : proposeOutputAssignmentInheritance(regions, reliefAssignments),
    },
  };
  return stage(
    reliefs.length ? 'ready' : 'empty',
    value,
    diagnostics,
    dependencies,
  );
}

export function resolveRelief(
  document,
  regionResults,
  queries = createOutputQueries(document),
) {
  const byOwner = new Map();
  for (const input of normalizeResults(regionResults)) {
    const owners = input?.ownerNodeId
      ? [input.ownerNodeId]
      : [
          ...new Set(
            (input?.value?.regions || []).map(
              (region) => region.ref?.ownerNodeId,
            ),
          ),
        ];
    for (const ownerNodeId of owners.length ? owners : [null]) {
      const branch =
        ownerNodeId && input?.status === 'ready'
          ? {
              ...input,
              value: {
                ...input.value,
                regions: input.value.regions.filter(
                  (region) => region.ref?.ownerNodeId === ownerNodeId,
                ),
              },
            }
          : input;
      if (!byOwner.has(ownerNodeId)) byOwner.set(ownerNodeId, []);
      byOwner.get(ownerNodeId).push(branch);
    }
  }
  // Missing publication still leaves an authored assignment unresolved.
  for (const assignment of [
    ...Object.values(document.appearances?.overrides || {}),
    ...Object.values(document.reliefDefinitions?.overrides || {}),
  ]) {
    const owner = assignment.target.ownerNodeId;
    if (!byOwner.has(null) && !byOwner.has(owner)) byOwner.set(owner, []);
  }
  const scope = (record, owner) => ({
    ...record,
    overrides: Object.fromEntries(
      Object.entries(record?.overrides || {}).filter(
        ([, item]) => !owner || item.target.ownerNodeId === owner,
      ),
    ),
  });
  return aggregateReliefBranches(
    'relief',
    [...byOwner].map(([ownerNodeId, inputs]) => ({
      ownerNodeId,
      ...resolveReliefBranch(
        {
          ...document,
          appearances: scope(document.appearances, ownerNodeId),
          reliefDefinitions: scope(document.reliefDefinitions, ownerNodeId),
        },
        inputs,
        queries,
      ),
    })),
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
