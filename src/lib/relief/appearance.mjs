const stable = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
    .join(',')}}`;
};

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

/**
 * Output assignment identity is deliberately stricter than an operator/key
 * shortcut: an output's owner, operator, port, key, instances and lineage all
 * participate. A stale assignment must remain unresolved, never select a
 * sibling output merely because it happens to share an operator key.
 */
export const outputIdentity = (ref) =>
  stable([
    ref?.ownerNodeId,
    ref?.operatorId,
    ref?.port,
    ref?.key,
    ref?.instances,
    ref?.lineage,
  ]);
export const sameOutputRef = (left, right) =>
  outputIdentity(left) === outputIdentity(right);

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
export function resolveAppearance(document, shapeId, target) {
  const overrides = Object.values(
    document?.appearances?.overrides || {},
  ).filter((assignment) => sameOutputRef(assignment.target, target));
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
