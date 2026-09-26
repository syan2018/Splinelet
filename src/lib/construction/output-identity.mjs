// Wire/persistence identity is unchanged. Runtime lookups never re-encode keys.
export const stableIdentityValue = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map(stableIdentityValue).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableIdentityValue(value[key])}`)
    .join(',')}}`;
};

const fields = [
  'ownerNodeId',
  'operatorId',
  'port',
  'key',
  'instances',
  'lineage',
];
const scalarFields = fields.slice(0, 4);
export const outputIdentity = (ref) =>
  stableIdentityValue(fields.map((field) => ref?.[field]));

// Arrays remain ordered (including lineage supplied by older documents).
// Preserve the old serializer's primitive semantics at non-schema call sites.
const sameValue = (left, right) => {
  if (left === right) return true;
  if (typeof left === 'string' || typeof right === 'string') return false;
  const leftObject = left !== null && typeof left === 'object';
  const rightObject = right !== null && typeof right === 'object';
  if (!leftObject || !rightObject)
    return (
      !leftObject &&
      !rightObject &&
      JSON.stringify(left) === JSON.stringify(right)
    );
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    // Non-schema arrays such as [] and [undefined] share an old encoding.
    if (left.length !== right.length)
      return stableIdentityValue(left) === stableIdentityValue(right);
    for (let index = 0; index < left.length; index++)
      if (!sameValue(left[index], right[index])) return false;
    return true;
  }
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.prototype.propertyIsEnumerable.call(right, key) &&
        sameValue(left[key], right[key]),
    )
  );
};

/** Exact six-field equality without allocating an encoded copy of either ref. */
export const sameOutputRef = (left, right) =>
  fields.every((field) => sameValue(left?.[field], right?.[field]));

/** Operation-scoped key memo. Discard before editing any referenced input. */
export function createOutputIdentity() {
  const keys = new WeakMap();
  return (ref) => {
    if (!ref || typeof ref !== 'object') return outputIdentity(ref);
    if (!keys.has(ref)) keys.set(ref, outputIdentity(ref));
    return keys.get(ref);
  };
}

/** A synchronous read's index: no global cache, DTO mutation or hash collisions.
 * Inputs must stay unchanged for its lifetime. Queries return fresh arrays so
 * callers cannot modify internal buckets; duplicates keep their source order. */
export function createOutputRefIndex(items, reference = (item) => item) {
  const root = new Map();
  const other = [];
  const bucket = (ref, create = false) => {
    const parts = scalarFields.map((field) => ref?.[field]);
    if (parts.some((part) => typeof part !== 'string')) return other;
    let current = root;
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      if (!current.has(part)) {
        if (!create) return [];
        current.set(part, index === parts.length - 1 ? [] : new Map());
      }
      current = current.get(part);
    }
    return current;
  };
  for (const item of items) bucket(reference(item), true).push(item);
  return Object.freeze({
    get: (ref) =>
      bucket(ref).filter((item) => sameOutputRef(reference(item), ref)),
    has: (ref) =>
      bucket(ref).some((item) => sameOutputRef(reference(item), ref)),
  });
}
