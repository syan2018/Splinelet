import { nodeModes, enforceContinuity } from './continuity.mjs';
import { evaluate, fitSingleCurve } from '../../../public/geometry.mjs';

// A closed spline has one unique node per cubic; its seam is not a second node.
export function pathNodes(path) {
  if (!path.curves.length) return [path.start];
  return path.closed
    ? path.curves.map((c) => c[0])
    : [path.curves[0][0], ...path.curves.map((c) => c[3])];
}

export function nodeSelection(path, index) {
  if (!Number.isInteger(index) || index < 0 || index >= pathNodes(path).length)
    throw Error('节点索引越界');
  return index < path.curves.length
    ? { curve: index, point: 0 }
    : { curve: Math.max(0, index - 1), point: path.curves.length ? 3 : 0 };
}

export function selectedNode(path, selection) {
  if (!path || !selection || ![0, 3].includes(selection.point)) return null;
  const index = selection.curve + (selection.point === 3 ? 1 : 0);
  const count = pathNodes(path).length;
  if (path.closed && index === count) return 0;
  return index >= 0 && index < count ? index : null;
}

// Merge only the two affected spans. Never insert additional intermediate nodes.
export function removeNode(original, index, tolerance = 1.5) {
  nodeSelection(original, index);
  const path = structuredClone(original),
    nodes = pathNodes(path);
  let fitError = 0,
    merged = false;
  const merge = (a, b) => {
    const points = Array.from({ length: 41 }, (_, i) => evaluate(a, i / 40));
    for (let i = 1; i <= 40; i++) points.push(evaluate(b, i / 40));
    const result = fitSingleCurve(points, tolerance);
    fitError = result.fitError;
    merged = true;
    return result.curves[0];
  };
  if (nodes.length === 1) return { path: null, fitError, merged };
  if (nodes.length === 2) {
    path.start = nodes[index === 0 ? 1 : 0];
    path.curves = [];
    path.closed = false;
  } else if (path.closed) {
    if (index === 0) {
      const joined = merge(path.curves.at(-1), path.curves[0]);
      path.curves = [...path.curves.slice(1, -1), joined];
    } else {
      path.curves.splice(
        index - 1,
        2,
        merge(path.curves[index - 1], path.curves[index]),
      );
    }
  } else if (index === 0) path.curves.shift();
  else if (index === nodes.length - 1) path.curves.pop();
  else
    path.curves.splice(
      index - 1,
      2,
      merge(path.curves[index - 1], path.curves[index]),
    );
  if (original.nodeModes) {
    path.nodeModes = nodeModes(original).filter((_, i) => i !== index);
    enforceContinuity(path);
  }
  path.start = path.curves[0]?.[0] || path.start;
  path.anchors = pathNodes(path);
  path.fitting = 'single';
  // Image fit metrics no longer describe the manually edited path.
  delete path.fitError;
  return { path, fitError, merged };
}
