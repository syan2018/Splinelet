const inverse = ([a, b, c, d, e, f]) => {
  const det = a * d - b * c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [
    d / det,
    -b / det,
    -c / det,
    a / det,
    (c * f - d * e) / det,
    (b * e - a * f) / det,
  ];
};

/** Derived handles are writable only with an explicit source, instance map, and invertible transform. */
export function deriveEditableHandle(derived) {
  if (
    !derived?.source ||
    derived.source.kind !== 'edge-end' ||
    typeof derived.source.sketchId !== 'string' ||
    typeof derived.source.edgeId !== 'string' ||
    !['start', 'end'].includes(derived.source.end) ||
    !Array.isArray(derived.instances) ||
    !derived.instances.every(
      (item) =>
        typeof item?.operatorId === 'string' &&
        Number.isSafeInteger(item.index),
    )
  )
    return { editable: false, reason: 'missing-provenance' };
  if (
    !Array.isArray(derived.transform) ||
    derived.transform.length !== 6 ||
    !derived.transform.every(Number.isFinite)
  )
    return { editable: false, reason: 'missing-transform' };
  const transform = inverse(derived.transform);
  if (!transform)
    return { editable: false, reason: 'non-invertible-transform' };
  return {
    editable: true,
    source: structuredClone(derived.source),
    inverseTransform: transform,
    instances: structuredClone(derived.instances),
  };
}
