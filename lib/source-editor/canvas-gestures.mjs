// Coordinate and camera math shared by the SVG canvas gestures.  These stay
// independent of React so zoomed interaction can be regression-tested.
const finite = (n) => Number.isFinite(n);

export function screenToDocument({ clientX, clientY }, rect, view) {
  if (
    !finite(clientX) ||
    !finite(clientY) ||
    !finite(rect.left) ||
    !finite(rect.top) ||
    !finite(view.x) ||
    !finite(view.y) ||
    !finite(view.s) ||
    view.s <= 0
  )
    return null;
  return {
    x: (clientX - rect.left - view.x) / view.s,
    y: (clientY - rect.top - view.y) / view.s,
  };
}

export function zoomAt(view, factor, center, limits = { min: 0.05, max: 12 }) {
  if (!finite(factor) || factor <= 0 || !finite(center.x) || !finite(center.y))
    return view;
  const s = Math.min(limits.max, Math.max(limits.min, view.s * factor));
  return {
    s,
    x: center.x - ((center.x - view.x) * s) / view.s,
    y: center.y - ((center.y - view.y) * s) / view.s,
  };
}

export function pathBounds(paths) {
  const points = paths
    .flatMap((path) => [
      path.start,
      ...(path.anchors || []),
      ...(path.curves || []).flat(),
    ])
    .filter((p) => finite(p?.x) && finite(p?.y));
  if (!points.length) return null;
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

const overlap = (a, b) => {
  const width = Math.max(
    0,
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
  );
  const height = Math.max(
    0,
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  );
  return width * height;
};

// Return null when an existing view already keeps the selected source paths
// substantially visible. `force` is used by explicit Frame/F actions.
export function framePathsView(
  paths,
  viewport,
  view,
  { force = false, padding = 80 } = {},
) {
  const bounds = pathBounds(paths);
  if (
    !bounds ||
    !finite(viewport.width) ||
    !finite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  )
    return null;
  const screen = {
    x: view.x + bounds.x * view.s,
    y: view.y + bounds.y * view.s,
    width: Math.max(bounds.width * view.s, 1),
    height: Math.max(bounds.height * view.s, 1),
  };
  const visibleViewport = {
    x: viewport.x || 0,
    y: viewport.y || 0,
    width: viewport.width,
    height: viewport.height,
  };
  const visible = overlap(screen, visibleViewport);
  if (!force && visible / (screen.width * screen.height) >= 0.6) return null;

  // A point or straight line needs a non-zero framing extent to avoid an
  // accidental jump to maximum zoom.
  const width = Math.max(bounds.width, 80),
    height = Math.max(bounds.height, 80);
  const s = Math.min(
    12,
    Math.max(
      0.05,
      Math.min(
        Math.max(1, visibleViewport.width - padding * 2) / width,
        Math.max(1, visibleViewport.height - padding * 2) / height,
      ),
    ),
  );
  const next = {
    s,
    x:
      visibleViewport.x +
      visibleViewport.width / 2 -
      (bounds.x + bounds.width / 2) * s,
    y:
      visibleViewport.y +
      visibleViewport.height / 2 -
      (bounds.y + bounds.height / 2) * s,
  };
  return Math.abs(next.s - view.s) < 1e-6 &&
    Math.abs(next.x - view.x) < 0.01 &&
    Math.abs(next.y - view.y) < 0.01
    ? null
    : next;
}
