export const emptyModel = () => ({
  version: 1,
  toleranceMM: 0.015,
  regions: [],
  features: [],
  parts: [{ id: 'main', name: '零件 1' }],
});
export function validateModel(m) {
  if (
    !m ||
    m.version !== 1 ||
    !Array.isArray(m.regions) ||
    !Array.isArray(m.features) ||
    !Array.isArray(m.parts) ||
    m.regions.length > 1000 ||
    m.features.length > 1000 ||
    !m.parts.length ||
    m.parts.length > 100
  )
    throw Error('浮雕工程结构无效');
  const num = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
  const ids = new Set();
  for (const o of [...m.parts, ...m.regions, ...m.features]) {
    if (
      !o ||
      typeof o.id !== 'string' ||
      !o.id ||
      ids.has(o.id) ||
      typeof o.name !== 'string' ||
      !o.name.trim() ||
      o.name.length > 200
    )
      throw Error('浮雕对象 ID 或名称无效');
    ids.add(o.id);
  }
  if (!num(m.toleranceMM, 0.001, 0.2))
    throw Error('几何精度必须在 0.001–0.2 mm');
  if (m.manufacturingMM !== undefined && !num(m.manufacturingMM, 0, 0.2))
    throw Error('制造清理半径必须在 0–0.2 mm');
  for (const r of m.regions) {
    if (
      ![
        'path',
        'union',
        'difference',
        'intersection',
        'split',
        'between',
        'stroke',
      ].includes(r.kind) ||
      !/^#[a-f0-9]{6}$/i.test(r.color)
    )
      throw Error('区域操作或颜色无效');
    if (['path', 'stroke'].includes(r.kind) && typeof r.pathId !== 'string')
      throw Error('区域缺少来源路径');
    if (
      ['union', 'difference', 'intersection'].includes(r.kind) &&
      (typeof r.a !== 'string' || typeof r.b !== 'string')
    )
      throw Error('布尔操作缺少输入');
    if (
      r.kind === 'between' &&
      (!Array.isArray(r.pathIds) || r.pathIds.length !== 2)
    )
      throw Error('围面需要两条路径');
    if (
      r.boundaryRegionId !== undefined &&
      (r.kind !== 'between' ||
        typeof r.boundaryRegionId !== 'string' ||
        !r.boundaryRegionId)
    )
      throw Error('围面父边界无效');
    if (
      r.kind === 'split' &&
      (typeof r.baseId !== 'string' ||
        !Array.isArray(r.pathIds) ||
        !r.pathIds.length ||
        !Array.isArray(r.seed) ||
        !r.seed.every(Number.isFinite) ||
        r.seed.length !== 2 ||
        !Number.isInteger(r.expectedCount) ||
        r.expectedCount < 2)
    )
      throw Error('切分区域引用无效');
    if (
      r.contourSignature !== undefined &&
      (typeof r.contourSignature !== 'string' ||
        r.contourSignature.length > 200000)
    )
      throw Error('分区来源标识无效');
    if (r.joinMM !== undefined && !num(r.joinMM, 0, 5))
      throw Error('接边距离必须在 0–5 mm');
    if (r.boundaryJoinMM !== undefined && !num(r.boundaryJoinMM, 0, 5))
      throw Error('边界接合距离必须在 0–5 mm');
    if (r.seedWidthMM !== undefined && !num(r.seedWidthMM, 0.001, 1e6))
      throw Error('分区比例无效');
    if (r.widthMM !== undefined && !num(r.widthMM, 0.01, 100))
      throw Error('线宽无效');
    if (r.kind === 'stroke' && !num(r.widthMM, 0.01, 100))
      throw Error('线宽无效');
    if (
      r.pathIds !== undefined &&
      (!Array.isArray(r.pathIds) ||
        r.pathIds.length > 1000 ||
        r.pathIds.some((id) => typeof id !== 'string' || !id))
    )
      throw Error('路径引用无效');
    if (r.visible !== undefined && typeof r.visible !== 'boolean')
      throw Error('区域显示选项无效');
    if (r.close !== undefined && typeof r.close !== 'boolean')
      throw Error('闭合选项无效');
    if (r.repair !== undefined && typeof r.repair !== 'boolean')
      throw Error('修复选项无效');
  }
  for (const f of m.features) {
    if (
      !['add', 'cut', 'through'].includes(f.mode) ||
      typeof f.regionId !== 'string' ||
      typeof f.partId !== 'string' ||
      !num(f.heightMM, 0.01, 1000) ||
      !num(f.zMM, -1000, 1000) ||
      !/^#[a-f0-9]{6}$/i.test(f.color) ||
      typeof f.enabled !== 'boolean'
    )
      throw Error('浮雕高度、引用或颜色无效');
    if (f.attachId !== undefined && typeof f.attachId !== 'string')
      throw Error('依附对象无效');
  }
  return m;
}
export function regionInputs(r) {
  return ['union', 'difference', 'intersection'].includes(r.kind)
    ? [r.a, r.b]
    : r.kind === 'between' && r.boundaryRegionId
      ? [r.boundaryRegionId]
      : r.kind === 'split'
        ? [r.baseId]
        : [];
}
export function regionDependants(m, ids) {
  const found = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of m.regions)
      if (!found.has(r.id) && regionInputs(r).some((id) => found.has(id))) {
        found.add(r.id);
        changed = true;
      }
  }
  return [...found];
}
export function featureDependants(m, ids) {
  const found = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of m.features)
      if (!found.has(f.id) && found.has(f.attachId)) {
        found.add(f.id);
        changed = true;
      }
  }
  return [...found];
}
