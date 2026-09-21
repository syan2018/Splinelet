const clone = (value) => structuredClone(value);
const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export function sameDocument(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => sameDocument(value, b[index]))
    );
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  return (
    aKeys.length === bKeys.length &&
    aKeys.every(
      (key, index) => key === bKeys[index] && sameDocument(a[key], b[key]),
    )
  );
}

export function createHistory(document) {
  let current = freeze(clone(document));
  const past = [];
  let future = [];
  return {
    current: () => clone(current),
    readonlyCurrent: () => current,
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    commit(next) {
      if (sameDocument(current, next)) return false;
      past.push(current);
      current = freeze(clone(next));
      future = [];
      return true;
    },
    undo() {
      if (!past.length) return false;
      future.push(current);
      current = past.pop();
      return true;
    },
    redo() {
      if (!future.length) return false;
      past.push(current);
      current = future.pop();
      return true;
    },
  };
}
