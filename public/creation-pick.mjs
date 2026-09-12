// Raycasting does not take WebGL polygon offsets into account.  When painted
// cells share a plane, use the same later-draws-on-top rule as the renderer.
const COPLANAR_DISTANCE_EPSILON = 1e-7;

export function pickVisibleIntersection(intersections) {
  let visible = null;
  for (const hit of intersections) {
    if (!hit?.object?.userData?.key || !Number.isFinite(hit.distance)) continue;
    if (!visible) {
      visible = hit;
      continue;
    }
    const tolerance = Math.max(
      COPLANAR_DISTANCE_EPSILON,
      Math.max(Math.abs(hit.distance), Math.abs(visible.distance)) * 1e-10,
    );
    if (hit.distance < visible.distance - tolerance) {
      visible = hit;
      continue;
    }
    if (
      Math.abs(hit.distance - visible.distance) <= tolerance &&
      (hit.object.userData.pickOrder ?? 0) >=
        (visible.object.userData.pickOrder ?? 0)
    )
      visible = hit;
  }
  return visible;
}
