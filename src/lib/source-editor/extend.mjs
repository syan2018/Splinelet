import { pathNodes } from './node-edit.mjs';
import { nodeModes } from './continuity.mjs';

export function splineEndpoint(path, end) {
  if (!path || path.closed || !['start', 'end'].includes(end))
    throw Error('请选择开放样条的头或尾端点');
  return end === 'start' ? path.start : path.curves.at(-1)?.[3] || path.start;
}

// Fit outwards from the chosen endpoint, then store a head extension inwards.
// Never reverse or refit existing cubics merely to resume drawing.
export function extendSpline(original, end, result, close = false) {
  const from = splineEndpoint(original, end);
  if (result.curves.length !== 1) throw Error('每次落点只能增加一段贝塞尔曲线');
  const path = structuredClone(original);
  const modes = nodeModes(original);
  const curve = structuredClone(result.curves[0]);
  curve[0] = { ...from };
  if (close) {
    if (!path.curves.length) throw Error('至少先绘制一段曲线');
    curve[3] = {
      ...splineEndpoint(original, end === 'start' ? 'end' : 'start'),
    };
    path.curves.push(end === 'start' ? curve.reverse() : curve);
    path.closed = true;
  } else if (end === 'start') {
    path.curves.unshift(curve.reverse());
    modes.unshift('corner');
  } else {
    path.curves.push(curve);
    modes.push('corner');
  }
  path.start = path.curves[0][0];
  path.anchors = pathNodes(path);
  if (original.nodeModes) path.nodeModes = modes;
  path.quality = Math.min(path.quality, result.quality);
  path.fitError = Math.max(path.fitError || 0, result.fitError || 0);
  path.fitting = 'single';
  return path;
}
