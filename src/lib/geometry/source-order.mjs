/** Presentation order never changes ownership, construction input order or Z. */
export function orderedSourcePaths(document) {
  return Object.values(document.sketches)
    .flatMap((sketch) =>
      Object.values(sketch.paths).map((path) => ({ sketch, path })),
    )
    .sort(
      (a, b) =>
        (a.path.order ?? 0) - (b.path.order ?? 0) ||
        a.sketch.id.localeCompare(b.sketch.id) ||
        a.path.id.localeCompare(b.path.id),
    );
}

export function nextSourcePathOrder(document) {
  return orderedSourcePaths(document).reduce(
    (next, { path }) => Math.max(next, (path.order ?? 0) + 1),
    0,
  );
}
