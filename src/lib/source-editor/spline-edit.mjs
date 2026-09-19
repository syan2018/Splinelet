import { validateProject } from '../project.ts';
import { creationDocument } from '../creation-schema.mjs';

const point = (p) => {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y))
    throw Error('样条坐标必须是有限的 {x,y}');
  return { x: p.x, y: p.y };
};
const space = (project, units = 'image') => {
  if (!['image', 'model'].includes(units))
    throw Error('units 必须为 image 或 model');
  const s = project.widthMM / project.width;
  return {
    read: (p) =>
      units === 'image'
        ? point(p)
        : {
            x: (p.x - project.width / 2) * s,
            y: (project.height / 2 - p.y) * s,
          },
    write: (p) =>
      units === 'image'
        ? point(p)
        : {
            x: point(p).x / s + project.width / 2,
            y: project.height / 2 - p.y / s,
          },
  };
};

// A seam is a single node. Handles are absolute coordinates, like Blender's
// co / handle_left / handle_right, with explicit FREE handles (no auto fitting).
export function splineNodes(path) {
  if (!path.curves.length)
    return [
      {
        co: point(path.start),
        handleLeft: point(path.start),
        handleRight: point(path.start),
      },
    ];
  const nodes = path.curves.map((curve, i) => ({
    co: point(curve[0]),
    handleLeft: point(
      i
        ? path.curves[i - 1][2]
        : path.closed
          ? path.curves.at(-1)[2]
          : curve[0],
    ),
    handleRight: point(curve[1]),
  }));
  if (!path.closed)
    nodes.push({
      co: point(path.curves.at(-1)[3]),
      handleLeft: point(path.curves.at(-1)[2]),
      handleRight: point(path.curves.at(-1)[3]),
    });
  return nodes;
}

export function inspectSplines(project, { pathIds, units = 'image' } = {}) {
  const convert = space(project, units).read;
  if (
    pathIds !== undefined &&
    (!Array.isArray(pathIds) ||
      pathIds.some((id) => !project.paths.some((p) => p.id === id)))
  )
    throw Error('pathIds 必须为现有路径 ID');
  return {
    units,
    splines: project.paths
      .filter((p) => !pathIds || pathIds.includes(p.id))
      .map((p) => ({
        id: p.id,
        name: p.name,
        closed: p.closed,
        nodes: splineNodes(p).map((n) =>
          Object.fromEntries(
            Object.entries(n).map(([k, v]) => [k, convert(v)]),
          ),
        ),
      })),
  };
}

// Pure transaction: validate the entire proposal before the caller records one
// undo entry. Existing IDs keep their construction references and ownership.
export function editSplines(
  project,
  { splines, objectId, units = 'image' } = {},
) {
  if (!Array.isArray(splines) || !splines.length || splines.length > 200)
    throw Error('splines 需要 1–200 条样条');
  const coordinates = space(project, units),
    next = structuredClone(project);
  const creation = creationDocument(next);
  const owner =
    objectId === undefined
      ? null
      : creation.objects.find((o) => o.id === objectId);
  if (objectId !== undefined && !owner) throw Error('目标部件不存在');
  const updated = new Set(),
    pathIds = [],
    newRoles = new Map();
  for (const entry of splines) {
    if (!entry || typeof entry !== 'object') throw Error('样条定义无效');
    const old =
      entry.id === undefined ? null : next.paths.find((p) => p.id === entry.id);
    if (entry.id !== undefined && !old) throw Error('待编辑样条不存在');
    if (old && updated.has(old.id)) throw Error('一次提交不能重复编辑同一样条');
    if (old && owner && !owner.pathIds.includes(old.id))
      throw Error('请使用 move_paths 显式转移样条所属部件');
    if (old && entry.role !== undefined)
      throw Error('已有样条请使用 roles 修改用途');
    if (entry.closed !== undefined && typeof entry.closed !== 'boolean')
      throw Error('closed 必须为布尔值');
    if (
      entry.name !== undefined &&
      (typeof entry.name !== 'string' ||
        !entry.name.trim() ||
        entry.name.length > 120)
    )
      throw Error('name 需要 1–120 个字符');
    const closed = entry.closed ?? old?.closed ?? false;
    const source =
      entry.nodes ??
      (old &&
        splineNodes(old).map((n) =>
          Object.fromEntries(
            Object.entries(n).map(([k, v]) => [k, coordinates.read(v)]),
          ),
        ));
    if (
      !Array.isArray(source) ||
      source.length < (closed ? 3 : 2) ||
      source.length > 1000
    )
      throw Error('开放样条至少 2 个节点，闭合至少 3 个；最多 1000 个');
    const matrix = entry.matrix ?? [1, 0, 0, 1, 0, 0];
    if (
      !Array.isArray(matrix) ||
      matrix.length !== 6 ||
      !matrix.every(Number.isFinite) ||
      Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]) < 1e-12
    )
      throw Error('matrix 需要非退化的 [a,b,c,d,e,f]');
    const transform = (value) => {
      const p = point(value),
        [a, b, c, d, e, f] = matrix;
      return coordinates.write({
        x: a * p.x + c * p.y + e,
        y: b * p.x + d * p.y + f,
      });
    };
    const nodes = source.map((n) => ({
      co: transform(n.co),
      handleLeft: transform(n.handleLeft ?? n.co),
      handleRight: transform(n.handleRight ?? n.co),
    }));
    const curves = Array.from(
      { length: closed ? nodes.length : nodes.length - 1 },
      (_, i) => {
        const a = nodes[i],
          b = nodes[(i + 1) % nodes.length];
        return [a.co, a.handleRight, b.handleLeft, b.co].map(point);
      },
    );
    const id = old?.id ?? crypto.randomUUID();
    const path = {
      ...(old || { id, color: '#b99a60', visible: true, quality: 1 }),
      name: entry.name ?? old?.name ?? '贝塞尔样条',
      closed,
      curves,
      start: point(nodes[0].co),
      anchors: [point(nodes[0].co), ...curves.map((c) => point(c[3]))],
      nodeModes:
        entry.nodes || !old || closed !== old.closed
          ? nodes.map(() => 'corner')
          : old.nodeModes,
      fitting: 'single',
      fitError: 0,
    };
    if (old) next.paths[next.paths.indexOf(old)] = path;
    else {
      const role = entry.role ?? (closed ? 'boundary' : 'guide');
      if (
        !['boundary', 'hole', 'guide'].includes(role) ||
        (role !== 'guide' && !closed)
      )
        throw Error('新样条用途为 boundary、hole 或 guide；边界和洞必须闭合');
      if (role === 'hole' && !owner) throw Error('挖洞样条必须指定 objectId');
      next.paths.push(path);
      newRoles.set(id, role);
      if (owner) {
        owner.pathIds.push(id);
        owner.roles[id] = role;
      }
    }
    updated.add(id);
    pathIds.push(id);
  }
  next.version = 3;
  next.creation = creation;
  next.creation = creationDocument(next);
  for (const [id, role] of newRoles) {
    const assigned = next.creation.objects.find((o) => o.pathIds.includes(id));
    assigned.roles[id] = role;
  }
  validateProject(next);
  return { project: next, pathIds };
}
