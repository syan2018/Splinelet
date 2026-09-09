import { pathNodes } from './node-edit.mjs';

export function connectionSettings(settings, keys = {}) {
  return {
    ...settings,
    snap: keys.shiftKey || keys.altKey ? false : settings.snap,
    mode: keys.altKey ? 'manual' : settings.mode,
  };
}

export function straightCubic(a, b) {
  return [
    a,
    { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 },
    { x: a.x + (2 * (b.x - a.x)) / 3, y: a.y + (2 * (b.y - a.y)) / 3 },
    b,
  ];
}

export function mergeSplines(first, firstEnd, second, secondEnd) {
  if (!first || !second || first.id === second.id)
    throw Error('请选择两条不同的样条');
  if (
    first.closed ||
    second.closed ||
    !first.curves.length ||
    !second.curves.length
  )
    throw Error('只能合并两条至少有一段曲线的开放样条');
  if (![firstEnd, secondEnd].every((e) => ['start', 'end'].includes(e)))
    throw Error('连接端点必须为 start 或 end');
  const a = structuredClone(first),
    b = structuredClone(second);
  const reverse = (curves) =>
    curves
      .slice()
      .reverse()
      .map((c) => c.slice().reverse());
  if (firstEnd === 'start') a.curves = reverse(a.curves);
  if (secondEnd === 'end') b.curves = reverse(b.curves);
  const from = a.curves.at(-1)[3],
    to = b.curves[0][0];
  const bridge = from.x !== to.x || from.y !== to.y;
  a.curves = [
    ...a.curves,
    ...(bridge ? [straightCubic(from, to)] : []),
    ...b.curves,
  ];
  a.start = a.curves[0][0];
  a.anchors = pathNodes(a);
  a.name = first.name + ' + ' + second.name;
  a.fitting = 'single';
  a.quality = Math.min(first.quality, second.quality);
  delete a.fitError;
  return { path: a, bridge, joinNode: first.curves.length };
}
