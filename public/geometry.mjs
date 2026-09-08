// Edge-guided A* and adaptive cubic least-squares fitting. Pure module, shared by worker and tests.
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
  sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
  mul = (a, s) => ({ x: a.x * s, y: a.y * s }),
  dot = (a, b) => a.x * b.x + a.y * b.y;
const unit = (a) => mul(a, 1 / (Math.hypot(a.x, a.y) || 1));
export function buildField(rgba, w, h) {
  const n = w * h,
    lum = new Float32Array(n),
    edge = new Float32Array(n),
    ink = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3] / 255;
    lum[i] =
      (rgba[i * 4] * 0.299 +
        rgba[i * 4 + 1] * 0.587 +
        rgba[i * 4 + 2] * 0.114) *
        a +
      255 * (1 - a);
  }
  const get = (x, y) =>
    lum[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x,
        v = lum[i];
      let valley = 0;
      const gx =
        (get(x + 1, y - 1) +
          2 * get(x + 1, y) +
          get(x + 1, y + 1) -
          get(x - 1, y - 1) -
          2 * get(x - 1, y) -
          get(x - 1, y + 1)) /
        4;
      const gy =
        (get(x - 1, y + 1) +
          2 * get(x, y + 1) +
          get(x + 1, y + 1) -
          get(x - 1, y - 1) -
          2 * get(x, y - 1) -
          get(x + 1, y - 1)) /
        4;
      edge[i] = Math.hypot(gx, gy) / (Math.hypot(gx, gy) + 16);
      for (const r of [2, 4, 7])
        for (const [dx, dy] of [
          [1, 0],
          [0, 1],
          [0.707, 0.707],
          [0.707, -0.707],
        ]) {
          const ox = Math.round(dx * r),
            oy = Math.round(dy * r);
          valley = Math.max(
            valley,
            Math.min(get(x + ox, y + oy), get(x - ox, y - oy)) - v,
          );
        }
      ink[i] = Math.max(
        (valley / (valley + 15)) * (1 - v / 330),
        edge[i] * 0.42,
      );
    }
  return { w, h, edge, ink };
}
export function snap(field, p, mode, radius = 9) {
  const { w, h } = field,
    score = field[mode];
  let best = {
      x: Math.round(Math.max(0, Math.min(w - 1, p.x))),
      y: Math.round(Math.max(0, Math.min(h - 1, p.y))),
    },
    cost = Infinity;
  for (
    let y = Math.max(0, Math.floor(p.y - radius));
    y <= Math.min(h - 1, Math.ceil(p.y + radius));
    y++
  )
    for (
      let x = Math.max(0, Math.floor(p.x - radius));
      x <= Math.min(w - 1, Math.ceil(p.x + radius));
      x++
    ) {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d > radius) continue;
      const c = 1 - score[y * w + x] + (d / radius) * 0.35;
      if (c < cost) {
        cost = c;
        best = { x, y };
      }
    }
  return best;
}
class Heap {
  a = [];
  push(id, key) {
    const a = this.a;
    let i = a.length;
    a.push({ id, key });
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].key <= key) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = { id, key };
  }
  pop() {
    const a = this.a,
      top = a[0],
      last = a.pop();
    if (a.length) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let j = i * 2 + 1;
        if (j + 1 < a.length && a[j + 1].key < a[j].key) j++;
        if (a[j].key >= last.key) break;
        a[i] = a[j];
        i = j;
      }
      a[i] = last;
    }
    return top;
  }
  get length() {
    return this.a.length;
  }
}
export function trace(field, start, end, mode = 'ink', corridor = 90) {
  const { w, h } = field,
    score = field[mode],
    a = { x: Math.round(start.x), y: Math.round(start.y) },
    b = { x: Math.round(end.x), y: Math.round(end.y) };
  const minx = Math.max(0, Math.floor(Math.min(a.x, b.x) - corridor)),
    maxx = Math.min(w - 1, Math.ceil(Math.max(a.x, b.x) + corridor)),
    miny = Math.max(0, Math.floor(Math.min(a.y, b.y) - corridor)),
    maxy = Math.min(h - 1, Math.ceil(Math.max(a.y, b.y) + corridor));
  const rw = maxx - minx + 1,
    rh = maxy - miny + 1,
    n = rw * rh,
    cost = new Float32Array(n).fill(Infinity),
    prev = new Int32Array(n).fill(-1),
    closed = new Uint8Array(n),
    heap = new Heap();
  const index = (x, y) => (y - miny) * rw + x - minx,
    source = index(a.x, a.y),
    target = index(b.x, b.y);
  cost[source] = 0;
  heap.push(source, 0);
  let expanded = 0;
  while (heap.length) {
    const { id } = heap.pop();
    if (closed[id]) continue;
    closed[id] = 1;
    if (id === target) break;
    expanded++;
    const x = (id % rw) + minx,
      y = Math.floor(id / rw) + miny;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx,
          ny = y + dy;
        if (nx < minx || nx > maxx || ny < miny || ny > maxy) continue;
        const ni = index(nx, ny);
        if (closed[ni]) continue;
        const s = (score[y * w + x] + score[ny * w + nx]) * 0.5;
        const vx = b.x - a.x,
          vy = b.y - a.y,
          t = Math.max(
            0,
            Math.min(
              1,
              ((nx - a.x) * vx + (ny - a.y) * vy) / (vx * vx + vy * vy || 1),
            ),
          ),
          guide = Math.hypot(nx - a.x - t * vx, ny - a.y - t * vy) / corridor;
        const step =
          (dx && dy ? Math.SQRT2 : 1) *
          (0.1 + 6 * Math.pow(1 - s, 3) + 0.1 * guide * guide);
        const next = cost[id] + step;
        if (next < cost[ni]) {
          cost[ni] = next;
          prev[ni] = id;
          heap.push(ni, next + 0.06 * Math.hypot(nx - b.x, ny - b.y));
        }
      }
  }
  if (!closed[target]) throw new Error('未找到连续路线，请缩短两点间距');
  const points = [];
  for (let k = target; k !== -1; k = prev[k]) {
    points.push({ x: (k % rw) + minx, y: Math.floor(k / rw) + miny });
    if (k === source) break;
  }
  points.reverse();
  points[0] = { ...start };
  points[points.length - 1] = { ...end };
  const quality =
    points.reduce(
      (s, p) =>
        s +
        score[
          Math.min(h - 1, Math.max(0, Math.round(p.y))) * w +
            Math.min(w - 1, Math.max(0, Math.round(p.x)))
        ],
      0,
    ) / points.length;
  return { points, quality, expanded };
}
export function evaluate(c, t) {
  const s = 1 - t;
  return {
    x:
      c[0].x * s * s * s +
      3 * c[1].x * s * s * t +
      3 * c[2].x * s * t * t +
      c[3].x * t * t * t,
    y:
      c[0].y * s * s * s +
      3 * c[1].y * s * s * t +
      3 * c[2].y * s * t * t +
      c[3].y * t * t * t,
  };
}
export function splitCubic(c, t = 0.5) {
  const mix = (a, b) => add(mul(a, 1 - t), mul(b, t)),
    a = mix(c[0], c[1]),
    b = mix(c[1], c[2]),
    d = mix(c[2], c[3]),
    e = mix(a, b),
    f = mix(b, d),
    p = mix(e, f);
  return [
    [c[0], a, e, p],
    [p, f, d, c[3]],
  ];
}
export function fitCurve(input, tolerance = 1.5) {
  const pts = input.filter((p, i) => !i || dist(p, input[i - 1]) > 0.01);
  if (pts.length < 2) return [];
  // Symmetric smoothing suppresses pixel stair steps while retaining exact endpoints.
  const points = pts.map((p, i) =>
    i > 1 && i < pts.length - 2
      ? mul(
          add(
            add(pts[i - 2], pts[i + 2]),
            add(mul(pts[i - 1], 2), add(mul(p, 3), mul(pts[i + 1], 2))),
          ),
          1 / 9,
        )
      : p,
  );
  const result = [];
  function fit(first, last, t1, t2, depth) {
    const a = points[first],
      b = points[last],
      length = last - first;
    if (length === 1) {
      const d = dist(a, b) / 3;
      result.push([a, add(a, mul(t1, d)), add(b, mul(t2, d)), b]);
      return;
    }
    const u = [0];
    for (let i = first + 1; i <= last; i++)
      u.push(u[u.length - 1] + dist(points[i], points[i - 1]));
    const total = u[u.length - 1] || 1;
    for (let i = 0; i < u.length; i++) u[i] /= total;
    let c00 = 0,
      c01 = 0,
      c11 = 0,
      x0 = 0,
      x1 = 0;
    for (let i = 0; i <= length; i++) {
      const t = u[i],
        s = 1 - t,
        b0 = s * s * s,
        b1 = 3 * s * s * t,
        b2 = 3 * s * t * t,
        b3 = t * t * t,
        v1 = mul(t1, b1),
        v2 = mul(t2, b2),
        r = sub(points[first + i], add(mul(a, b0 + b1), mul(b, b2 + b3)));
      c00 += dot(v1, v1);
      c01 += dot(v1, v2);
      c11 += dot(v2, v2);
      x0 += dot(v1, r);
      x1 += dot(v2, r);
    }
    const det = c00 * c11 - c01 * c01;
    let alpha = det ? (x0 * c11 - x1 * c01) / det : 0,
      beta = det ? (c00 * x1 - c01 * x0) / det : 0;
    const chord = dist(a, b);
    if (
      alpha < chord * 0.001 ||
      beta < chord * 0.001 ||
      alpha > total * 2 ||
      beta > total * 2
    ) {
      alpha = beta = chord / 3;
    }
    const c = [a, add(a, mul(t1, alpha)), add(b, mul(t2, beta)), b];
    let max = 0,
      split = first + Math.floor(length / 2);
    for (let i = 1; i < length; i++) {
      const d = dist(evaluate(c, u[i]), points[first + i]);
      if (d > max) {
        max = d;
        split = first + i;
      }
    }
    if (max <= tolerance || depth > 24) {
      result.push(c);
      return;
    }
    const tangent = unit(sub(points[split - 1], points[split + 1]));
    fit(first, split, t1, tangent, depth + 1);
    fit(split, last, mul(tangent, -1), t2, depth + 1);
  }
  fit(
    0,
    points.length - 1,
    unit(sub(points[Math.min(3, points.length - 1)], points[0])),
    unit(
      sub(points[Math.max(0, points.length - 4)], points[points.length - 1]),
    ),
    0,
  );
  return result;
}
export const pathData = (curves) =>
  curves.length
    ? `M ${curves[0][0].x.toFixed(3)} ${curves[0][0].y.toFixed(3)} ` +
      curves
        .map(
          (c) =>
            `C ${c
              .slice(1)
              .map((p) => `${p.x.toFixed(3)} ${p.y.toFixed(3)}`)
              .join(' ')}`,
        )
        .join(' ')
    : '';
export function flatten(curves, error = 0.25) {
  const out = [];
  function visit(c, depth = 0) {
    const chord = dist(c[0], c[3]),
      polygon = dist(c[0], c[1]) + dist(c[1], c[2]) + dist(c[2], c[3]);
    if (polygon - chord < error || depth > 16) {
      out.push(c[3]);
      return;
    }
    const [a, b] = splitCubic(c);
    visit(a, depth + 1);
    visit(b, depth + 1);
  }
  if (curves.length) out.push(curves[0][0]);
  curves.forEach((c) => visit(c));
  return out;
}
export function corners(rgba, w, h) {
  const n = w * h,
    l = new Float32Array(n);
  for (let i = 0; i < n; i++)
    l[i] =
      (0.299 * rgba[i * 4] +
        0.587 * rgba[i * 4 + 1] +
        0.114 * rgba[i * 4 + 2]) *
        (rgba[i * 4 + 3] / 255) +
      255 * (1 - rgba[i * 4 + 3] / 255);
  const sw = w + 1,
    xx = new Float64Array((w + 1) * (h + 1)),
    yy = new Float64Array(xx.length),
    xy = new Float64Array(xx.length);
  for (let y = 1; y < h - 1; y++) {
    let sx = 0,
      sy = 0,
      sz = 0;
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x,
        gx = (l[i + 1] - l[i - 1]) / 2,
        gy = (l[i + w] - l[i - w]) / 2;
      sx += gx * gx;
      sy += gy * gy;
      sz += gx * gy;
      const k = (y + 1) * sw + x + 1;
      xx[k] = xx[k - sw] + sx;
      yy[k] = yy[k - sw] + sy;
      xy[k] = xy[k - sw] + sz;
    }
  }
  const box = (a, x, y) =>
    a[(y + 4) * sw + x + 4] -
    a[(y - 3) * sw + x + 4] -
    a[(y + 4) * sw + x - 3] +
    a[(y - 3) * sw + x - 3];
  const all = [];
  for (let y = 5; y < h - 5; y += 2)
    for (let x = 5; x < w - 5; x += 2) {
      const a = box(xx, x, y),
        b = box(yy, x, y),
        c = box(xy, x, y),
        r = a * b - c * c - 0.045 * (a + b) * (a + b);
      if (r > 1e6) all.push({ x, y, score: r });
    }
  all.sort((a, b) => b.score - a.score);
  const out = [];
  for (const p of all) {
    if (out.every((q) => dist(p, q) > 8)) out.push(p);
    if (out.length >= 1500) break;
  }
  return out;
}

export function intersections(curves) {
  const pts = [];
  curves.forEach((c, ci) => {
    const steps = Math.max(
      8,
      Math.ceil((dist(c[0], c[1]) + dist(c[1], c[2]) + dist(c[2], c[3])) / 2),
    );
    for (let j = 0; j < steps; j++)
      pts.push({ ...evaluate(c, j / steps), ci, t: j / steps });
  });
  if (curves.length)
    pts.push({ ...curves.at(-1)[3], ci: curves.length - 1, t: 1 });
  const found = [];
  for (let i = 0; i < pts.length - 1; i++)
    for (let j = i + 2; j < pts.length - 1; j++) {
      if (i === 0 && j === pts.length - 2 && dist(pts[0], pts.at(-1)) < 0.01)
        continue;
      const a = pts[i],
        b = pts[i + 1],
        c = pts[j],
        d = pts[j + 1];
      if (
        Math.max(a.x, b.x) < Math.min(c.x, d.x) ||
        Math.min(a.x, b.x) > Math.max(c.x, d.x) ||
        Math.max(a.y, b.y) < Math.min(c.y, d.y) ||
        Math.min(a.y, b.y) > Math.max(c.y, d.y)
      )
        continue;
      const rx = b.x - a.x,
        ry = b.y - a.y,
        sx = d.x - c.x,
        sy = d.y - c.y,
        den = rx * sy - ry * sx;
      if (Math.abs(den) < 1e-8) continue;
      const u = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den,
        v = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
      if (u > 1e-5 && u < 1 - 1e-5 && v > 1e-5 && v < 1 - 1e-5)
        found.push({
          x: a.x + u * rx,
          y: a.y + u * ry,
          first: {
            curve: a.ci,
            t: a.t + u * ((b.ci === a.ci ? b.t : 1) - a.t),
          },
          second: {
            curve: c.ci,
            t: c.t + v * ((d.ci === c.ci ? d.t : 1) - c.t),
          },
        });
    }
  return found;
}
export function inspectGeometry(paths) {
  return paths
    .filter((p) => p.visible && p.curves.length)
    .map((p) => {
      let gaps = 0;
      for (let i = 1; i < p.curves.length; i++)
        if (dist(p.curves[i - 1][3], p.curves[i][0]) > 0.001) gaps++;
      if (p.closed && dist(p.curves[0][0], p.curves.at(-1)[3]) > 0.001) gaps++;
      return {
        id: p.id,
        name: p.name,
        closed: p.closed,
        gaps,
        selfIntersections: intersections(p.curves).map(({ x, y }) => ({
          x,
          y,
        })),
      };
    });
}
