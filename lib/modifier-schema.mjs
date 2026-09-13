// Declarative surface programs: references and parameters only, never meshes
// or cached polygons. Imported face programs are nested below an object stack.
export const modifierKinds = ['boolean', 'split', 'offset'];
const booleanKinds = ['difference', 'union', 'intersection'];
export function migrateModifiers(project, object) {
  if (object.modifiers !== undefined) return;
  object.modifiers = [];
  object.sources = {};
  const regions = new Map((project.model?.regions || []).map((r) => [r.id, r]));
  const holes = new Set(
    object.pathIds.filter((id) => object.roles[id] === 'hole'),
  );
  for (const featureId of object.featureIds) {
    const feature = project.model?.features.find((f) => f.id === featureId);
    if (!feature) continue;
    let id = feature.regionId;
    const seen = new Set(),
      modifiers = [];
    while (booleanKinds.includes(regions.get(id)?.kind) && !seen.has(id)) {
      seen.add(id);
      const r = regions.get(id),
        operand = regions.get(r.b);
      // A final object hole supersedes an identical earlier subtraction in a
      // linear Boolean chain. Extract it once so changing its scope or disabling
      // it does not leave a second hidden cut inside the imported source.
      if (
        !(
          r.kind === 'difference' &&
          operand?.kind === 'path' &&
          holes.has(operand.pathId)
        )
      )
        modifiers.unshift({
          id: `source:${featureId}:${r.id}`,
          name: r.name,
          type: 'boolean',
          operation: r.kind,
          input: { kind: 'region', id: r.b },
          enabled: true,
          targets: { kind: 'all' },
        });
      id = r.a;
    }
    if (id !== feature.regionId)
      object.sources[featureId] = { regionId: id, modifiers };
  }
  for (const pathId of holes)
    object.modifiers.push({
      id: `hole:${pathId}`,
      name:
        (project.paths.find((p) => p.id === pathId)?.name || '闭合线') +
        ' · 挖洞',
      type: 'boolean',
      operation: 'difference',
      input: { kind: 'path', id: pathId },
      enabled: true,
      targets: { kind: 'all' },
      rolePathId: pathId,
    });
}

export function syncHoleModifiers(project, object) {
  object.modifiers = object.modifiers.filter(
    (m) =>
      !m.rolePathId ||
      object.roles[m.rolePathId] === (m.type === 'split' ? 'divider' : 'hole'),
  );
  for (const pathId of object.pathIds.filter(
    (id) => object.roles[id] === 'hole',
  )) {
    if (object.modifiers.some((m) => m.rolePathId === pathId)) continue;
    for (const source of Object.values(object.sources || {}))
      source.modifiers = source.modifiers.filter(
        (m) =>
          !(
            m.type === 'boolean' &&
            m.operation === 'difference' &&
            (m.input.kind === 'path'
              ? m.input.id === pathId
              : project.model?.regions.some(
                  (r) =>
                    r.id === m.input.id &&
                    r.kind === 'path' &&
                    r.pathId === pathId,
                ))
          ),
      );
    object.modifiers.push({
      id: `hole:${pathId}`,
      name:
        (project.paths.find((p) => p.id === pathId)?.name || '闭合线') +
        ' · 挖洞',
      type: 'boolean',
      operation: 'difference',
      input: { kind: 'path', id: pathId },
      enabled: true,
      targets: { kind: 'all' },
      rolePathId: pathId,
    });
  }
}

export function validateModifiers(object, swatches) {
  if (object.modifiers === undefined) return;
  const name = (v) => typeof v === 'string' && v.length > 0 && v.length <= 500;
  const ids = new Set();
  const validateStack = (stack, nested = false) => {
    if (!Array.isArray(stack) || stack.length > 200)
      throw Error('修改器栈无效');
    for (const m of stack) {
      if (
        !m ||
        !name(m.id) ||
        ids.has(m.id) ||
        !name(m.name) ||
        !modifierKinds.includes(m.type) ||
        typeof m.enabled !== 'boolean'
      )
        throw Error('修改器属性无效');
      ids.add(m.id);
      if (
        !m.targets ||
        !['all', 'selected'].includes(m.targets.kind) ||
        (m.targets.kind === 'selected' &&
          (!Array.isArray(m.targets.refs) ||
            !m.targets.refs.length ||
            m.targets.refs.length > 1000 ||
            m.targets.refs.some((r) => !name(r.key) || !name(r.name))))
      )
        throw Error('修改器作用范围无效');
      if (m.type === 'boolean' && !booleanKinds.includes(m.operation))
        throw Error('布尔运算类型无效');
      if (
        m.type !== 'offset' &&
        (!m.input ||
          !name(m.input.id) ||
          !['path', 'region', 'object'].includes(m.input.kind))
      )
        throw Error('修改器来源引用无效');
      if (
        m.input?.projection !== undefined &&
        !['surface', 'outline'].includes(m.input.projection)
      )
        throw Error('来源投影方式无效');
      if (nested && (m.type !== 'boolean' || m.input.kind === 'object'))
        throw Error(
          '来源构造只接受面或曲线的布尔操作；对象嵌套请放入对象修改器栈',
        );
      if (m.type === 'split' && m.input.kind !== 'path')
        throw Error('分区需要一条开放样条');
      if (
        m.type === 'offset' &&
        (!Number.isFinite(m.distanceMM) || Math.abs(m.distanceMM) > 20)
      )
        throw Error('偏移距离须在 -20–20 mm');
      if (
        m.joinMM !== undefined &&
        (!Number.isFinite(m.joinMM) || m.joinMM < 0 || m.joinMM > 5)
      )
        throw Error('分区接合范围须在 0–5 mm');
      if (m.styles !== undefined) {
        if (!Array.isArray(m.styles) || m.styles.length > 2000)
          throw Error('分区样式无效');
        for (const s of m.styles)
          if (
            !name(s.key) ||
            (s.swatchId && !swatches.has(s.swatchId)) ||
            (s.heightMM !== undefined &&
              (!Number.isFinite(s.heightMM) ||
                s.heightMM < 0.01 ||
                s.heightMM > 1000))
          )
            throw Error('修改器输出样式无效');
      }
      if (
        m.outputContract !== undefined &&
        (!Array.isArray(m.outputContract) ||
          m.outputContract.length > 2000 ||
          m.outputContract.some(
            (o) =>
              typeof o.key !== 'string' ||
              typeof o.signature !== 'string' ||
              o.signature.length > 200000,
          ))
      )
        throw Error('修改器输出约束无效');
    }
  };
  validateStack(object.modifiers);
  if (object.sources !== undefined) {
    if (
      !object.sources ||
      typeof object.sources !== 'object' ||
      Array.isArray(object.sources)
    )
      throw Error('基础面来源无效');
    for (const source of Object.values(object.sources)) {
      if (!name(source.regionId)) throw Error('基础面引用无效');
      validateStack(source.modifiers, true);
    }
  }
}

export function targetForCell(cell) {
  if (cell.contourSignature)
    return { key: cell.key, name: cell.name || '区域' };
  if (cell.modifierResult) return { key: cell.key, name: cell.name || '分区' };
  if (cell.featureId)
    return { key: 'feature:' + cell.featureId, name: cell.name || '面' };
  if (cell.regionId)
    return { key: 'region:' + cell.regionId, name: cell.name || '面' };
  // A closed source identifies an unsplit native face independently of list
  // order. Legacy divider cells use an explicit topology signature, failing
  // closed if that graph changes instead of silently targeting another index.
  return {
    key: cell.boundaryPathIds?.length
      ? 'paths:' + cell.boundaryPathIds.slice().sort().join('|')
      : cell.key,
    name: cell.name || '区域',
    ...(cell.boundaryPathIds?.length ? {} : { topology: cell.targetTopology }),
  };
}
