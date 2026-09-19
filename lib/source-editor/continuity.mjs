export const nodeCount = (p) =>
  p.closed ? p.curves.length : p.curves.length + 1;
export const nodeModes = (p) =>
  Array.from({ length: nodeCount(p) }, (_, i) => p.nodeModes?.[i] || 'corner');
export function nodeSides(path, index) {
  const n = path.curves.length;
  return {
    left: index > 0 ? index - 1 : path.closed ? n - 1 : -1,
    right: index < n ? index : -1,
  };
}
export function moveHandle(path, curve, point, position) {
  const c = path.curves[curve];
  if (!c || ![1, 2].includes(point)) throw Error('无效控制柄');
  const index =
    point === 1
      ? curve
      : path.closed
        ? (curve + 1) % path.curves.length
        : curve + 1;
  const mode = nodeModes(path)[index],
    { left, right } = nodeSides(path, index);
  c[point] = { ...position };
  if (mode === 'corner' || left < 0 || right < 0) return;
  const anchor = point === 1 ? c[0] : c[3];
  const opposite = point === 1 ? path.curves[left][2] : path.curves[right][1];
  const dx = position.x - anchor.x,
    dy = position.y - anchor.y,
    len = Math.hypot(dx, dy);
  const otherLength =
    mode === 'symmetric'
      ? len
      : Math.hypot(opposite.x - anchor.x, opposite.y - anchor.y);
  if (len < 1e-10 && mode === 'smooth') return;
  const target = {
    x: anchor.x - (dx / (len || 1)) * otherLength,
    y: anchor.y - (dy / (len || 1)) * otherLength,
  };
  if (point === 1) path.curves[left][2] = target;
  else path.curves[right][1] = target;
}
export function setContinuity(path, index, mode) {
  if (
    !['corner', 'smooth', 'symmetric'].includes(mode) ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= nodeCount(path)
  )
    throw Error('无效节点模式或索引');
  const { left, right } = nodeSides(path, index);
  if (mode !== 'corner' && (left < 0 || right < 0))
    throw Error('连续模式需要节点两侧都有曲线');
  path.nodeModes = nodeModes(path);
  path.nodeModes[index] = mode;
  if (mode === 'corner') return;
  const c = path.curves[right],
    a = c[0];
  let p = c[1];
  if (Math.hypot(p.x - a.x, p.y - a.y) < 1e-10) {
    const v = path.curves[left][2];
    p = { x: 2 * a.x - v.x, y: 2 * a.y - v.y };
  }
  if (Math.hypot(p.x - a.x, p.y - a.y) < 1e-10) {
    const prev = path.curves[left][0],
      next = c[3];
    p = { x: a.x + (next.x - prev.x) / 6, y: a.y + (next.y - prev.y) / 6 };
  }
  moveHandle(path, right, 1, p);
}
export function enforceContinuity(path) {
  nodeModes(path).forEach((mode, index) => {
    const { left, right } = nodeSides(path, index);
    if (left < 0 || right < 0) {
      if (path.nodeModes) path.nodeModes[index] = 'corner';
    } else if (mode !== 'corner') setContinuity(path, index, mode);
  });
}
