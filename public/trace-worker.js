import {
  buildField,
  snap,
  trace,
  fitSingleCurve,
  corners,
} from './geometry.mjs';
let field;
self.onmessage = ({ data: d }) => {
  try {
    if (d.type === 'init') {
      field = buildField(d.rgba, d.w, d.h);
      self.postMessage({
        id: d.id,
        type: 'ready',
        candidates: corners(d.rgba, d.w, d.h),
      });
      return;
    }
    if (!field) throw new Error('底图尚未准备好');
    if (d.type === 'snap') {
      self.postMessage({
        id: d.id,
        point: snap(field, d.point, d.mode, d.radius),
      });
      return;
    }
    const end = d.snap ? snap(field, d.end, d.mode, d.radius) : d.end;
    const r = trace(field, d.start, end, d.mode, d.corridor);
    self.postMessage({
      id: d.id,
      end,
      ...fitSingleCurve(r.points, d.tolerance),
      ...r,
    });
  } catch (e) {
    self.postMessage({ id: d.id, error: e.message });
  }
};
