import { geometryContours } from '../geometry-format.mjs';
import { meshSTL } from '../mesh-format.mjs';
import { pack3MF } from '../three-mf.mjs';
import { blenderScript } from './blender.mjs';

const escape = (value) =>
  String(value).replace(
    /[<>&"']/g,
    (character) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;',
      })[character],
  );
const number = (value) => {
  if (!Number.isFinite(value)) throw Error('导出坐标无效');
  return String(value);
};
const point = (value) => (Array.isArray(value) ? value : [value.x, value.y]);
const cubicPath = (curves) =>
  curves
    .flatMap((curve) => curve.edges || [])
    .map((edge) => {
      const cubic = edge.cubic.map(point);
      const move = `M ${number(cubic[0][0])} ${number(cubic[0][1])} `;
      return `${move}C ${cubic
        .slice(1)
        .map((item) => `${number(item[0])} ${number(item[1])}`)
        .join(' ')}`;
    })
    .join(' ');
const regionPath = (geometry) =>
  geometryContours(geometry)
    .map(
      (ring) =>
        `M ${ring.map(([x, y]) => `${number(x)} ${number(y)}`).join(' L ')} Z`,
    )
    .join(' ');
const requireCommitted = (snapshot) => {
  if (!snapshot || snapshot.previewId !== null)
    throw Error('导出只能消费已提交的指定 revision snapshot');
  if (
    typeof snapshot.epoch !== 'string' ||
    !Number.isInteger(snapshot.revision)
  )
    throw Error('snapshot 缺少 epoch 或 revision');
};
const stageFor = (snapshot, name) =>
  snapshot.snapshot?.[name] || snapshot[name];
const readyValue = (snapshot, name) => {
  const result = stageFor(snapshot, name);
  if (!result || result.status !== 'ready')
    throw Error(`${name} 不是当前可导出的 ready 阶段`);
  return result.value;
};
const svg = (body, coordinates) => {
  const points = [];
  const visit = (value) => {
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      value.every(Number.isFinite)
    )
      points.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
  };
  visit(coordinates);
  const bounds = points.reduce(
    (b, [x, y]) => [
      Math.min(b[0], x),
      Math.min(b[1], y),
      Math.max(b[2], x),
      Math.max(b[3], y),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
  const [x, y, maxX, maxY] = points.length ? bounds : [0, 0, 1, 1];
  const width = Math.max(maxX - x, 0.001),
    height = Math.max(maxY - y, 0.001);
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="${x} ${-maxY} ${width} ${height}"><g transform="scale(1 -1)">${body}</g></svg>`;
};

/** Serializes only the explicitly requested V4 stage; it never reads legacy Project. */
export async function exportSnapshot(snapshot, options = {}) {
  requireCommitted(snapshot);
  const format = options.format;
  const requestedStage = options.stage;
  if (format === 'svg-source') {
    if (requestedStage !== 'curves')
      throw Error('svg-source 必须指定 curves stage');
    const value = readyValue(
      snapshot,
      stageFor(snapshot, 'sourceCurves') ? 'sourceCurves' : 'curves',
    );
    if (
      value.curves.some((curve) =>
        curve.edges?.some((edge) =>
          edge.instances?.some(
            (instance) =>
              !options.sourceOperatorIds?.includes(instance.operatorId),
          ),
        ),
      )
    )
      throw Error(
        'svg-source 只能消费未派生的 Source cubic，重复纹样请导出对应区域或实体',
      );
    return {
      format,
      mimeType: 'image/svg+xml',
      data: svg(
        value.curves
          .map(
            (curve) =>
              `<path data-key="${escape(curve.key)}" d="${cubicPath([curve])}${curve.closed ? ' Z' : ''}" fill="none" stroke="black"/>`,
          )
          .join(''),
        value.curves.flatMap((curve) => curve.edges.map((edge) => edge.cubic)),
      ),
    };
  }
  if (format === 'svg-colored') {
    if (requestedStage !== 'regions')
      throw Error('svg-colored 必须指定 regions stage');
    const value = readyValue(
      snapshot,
      stageFor(snapshot, 'worldRegions') ? 'worldRegions' : 'regions',
    );
    const colors = options.colors || {};
    return {
      format,
      mimeType: 'image/svg+xml',
      data: svg(
        value.regions
          .map(
            (region) =>
              `<path data-key="${escape(region.ref.key)}" d="${regionPath(region.geometry)}" fill="${escape(region.color || colors[region.ref.key] || '#000000')}" fill-rule="evenodd"/>`,
          )
          .join(''),
        value.regions.map((region) => region.geometry.coordinates),
      ),
    };
  }
  if (format === 'blender-source') {
    if (requestedStage !== 'curves')
      throw Error('blender-source 必须指定 curves stage');
    const value = readyValue(
      snapshot,
      stageFor(snapshot, 'sourceCurves') ? 'sourceCurves' : 'curves',
    );
    if (options.script)
      return {
        format,
        mimeType: 'text/x-python',
        data: blenderScript(value, 'curves'),
      };
    return {
      format,
      mimeType: 'application/json',
      data: {
        units: 'mm',
        ...structuredClone(
          readyValue(
            snapshot,
            stageFor(snapshot, 'sourceCurves') ? 'sourceCurves' : 'curves',
          ),
        ),
      },
    };
  }
  if (format === 'blender-bodies') {
    if (requestedStage !== 'bodies')
      throw Error('blender-bodies 必须指定 bodies stage');
    const value = readyValue(snapshot, 'bodies');
    if (options.script)
      return {
        format,
        mimeType: 'text/x-python',
        data: blenderScript(value, 'bodies'),
      };
    return {
      format,
      mimeType: 'application/json',
      data: structuredClone(readyValue(snapshot, 'bodies')),
    };
  }
  if (!['stl', '3mf', '3mf-bambu'].includes(format))
    throw Error('未知导出格式');
  if (requestedStage !== 'bodies')
    throw Error(`${format} 必须指定 bodies stage`);
  const bodies = readyValue(snapshot, 'bodies').bodies;
  if (!Array.isArray(bodies) || !bodies.length)
    throw Error('BodySet 没有可导出实体');
  if (format === 'stl') {
    if (bodies.length !== 1) throw Error('STL 一次只能导出一个 Part');
    return { format, mimeType: 'model/stl', data: meshSTL(bodies[0].mesh) };
  }
  const parts = bodies.flatMap((body) =>
    body.materialParts.map((material, index) => ({
      id: `${body.partId}:${material.ref.key}:${index}`,
      name: material.ref.key,
      color: material.color,
      swatchName: material.swatchId || material.color,
      mesh: material.mesh,
      partId: body.partId,
    })),
  );
  if (format === '3mf-bambu' && !options.slicerTemplate)
    throw Error('3mf-bambu 需要已验证的 Bambu 切片模板');
  const packed = pack3MF(parts, {
    name: options.name || 'Splinelet',
    slicerTemplate: format === '3mf-bambu' ? options.slicerTemplate : undefined,
  });
  return { format, mimeType: 'model/3mf', data: packed.bytes };
}
