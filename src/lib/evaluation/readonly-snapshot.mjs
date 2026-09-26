// A frozen outer object does not prove that its descendants are immutable.
// Share only plain DTOs verified here; typed buffers retain a copy boundary.
const immutable = new WeakSet();

export const isImmutableSnapshot = (value) => immutable.has(value);

export const freezeSnapshot = (value) => {
  if (!value || typeof value !== 'object' || immutable.has(value)) return value;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value;
  const children = Object.values(value);
  children.forEach(freezeSnapshot);
  Object.freeze(value);
  if (
    (Array.isArray(value) ||
      Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null) &&
    children.every(
      (child) => !child || typeof child !== 'object' || immutable.has(child),
    )
  )
    immutable.add(value);
  return value;
};

export const readonlySnapshot = (value) =>
  immutable.has(value) ? value : freezeSnapshot(structuredClone(value));

// Use only when the caller transfers ownership (e.g. a native Worker message).
// A graph containing mutable buffers still needs an isolated copy.
export const ownedSnapshot = (value) => readonlySnapshot(freezeSnapshot(value));
