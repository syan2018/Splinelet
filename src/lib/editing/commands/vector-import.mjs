import { Color } from 'three';
import { validateDocument } from '../../document/schema.mjs';
import { evaluateProgram } from '../../construction/document-evaluation.mjs';
import { createAuthoringCommand } from './authoring.mjs';
import { createCommandIdAllocator } from '../command-ids.mjs';

const finitePoint = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const positive = (n) => Number.isFinite(n) && n > 0;
const nodeRef = (id) => ({ kind: 'node', id });
const normalizeColor = (value) => {
  if (
    typeof value !== 'string' ||
    !/^(?:#[\da-f]{3}|#[\da-f]{6}|[a-z]+|(?:rgb|hsl)a?\([^;{}]+\))$/i.test(
      value.trim(),
    )
  )
    throw Error('SVG 颜色无效');
  const color = value.trim().toLowerCase();
  if (/^[a-z]+$/.test(color) && !Object.hasOwn(Color.NAMES, color))
    throw Error('SVG 颜色名称无效');
  const functional = /^(rgb|rgba|hsl|hsla)\((.*)\)$/.exec(color);
  if (functional) {
    const parts = functional[2].split(',').map((part) => part.trim());
    if (
      parts.length !== (functional[1].endsWith('a') ? 4 : 3) ||
      parts.some((part) => !/^[+-]?(?:\d+\.?\d*|\.\d+)%?$/.test(part)) ||
      (functional[1].startsWith('hsl') &&
        (!parts[1].endsWith('%') || !parts[2].endsWith('%'))) ||
      (functional[1].startsWith('rgb') &&
        !parts
          .slice(0, 3)
          .every((part) => part.endsWith('%') === parts[0].endsWith('%')))
    )
      throw Error('SVG 颜色数值无效，请使用十六进制或标准 rgb/hsl 颜色');
  }
  return `#${new Color().setStyle(color).getHexString()}`;
};

/** One atomic import: exact source cubics, construction, colors, relief, group. */
export function createVectorImportCommand(request) {
  const input = structuredClone(request);
  return (original, context) => {
    const {
      name = 'SVG 对象',
      splines,
      bounds,
      widthMM,
      centerMM = [0, 0],
      thicknessMM = 0.6,
      attachId,
    } = input;
    if (typeof name !== 'string' || !name.trim() || name.length > 500)
      throw Error('导入对象名称无效');
    if (
      !positive(widthMM) ||
      widthMM > 10000 ||
      !positive(thicknessMM) ||
      thicknessMM > 1000
    )
      throw Error('导入尺寸和厚度必须为有效正数');
    if (
      !Array.isArray(centerMM) ||
      centerMM.length !== 2 ||
      !centerMM.every(Number.isFinite)
    )
      throw Error('导入位置必须是有限坐标');
    if (
      !bounds ||
      !['minX', 'minY', 'maxX', 'maxY'].every((key) =>
        Number.isFinite(bounds[key]),
      ) ||
      bounds.maxX <= bounds.minX ||
      bounds.maxY < bounds.minY
    )
      throw Error('SVG 边界无效');
    if (!Array.isArray(splines) || !splines.length || splines.length > 5000)
      throw Error('SVG 路径数量无效');
    if (attachId !== undefined && original.nodes[attachId]?.kind !== 'shape')
      throw Error('附着目标必须是现有部件');
    const groups = new Map();
    let nodeCount = 0;
    for (const spline of splines) {
      if (
        typeof spline.closed !== 'boolean' ||
        !['boundary', 'hole', 'guide'].includes(spline.role) ||
        !Array.isArray(spline.nodes) ||
        spline.nodes.length < (spline.closed ? 3 : 2)
      )
        throw Error('SVG 路径结构无效');
      nodeCount += spline.nodes.length;
      if (nodeCount > 50000) throw Error('SVG 节点过多，请先简化');
      if (
        !spline.nodes.every(
          (node) =>
            finitePoint(node.co) &&
            (node.handleLeft === undefined || finitePoint(node.handleLeft)) &&
            (node.handleRight === undefined || finitePoint(node.handleRight)),
        )
      )
        throw Error('SVG 曲线坐标无效');
      const stroke = spline.role === 'guide';
      if (
        stroke
          ? !positive(spline.strokeWidth) || !spline.stroke
          : !spline.closed || !spline.fill
      )
        throw Error('SVG 笔画宽度或填充轮廓无效');
      const color = normalizeColor(stroke ? spline.stroke : spline.fill);
      if (
        typeof spline.fillGroup !== 'string' ||
        !spline.fillGroup ||
        typeof spline.elementId !== 'string'
      )
        throw Error('SVG 路径分组无效');
      const key = JSON.stringify(
        stroke
          ? ['stroke', spline.elementId, spline.strokeWidth, color]
          : ['fill', spline.fillGroup],
      );
      const group = groups.get(key) ?? { splines: [], stroke, color };
      if (group.color !== color) throw Error('同一填充轮廓不能使用不同颜色');
      group.splines.push(spline);
      groups.set(key, group);
    }
    for (const group of groups.values())
      if (
        !group.stroke &&
        group.splines.filter((spline) => spline.role === 'boundary').length !==
          1
      )
        throw Error('每个填充组必须包含一个外轮廓');
    let document = structuredClone(original);
    const allocate = createCommandIdAllocator(document, context.idFactory);
    const scale = widthMM / (bounds.maxX - bounds.minX);
    const cx = (bounds.minX + bounds.maxX) / 2,
      cy = (bounds.minY + bounds.maxY) / 2;
    const position = (p) => [
      (p.x - cx) * scale + centerMM[0],
      (cy - p.y) * scale + centerMM[1],
    ];
    const changedRefs = [],
      shapeIds = [];
    const swatches = new Map(
      Object.values(document.appearances.swatches).map((swatch) => [
        normalizeColor(swatch.color),
        swatch.id,
      ]),
    );
    for (const group of groups.values()) {
      let ownerNodeId;
      for (const spline of group.splines) {
        const points = spline.nodes.map((node) => position(node.co));
        const cubics = Array.from(
          { length: spline.closed ? points.length : points.length - 1 },
          (_, i) => {
            const next = (i + 1) % points.length;
            return [
              points[i],
              position(spline.nodes[i].handleRight ?? spline.nodes[i].co),
              position(spline.nodes[next].handleLeft ?? spline.nodes[next].co),
              points[next],
            ];
          },
        );
        const drawn = createAuthoringCommand({
          kind: 'draw-guide',
          name: spline.name || name,
          ownerNodeId,
          points,
          cubics,
          closed: spline.closed,
        })(document, { idFactory: allocate });
        document = drawn.document;
        const path = drawn.changedRefs.find((ref) => ref.kind === 'path');
        ownerNodeId = document.sketches[path.sketchId].ownerNodeId;
        changedRefs.push(...drawn.changedRefs);
      }
      shapeIds.push(ownerNodeId);
      const program = document.programs[document.nodes[ownerNodeId].programId];
      const operatorId = allocate();
      program.operators[operatorId] = {
        id: operatorId,
        type: group.stroke ? 'stroke' : 'fill',
        name: group.stroke ? 'SVG 笔画' : 'SVG 填充',
        enabled: true,
        inputs: {
          input: [
            {
              ...program.outputs.curves,
              space: 'local-result',
              transform: [1, 0, 0, 1, 0, 0],
            },
          ],
        },
        params: group.stroke
          ? { widthMM: group.splines[0].strokeWidth * scale }
          : { rule: 'even-odd' },
      };
      program.outputs.regions = {
        kind: 'port',
        ownerNodeId,
        operatorId,
        port: 'regions',
        domain: 'regions',
      };
      let swatchId = swatches.get(group.color);
      if (!swatchId) {
        swatchId = allocate();
        document.appearances.swatches[swatchId] = {
          id: swatchId,
          name: `SVG ${group.color}`,
          color: group.color,
        };
        swatches.set(group.color, swatchId);
      }
      document.appearances.defaults[ownerNodeId] = { swatchId };
      document.reliefDefinitions.defaults[ownerNodeId] = {
        enabled: true,
        mode: 'add',
        thickness: { kind: 'mm', value: thicknessMM },
        placement: attachId
          ? { kind: 'attached', target: nodeRef(attachId), offsetMM: 0 }
          : { kind: 'free', zMM: 0 },
      };
    }
    const grouped = createAuthoringCommand({
      kind: 'group-nodes',
      nodeIds: shapeIds,
      name,
    })(document, { idFactory: allocate });
    document = grouped.document;
    validateDocument(document);
    for (const id of shapeIds) {
      const result = evaluateProgram(document, id);
      if (
        result.curves.status !== 'ready' ||
        result.regions.status !== 'ready' ||
        !result.regions.value.regions.length
      )
        throw Error(`SVG 构面失败：${document.nodes[id].name}`);
    }
    return {
      document,
      changedRefs: [...changedRefs, ...grouped.changedRefs],
      selectionIntent: grouped.selectionIntent,
    };
  };
}
