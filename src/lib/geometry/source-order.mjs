/** Presentation order never changes ownership, construction input order or Z. */
export const compareSourceIds = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function orderedSourcePaths(document) {
  return Object.values(document.sketches)
    .flatMap((sketch) =>
      Object.values(sketch.paths).map((path) => ({ sketch, path })),
    )
    .sort(
      (a, b) =>
        (a.path.order ?? 0) - (b.path.order ?? 0) ||
        compareSourceIds(a.sketch.id, b.sketch.id) ||
        compareSourceIds(a.path.id, b.path.id),
    );
}

export function allocateSourcePathOrders(document, count) {
  if (!Number.isSafeInteger(count) || count < 0)
    throw Error('源顺序分配数量无效');
  const paths = orderedSourcePaths(document);
  let previous = paths.reduce(
    (max, { path }) => Math.max(max, path.order ?? 0),
    -1,
  );
  return Array.from({ length: count }, () => {
    const next = previous + 1;
    if (!Number.isFinite(next) || next <= previous)
      throw Error('源显示顺序超出可分配范围，请先重排来源');
    previous = next;
    return next;
  });
}

export const nextSourcePathOrder = (document) =>
  allocateSourcePathOrders(document, 1)[0];
