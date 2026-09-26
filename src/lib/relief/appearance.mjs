import {
  createOutputRefIndex,
  sameOutputRef,
} from '../construction/output-identity.mjs';
export {
  outputIdentity,
  sameOutputRef,
} from '../construction/output-identity.mjs';

const diagnostic = (kind, message, ref) => ({
  severity: 'error',
  kind,
  ...(ref && { ref }),
  message,
});
const ready = (value) => ({ status: 'ready', value, diagnostics: [] });
const blocked = (item) => ({
  status: 'blocked',
  value: null,
  diagnostics: [item],
});

export function resolveSwatch(document, swatchId) {
  if (swatchId === undefined || swatchId === null)
    return ready({ swatchId: null, color: null });
  const swatch = document?.appearances?.swatches?.[swatchId];
  if (!swatch)
    return blocked(
      diagnostic('unresolved-reference', `色卡不存在：${swatchId}`, {
        kind: 'swatch',
        id: swatchId,
      }),
    );
  return ready({ swatchId, color: swatch.color });
}

/** Resolves default appearance first, then exactly one local output override. */
export function resolveAppearance(document, shapeId, target, queries) {
  const overrides =
    queries?.appearance(target) ??
    Object.values(document?.appearances?.overrides || {}).filter((assignment) =>
      sameOutputRef(assignment.target, target),
    );
  if (overrides.length > 1)
    return blocked(
      diagnostic(
        'conflicting-assignment',
        '同一输出存在多个 appearance override',
        target,
      ),
    );
  const swatchId =
    overrides[0]?.value?.swatchId ??
    document?.appearances?.defaults?.[shapeId]?.swatchId ??
    null;
  return resolveSwatch(document, swatchId);
}

const stage = (status, value, diagnostics = [], dependencies = []) => ({
  domain: 'appearance',
  status,
  ...(value === undefined ? {} : { value }),
  diagnostics,
  dependencies: [...new Set(dependencies)],
});

/**
 * Read-only AppearanceSet for one owner branch. It deliberately keeps
 * unpainted regions as `{ color: null, swatchId: null }`: paint intent is
 * authored by Relief, not inferred from a display default.
 */
export function resolveAppearanceBranch(document, regionResults, queries) {
  const inputs = Array.isArray(regionResults) ? regionResults : [regionResults];
  const dependencies = [];
  const diagnostics = [];
  const regions = [];
  let sawEmpty = false;
  let sawAbsent = false;
  for (const input of inputs) {
    if (!input || input.domain !== 'regions')
      return stage('blocked', undefined, [
        {
          severity: 'error',
          kind: 'invalid-input',
          message: 'Appearance 需要 RegionSet StageResult',
        },
      ]);
    dependencies.push(...(input.dependencies || []));
    diagnostics.push(...(input.diagnostics || []));
    if (
      document.version === 5 &&
      input.diagnostics?.some((item) => item.severity === 'error')
    )
      return stage('blocked', undefined, diagnostics, dependencies);
    if (input.status === 'blocked')
      return stage(
        'blocked',
        undefined,
        [
          ...diagnostics,
          {
            severity: 'error',
            kind: 'blocked-input',
            message: '上游 RegionSet 被阻断',
          },
        ],
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
      return stage(
        'blocked',
        undefined,
        [
          ...diagnostics,
          {
            severity: 'error',
            kind: 'invalid-input',
            message: 'RegionSet DTO 无效',
          },
        ],
        dependencies,
      );
    regions.push(...input.value.regions);
  }
  const assignments = Object.values(document.appearances?.overrides || {});
  const regionIndex = createOutputRefIndex(regions, (region) => region.ref);
  const unresolved = assignments.filter(
    (assignment) => !regionIndex.has(assignment.target),
  );
  if (unresolved.length)
    return stage(
      'blocked',
      undefined,
      [
        ...diagnostics,
        ...unresolved.map((assignment) => ({
          severity: 'error',
          kind: 'unresolved-reference',
          ref: assignment.target,
          message: `赋值目标未在当前 RegionSet 中唯一解析：${assignment.id}`,
        })),
      ],
      dependencies,
    );
  if (!regions.length)
    return sawAbsent && !sawEmpty
      ? stage('absent', undefined, diagnostics, dependencies)
      : stage('empty', { appearances: [] }, diagnostics, dependencies);
  const appearances = [];
  for (const region of regions) {
    const resolved = resolveAppearance(
      document,
      region.ref?.ownerNodeId,
      region.ref,
      queries,
    );
    if (resolved.status !== 'ready')
      return stage(
        'blocked',
        undefined,
        [...diagnostics, ...resolved.diagnostics],
        dependencies,
      );
    appearances.push({
      ref: structuredClone(region.ref),
      color: resolved.value.color,
      swatchId: resolved.value.swatchId,
    });
  }
  return stage('ready', { appearances }, diagnostics, dependencies);
}
