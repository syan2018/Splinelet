import { sameOutputRef } from '../construction/output-identity.mjs';
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
