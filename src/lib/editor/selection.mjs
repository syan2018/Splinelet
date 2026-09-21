const clone = (value) => structuredClone(value);

/** Selection stores stable document/output refs verbatim; unresolved refs remain repair targets. */
export function normalizeSelection(selection = {}) {
  const entityRefs = Array.isArray(selection.entityRefs)
    ? clone(selection.entityRefs)
    : [];
  return {
    scope: selection.scope || 'objects',
    entityRefs,
    activeRef: selection.activeRef
      ? clone(selection.activeRef)
      : entityRefs[0] || null,
  };
}

const stable = (value) =>
  value && typeof value === 'object'
    ? Array.isArray(value)
      ? `[${value.map(stable).join(',')}]`
      : `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
          .join(',')}}`
    : JSON.stringify(value);

export const selectionContains = (selection, ref) =>
  (selection?.entityRefs || []).some((item) => stable(item) === stable(ref));
