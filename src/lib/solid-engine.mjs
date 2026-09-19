import { inspectMesh } from './mesh-format.mjs';
export { inspectMesh, meshSTL } from './mesh-format.mjs';
import Module from 'manifold-3d';
import { regionContext, geometryContours, describe } from './region-engine.mjs';
import { emptyModel } from './model-schema.mjs';
import { compileCreation } from './creation-engine.mjs';
import { partitionMaterialSolids } from './material-solids.mjs';
let instance;
export async function initSolid(options) {
  if (!instance)
    instance = Module(options)
      .then((m) => {
        m.setup();
        return m;
      })
      .catch((e) => {
        instance = null;
        throw e;
      });
  return instance;
}
export function resolveHeights(model) {
  const cache = new Map(),
    visiting = new Set();
  function get(id) {
    if (cache.has(id)) return cache.get(id);
    if (visiting.has(id)) throw Error('高度依附形成循环');
    const f = model.features.find((f) => f.id === id);
    if (!f) throw Error('依附体块已被删除');
    if (!f.enabled) throw Error('依附体块已停用');
    visiting.add(id);
    let z = f.zMM;
    if (f.attachId) {
      const parent = model.features.find((p) => p.id === f.attachId);
      if (parent?.mode !== 'add' || parent.partId !== f.partId)
        throw Error('只能依附同一零件的凸起体块');
      z += get(f.attachId).top;
    }
    const value = {
      bottom: f.mode === 'cut' ? z - f.heightMM : z,
      top: f.mode === 'cut' ? z : z + f.heightMM,
    };
    if (f.mode !== 'through' && value.bottom < 0)
      throw Error(`「${f.name}」低于底面 Z=0，请调整高度或切削深度`);
    cache.set(id, value);
    visiting.delete(id);
    return value;
  }
  return { get };
}
export function cleanMesh(raw) {
  const positions = [],
    map = new Map(),
    remap = [];
  for (let i = 0; i < raw.vertProperties.length; i += raw.numProp) {
    const p = [0, 1, 2].map((k) => Math.fround(raw.vertProperties[i + k])),
      key = p.join(',');
    if (!map.has(key)) {
      map.set(key, positions.length / 3);
      positions.push(...p);
    }
    remap.push(map.get(key));
  }
  const triangles = [];
  let collapsed = 0;
  for (let i = 0; i < raw.triVerts.length; i += 3) {
    const t = [0, 1, 2].map((k) => remap[raw.triVerts[i + k]]);
    if (new Set(t).size < 3) {
      collapsed++;
      continue;
    }
    triangles.push(...t);
  }
  const result = removeFlatTriangles({ positions, triangles });
  return { ...result, collapsed };
}
// Float32 STL coordinates can collapse a very thin wall to three collinear
// vertices at different Z levels. Retriangulate its neighbour through the middle
// vertex: simply deleting the flat face would open the surface. No vertex moves.
export function removeFlatTriangles(mesh) {
  const { positions: v } = mesh,
    faces = [];
  for (let i = 0; i < mesh.triangles.length; i += 3)
    faces.push(mesh.triangles.slice(i, i + 3));
  const point = (id) => v.slice(id * 3, id * 3 + 3),
    distance = (a, b) => Math.hypot(...point(a).map((n, k) => n - point(b)[k]));
  const area = (ids) => {
    const p = ids.map(point),
      a = p[1].map((n, k) => n - p[0][k]),
      b = p[2].map((n, k) => n - p[0][k]);
    return Math.hypot(
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    );
  };
  for (let pass = 0; pass < 100; pass++) {
    let changed = false;
    for (let i = 0; i < faces.length; i++) {
      const f = faces[i];
      if (!f || area(f) >= 1e-14) continue;
      const edges = [
        [f[0], f[1], f[2]],
        [f[1], f[2], f[0]],
        [f[2], f[0], f[1]],
      ].sort((a, b) => distance(b[0], b[1]) - distance(a[0], a[1]));
      const [a, b, middle] = edges[0];
      const j = faces.findIndex(
        (n, k) =>
          k !== i &&
          n?.includes(a) &&
          n.includes(b) &&
          !n.includes(middle) &&
          area(n) > 1e-14,
      );
      if (j < 0) continue;
      const neighbour = faces[j];
      const k = neighbour.findIndex(
        (n, k) => [a, b].includes(n) && [a, b].includes(neighbour[(k + 1) % 3]),
      );
      const start = neighbour[k],
        end = neighbour[(k + 1) % 3],
        third = neighbour[(k + 2) % 3];
      faces[i] = null;
      faces[j] = [start, middle, third];
      faces.push([middle, end, third]);
      changed = true;
    }
    if (!changed) break;
  }
  return { ...mesh, triangles: faces.filter(Boolean).flat() };
}
export async function buildSolid(
  project,
  partId = 'main',
  options,
  { materials = false } = {},
) {
  project = compileCreation(project);
  const m = await initSolid(options),
    model = project.model || emptyModel(),
    ctx = regionContext(project),
    height = resolveHeights(model),
    owned = new Set(),
    warnings = [],
    featureInfo = [];
  const own = (x) => {
    owned.add(x);
    return x;
  };
  try {
    if (!model.parts.some((p) => p.id === partId)) throw Error('零件不存在');
    const features = model.features.filter(
        (f) => f.enabled && f.partId === partId,
      ),
      adds = features.filter((f) => f.mode === 'add');
    if (!adds.length) throw Error('请先为这个零件添加凸起体块');
    const sections = new Map();
    const crossFor = (f) => {
      if (sections.has(f.id)) return sections.get(f.id);
      let g = ctx.get(f.regionId);
      const repair = model.manufacturingMM || 0;
      if (repair > 0) {
        g = g.buffer(repair, 4).buffer(-repair, 4);
        if (g.isEmpty())
          throw Error(`「${f.name}」在制造清理后为空，请减小清理半径`);
      }
      const cross = own(
        new m.CrossSection(geometryContours(describe(g).geometry), 'EvenOdd'),
      );
      sections.set(f.id, cross);
      return cross;
    };
    const extrude = (f, bottom, top) => {
      const cross = crossFor(f);
      const base = own(cross.extrude(top - bottom));
      return own(base.translate([0, 0, bottom]));
    };
    const bodies = adds.map((f) => {
      const h = height.get(f.id);
      featureInfo.push({ id: f.id, name: f.name, ...h });
      return extrude(f, h.bottom, h.top);
    });
    let body = own(m.Manifold.union(bodies));
    const zmax = Math.max(...featureInfo.map((f) => f.top));
    for (const f of features.filter((f) => f.mode !== 'add')) {
      const h =
          f.mode === 'through'
            ? { bottom: -1, top: zmax + 1 }
            : height.get(f.id),
        tool = extrude(f, h.bottom, h.top),
        before = body.volume();
      body = own(body.subtract(tool));
      if (Math.abs(before - body.volume()) < 1e-7)
        warnings.push(`「${f.name}」没有切到实体，请检查区域和高度`);
      featureInfo.push({ id: f.id, name: f.name, ...h });
    }
    // Discard coplanar feature seams before reducing the mesh. Keeping every
    // source face ID forces sub-float32 slivers to survive simplification.
    body = own(body.asOriginal());
    body = own(body.setTolerance(Math.min(model.toleranceMM / 3, 0.005)));
    if (body.isEmpty()) throw Error('切削移除了整个零件，请调整目标或深度');
    let mesh = cleanMesh(body.getMesh()),
      report = inspectMesh(mesh);
    if (!report.valid && (report.invalidEdges || report.zeroArea)) {
      // Resolve precision collapses inside Manifold, before serialising float32.
      // This keeps topology checks authoritative instead of weakening the STL validator.
      body = own(
        body.warp((v) => {
          for (let k = 0; k < 3; k++) v[k] = Math.fround(v[k]);
        }),
      );
      body = own(body.simplify(Math.min(model.toleranceMM / 3, 0.005)));
      mesh = cleanMesh(body.getMesh());
      report = inspectMesh(mesh);
      warnings.push('已按 STL 坐标精度重新整理实体，并重新检查闭合性');
    }
    if (mesh.collapsed)
      warnings.push(
        `导出网格移除了 ${mesh.collapsed} 个浮点坍缩面，并已重新校验`,
      );
    if (model.manufacturingMM)
      warnings.push(
        `派生几何采用 ${model.manufacturingMM} mm 制造清理，源样条保持原样`,
      );
    if (report.components > 1)
      warnings.push(
        `零件包含 ${report.components} 个分离实体；如需一体打印，请检查层间接触或补充承托轮廓`,
      );
    if (!report.valid)
      warnings.push(
        '存在零宽接触或退化边，暂不能打印导出。请修正来源或预览制造清理',
      );
    let materialParts;
    if (materials) {
      if (!report.valid) throw Error('实体边界无效，请先修复构造再导出 3MF');
      const ordered = partitionMaterialSolids({
        m,
        own,
        adds,
        cuts: features.filter((f) => f.mode !== 'add'),
        height,
        crossFor,
      });
      materialParts = [];
      for (const { feature, solid } of ordered) {
        let part = own(solid.asOriginal());
        part = own(part.setTolerance(Math.min(model.toleranceMM / 3, 0.005)));
        let partMesh = cleanMesh(part.getMesh()),
          partReport = inspectMesh(partMesh);
        if (!partReport.valid) {
          part = own(
            part.warp((v) => {
              for (let k = 0; k < 3; k++) v[k] = Math.fround(v[k]);
            }),
          );
          part = own(part.simplify(Math.min(model.toleranceMM / 3, 0.005)));
          partMesh = cleanMesh(part.getMesh());
          partReport = inspectMesh(partMesh);
        }
        if (!partReport.valid)
          throw Error(
            `「${feature.name}」的分色实体边界无效，请调整相交区域后再导出`,
          );
        materialParts.push({
          id: feature.id,
          name: feature.manufacturing?.regionName || feature.name,
          color: feature.color,
          ...feature.manufacturing,
          mesh: partMesh,
          report: partReport,
        });
      }
      const totalVolume = materialParts.reduce(
        (sum, p) => sum + p.report.volumeMM3,
        0,
      );
      if (
        Math.abs(totalVolume - report.volumeMM3) >
        Math.max(0.001, report.volumeMM3 * 1e-5)
      )
        throw Error('分色体积与整体实体不一致，已停止导出，请检查重叠区域');
    }
    return {
      mesh,
      report,
      warnings,
      features: featureInfo,
      partId,
      ...(materials ? { materialParts } : {}),
    };
  } finally {
    for (const obj of [...owned].reverse()) obj.delete();
  }
}
