import {
  CubicBezierCurve,
  EllipseCurve,
  LineCurve,
  QuadraticBezierCurve,
  type Curve,
  type Path,
  type ShapePath,
  type Vector2,
} from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';

export type SvgPoint = { x: number; y: number };
export type SvgNode = {
  co: SvgPoint;
  handleLeft: SvgPoint;
  handleRight: SvgPoint;
};
export type ImportedSvgSpline = {
  name: string;
  nodes: SvgNode[];
  closed: boolean;
  role: 'boundary' | 'hole' | 'guide';
  /** Every filled outer contour and its holes share a group. */
  fillGroup: string;
  elementId: string;
  fill: string | null;
  stroke: string | null;
  /** Width in the same SVG coordinates as the nodes, including transforms. */
  strokeWidth: number;
};
export type SvgImportResult = {
  splines: ImportedSvgSpline[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  warnings: string[];
};

const point = (p: SvgPoint): SvgPoint => ({ x: p.x, y: p.y });
const same = (a: SvgPoint, b: SvgPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y) < 1e-8;
type Span = [SvgPoint, SvgPoint, SvgPoint, SvgPoint];

function curveSpans(curve: Curve<Vector2>): Span[] {
  if (curve instanceof CubicBezierCurve)
    return [[curve.v0, curve.v1, curve.v2, curve.v3]];
  if (curve instanceof LineCurve)
    return [[curve.v1, curve.v1, curve.v2, curve.v2]];
  if (curve instanceof QuadraticBezierCurve) {
    const { v0, v1, v2 } = curve;
    return [[v0, v0.clone().lerp(v1, 2 / 3), v2.clone().lerp(v1, 2 / 3), v2]];
  }
  if (curve instanceof EllipseCurve) {
    const tau = 2 * Math.PI;
    let delta = curve.aEndAngle - curve.aStartAngle;
    const identical = Math.abs(delta) < Number.EPSILON;
    delta = ((delta % tau) + tau) % tau;
    if (delta < Number.EPSILON) delta = identical ? 0 : tau;
    if (curve.aClockwise && !identical) delta -= tau;
    if (curve.aClockwise && delta === 0 && !identical) delta = -tau;
    // At most 45 degrees per cubic; radial error is below 0.000005 radii.
    const count = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 4)));
    const cos = Math.cos(curve.aRotation);
    const sin = Math.sin(curve.aRotation);
    const position = (angle: number): SvgPoint => ({
      x:
        curve.aX +
        curve.xRadius * Math.cos(angle) * cos -
        curve.yRadius * Math.sin(angle) * sin,
      y:
        curve.aY +
        curve.xRadius * Math.cos(angle) * sin +
        curve.yRadius * Math.sin(angle) * cos,
    });
    const tangent = (angle: number): SvgPoint => ({
      x:
        -curve.xRadius * Math.sin(angle) * cos -
        curve.yRadius * Math.cos(angle) * sin,
      y:
        -curve.xRadius * Math.sin(angle) * sin +
        curve.yRadius * Math.cos(angle) * cos,
    });
    return Array.from({ length: count }, (_, i): Span => {
      const a = curve.aStartAngle + (delta * i) / count;
      const b = curve.aStartAngle + (delta * (i + 1)) / count;
      const k = (4 / 3) * Math.tan((b - a) / 4);
      const p = position(a),
        q = position(b),
        u = tangent(a),
        v = tangent(b);
      return [
        p,
        { x: p.x + k * u.x, y: p.y + k * u.y },
        { x: q.x - k * v.x, y: q.y - k * v.y },
        q,
      ];
    });
  }
  throw new Error(`不支持的 SVG 曲线：${curve.type}`);
}

/** Exact lines/cubics/quadratics; elliptical arcs use bounded cubic segments. */
export function curvesToSplineNodes(
  curves: Curve<Vector2>[],
  closed: boolean,
): SvgNode[] {
  const spans = curves.flatMap(curveSpans);
  if (!spans.length) return [];
  // The editor requires three anchors for closed splines. Split short loops
  // with de Casteljau so two-cubic letters/lenses retain their exact shape.
  while (closed && spans.length < 3) {
    const [a, b, c, d] = spans.shift()!;
    const mid = (p: SvgPoint, q: SvgPoint) => ({
      x: (p.x + q.x) / 2,
      y: (p.y + q.y) / 2,
    });
    const ab = mid(a, b),
      bc = mid(b, c),
      cd = mid(c, d);
    const abc = mid(ab, bc),
      bcd = mid(bc, cd),
      center = mid(abc, bcd);
    spans.unshift([a, ab, abc, center], [center, bcd, cd, d]);
  }
  const first = spans[0][0];
  const nodes: SvgNode[] = [
    { co: point(first), handleLeft: point(first), handleRight: point(first) },
  ];
  for (const [start, right, left, end] of spans) {
    const previous = nodes[nodes.length - 1];
    if (!same(previous.co, start)) throw new Error('SVG 子路径包含不连续曲线');
    previous.handleRight = point(right);
    nodes.push({
      co: point(end),
      handleLeft: point(left),
      handleRight: point(end),
    });
  }
  if (closed && same(nodes[0].co, nodes[nodes.length - 1].co)) {
    nodes[0].handleLeft = nodes.pop()!.handleLeft;
  }
  for (const node of nodes)
    for (const p of [node.co, node.handleLeft, node.handleRight])
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y))
        throw new Error('SVG 包含无效坐标');
  return nodes;
}

/** Pure conversion entry point, also usable with pre-parsed Three ShapePaths. */
export function convertSvgPaths(paths: ShapePath[]): SvgImportResult {
  const splines: ImportedSvgSpline[] = [];
  const warnings = new Set<string>();
  paths.forEach((path, index) => {
    const data = path.userData as {
      style?: Record<string, string | number>;
      node?: Element;
    };
    const style = data?.style ?? {};
    if (
      style.visibility === 'hidden' ||
      style.display === 'none' ||
      Number(style.opacity ?? 1) <= 0
    )
      return;
    const elementId = data?.node?.getAttribute('id') || `svg-${index + 1}`;
    const fill =
      style.fill !== 'none' && Number(style.fillOpacity ?? 1) > 0
        ? String(style.fill ?? '#000000')
        : null;
    const stroke =
      style.stroke &&
      style.stroke !== 'none' &&
      Number(style.strokeOpacity ?? 1) > 0 &&
      Number(style.strokeWidth ?? 1) > 0
        ? String(style.stroke)
        : null;
    if ([fill, stroke].some((paint) => paint?.includes('url(')))
      throw new Error('暂不支持 SVG 渐变或图案，请先转换为纯色路径');
    if (
      Number(style.opacity ?? 1) < 1 ||
      Number(style.fillOpacity ?? 1) < 1 ||
      Number(style.strokeOpacity ?? 1) < 1
    )
      warnings.add('半透明颜色按不透明纯色导入。');
    const add = (
      source: Path,
      role: ImportedSvgSpline['role'],
      group: string,
      paint: 'fill' | 'stroke',
    ) => {
      const closed =
        paint === 'fill' ||
        source.autoClose ||
        (source.curves.length > 0 &&
          same(
            source.curves[0].getPoint(0),
            source.curves[source.curves.length - 1].getPoint(1),
          ));
      const nodes = curvesToSplineNodes(source.curves, closed);
      if (nodes.length < (closed ? 3 : 2)) return;
      splines.push({
        name:
          elementId +
          (role === 'hole' ? ' · 孔洞' : paint === 'stroke' ? ' · 笔画' : ''),
        nodes,
        closed,
        role,
        fillGroup: group,
        elementId,
        fill: paint === 'fill' ? fill : null,
        stroke: paint === 'stroke' ? stroke : null,
        strokeWidth: paint === 'stroke' ? Number(style.strokeWidth ?? 1) : 0,
      });
    };
    if (fill)
      path.toShapes().forEach((shape, shapeIndex) => {
        const group = `${index}:fill:${shapeIndex}`;
        add(shape, 'boundary', group, 'fill');
        shape.holes.forEach((hole) => add(hole, 'hole', group, 'fill'));
      });
    if (stroke) {
      if (style.strokeLineCap !== 'round' || style.strokeLineJoin !== 'round')
        warnings.add('笔画构面使用圆形端点和转角。');
      path.subPaths.forEach((subpath, subIndex) =>
        add(subpath, 'guide', `${index}:stroke:${subIndex}`, 'stroke'),
      );
    }
  });
  if (!splines.length) throw new Error('SVG 中没有可导入的可见路径');
  if (
    splines.length > 5000 ||
    splines.reduce((n, spline) => n + spline.nodes.length, 0) > 50000
  )
    throw new Error('SVG 过于复杂，请先简化路径');
  const bounds = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  for (const spline of splines)
    for (const node of spline.nodes)
      for (const p of [node.co, node.handleLeft, node.handleRight]) {
        const radius = spline.strokeWidth / 2;
        bounds.minX = Math.min(bounds.minX, p.x - radius);
        bounds.minY = Math.min(bounds.minY, p.y - radius);
        bounds.maxX = Math.max(bounds.maxX, p.x + radius);
        bounds.maxY = Math.max(bounds.maxY, p.y + radius);
      }
  return { splines, bounds, warnings: [...warnings] };
}

/** Parse editable SVG paths. Coordinates remain SVG user units (Y downward). */
export function parseSvgImport(text: string): SvgImportResult {
  if (text.length > 5 * 1024 * 1024)
    throw new Error('SVG 文件超过 5 MB，请先简化路径');
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new Error('不支持含外部实体的 SVG');
  const xml = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (
    xml.querySelector('parsererror') ||
    xml.documentElement.localName !== 'svg'
  )
    throw new Error('SVG 文件格式无效');
  const supported = new Set([
    'svg',
    'g',
    'path',
    'rect',
    'circle',
    'ellipse',
    'line',
    'polyline',
    'polygon',
    'title',
    'desc',
    'metadata',
    'defs',
  ]);
  for (const node of Array.from(xml.querySelectorAll('*'))) {
    if (node.closest('metadata')) continue;
    if (!supported.has(node.localName))
      throw new Error(
        `暂不支持 SVG <${node.localName}>，请先转换为普通路径（文字转曲、笔迹导出 SVG）`,
      );
    if (node.localName === 'svg' && node !== xml.documentElement)
      throw new Error('暂不支持嵌套 SVG 视口，请先展开为路径');
    for (const attribute of [
      'clip-path',
      'mask',
      'filter',
      'stroke-dasharray',
      'vector-effect',
      'marker-start',
      'marker-mid',
      'marker-end',
    ]) {
      if (
        (node.hasAttribute(attribute) &&
          node.getAttribute(attribute) !== 'none') ||
        new RegExp(`${attribute}\\s*:`, 'i').test(
          node.getAttribute('style') ?? '',
        )
      )
        throw new Error(`暂不支持 SVG ${attribute}，请先展开外观为路径`);
    }
  }
  // SVGLoader handles visibility but does not apply display:none. Remove the
  // entire hidden subtree before loading so hidden editor layers stay hidden.
  for (const node of Array.from(xml.querySelectorAll('*'))) {
    if (
      node.getAttribute('display') === 'none' ||
      /(?:^|;)\s*display\s*:\s*none\b/i.test(node.getAttribute('style') ?? '')
    ) {
      if (node === xml.documentElement)
        throw new Error('SVG 中没有可导入的可见路径');
      node.remove();
    }
  }
  return convertSvgPaths(
    new SVGLoader().parse(new XMLSerializer().serializeToString(xml)).paths,
  );
}
