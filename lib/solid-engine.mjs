import { inspectMesh } from './mesh-format.mjs';
export { inspectMesh, meshSTL } from './mesh-format.mjs';
import Module from 'manifold-3d';
import { regionContext, geometryContours, describe } from './region-engine.mjs';
import { emptyModel } from './model-schema.mjs';
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
  return { positions, triangles, collapsed };
}
export async function buildSolid(project, partId = 'main', options) {
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
    const extrude = (f, bottom, top) => {
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
    const mesh = cleanMesh(body.getMesh()),
      report = inspectMesh(mesh);
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
        `零件包含 ${report.components} 个分离实体，请增加底板连接，或分配为不同零件`,
      );
    if (!report.valid)
      warnings.push(
        '存在零宽接触或退化边，暂不能打印导出。请修正来源或预览制造清理',
      );
    return { mesh, report, warnings, features: featureInfo, partId };
  } finally {
    for (const obj of [...owned].reverse()) obj.delete();
  }
}
