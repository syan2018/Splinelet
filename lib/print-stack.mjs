// Manufacturing placement is a final, geometry-independent stage. Slice counts
// are authoritative; millimetres are only materialized for geometry consumers.
export const printMM = (layers, layerHeightMM) =>
  Number((layers * layerHeightMM).toFixed(6));
export const printCount = (mm, layerHeightMM) =>
  Math.max(1, Math.round(mm / layerHeightMM));
export function checkPrintCount(value) {
  if (!Number.isInteger(value) || value < 1 || value > 100000)
    throw Error('厚度必须是 1–100000 之间的整数打印层数');
  return value;
}
export function requestedPrintCount(args, layerHeightMM) {
  if (args.heightLayers !== undefined)
    return checkPrintCount(args.heightLayers);
  const count = args.heightMM / layerHeightMM,
    rounded = Math.round(count);
  if (Math.abs(count - rounded) > 1e-6)
    throw Error('厚度需为整数打印层数，请传入 heightLayers');
  return checkPrintCount(rounded);
}
export function checkLayerHeight(value) {
  if (!Number.isFinite(value) || value < 0.01 || value > 1)
    throw Error('打印层高应在 0.01–1 mm 之间');
  return value;
}
function heightRecords(project, creation) {
  return [
    ...(project.model?.features || []),
    ...creation.objects.flatMap((o) => [
      o,
      ...(o.paints || []),
      ...(o.surfaceGraph?.outputs || []).flatMap((v) =>
        v.style ? [v.style] : [],
      ),
      ...[
        ...(o.modifiers || []),
        ...Object.values(o.sources || {}).flatMap((s) => s.modifiers || []),
      ].flatMap((m) => m.styles || []),
    ]),
  ];
}
export function syncPrintDimensions(project, creation = project.creation) {
  if (!creation?.printStack) return;
  normalizePrintObjects(creation);
  const h = checkLayerHeight(creation.printStack.layerHeightMM);
  for (const record of heightRecords(project, creation)) {
    if ('zOffsetMM' in record) record.zOffsetMM = 0;
    if (record.heightMM === undefined && record.heightLayers === undefined)
      continue;
    record.heightLayers ??= printCount(record.heightMM, h);
    checkPrintCount(record.heightLayers);
    record.heightMM = printMM(record.heightLayers, h);
    if (record.heightMM > 1000) throw Error('厚度换算后不能超过 1000 mm');
  }
}
export function printEvaluationProject(project) {
  if (!project.creation?.printStack) return project;
  const next = {
    ...project,
    creation: structuredClone(project.creation),
    model: structuredClone(project.model),
  };
  syncPrintDimensions(next);
  return next;
}
export function normalizePrintObjects(creation) {
  const stack = creation.printStack;
  if (!stack) return;
  for (const o of creation.objects) {
    o.printLayerId ??= stack.layers.at(-1)?.id;
    o.heightLayers ??= printCount(o.heightMM, stack.layerHeightMM);
    o.heightMM = printMM(o.heightLayers, stack.layerHeightMM);
    o.zMM = 0;
    o.useObjectZ = true;
    delete o.attachId;
  }
}
export function validatePrintStack(creation) {
  const stack = creation.printStack;
  if (!stack) return;
  checkLayerHeight(stack.layerHeightMM);
  if (
    stack.version !== 1 ||
    !Array.isArray(stack.layers) ||
    !stack.layers.length ||
    stack.layers.length > 100
  )
    throw Error('打印堆叠层无效');
  const ids = new Set();
  for (const layer of stack.layers) {
    if (
      typeof layer.id !== 'string' ||
      !layer.id ||
      ids.has(layer.id) ||
      typeof layer.name !== 'string' ||
      !layer.name.trim() ||
      layer.name.length > 120
    )
      throw Error('堆叠层名称或 ID 无效');
    ids.add(layer.id);
  }
  for (const o of creation.objects) {
    if (o.printLayerId !== undefined && !ids.has(o.printLayerId))
      throw Error('部件引用的堆叠层已不存在');
    if (o.heightLayers !== undefined) checkPrintCount(o.heightLayers);
    for (const record of heightRecords({}, { objects: [o] }))
      if (record.heightLayers !== undefined)
        checkPrintCount(record.heightLayers);
  }
}
export function printCommand(project, creation, action, args) {
  if (action === 'print_enable') {
    if (creation.printStack) throw Error('工程已启用打印分层');
    if (args.confirm !== true) throw Error('转换旧高度与依附关系前需要确认');
    creation.printStack = {
      version: 1,
      layerHeightMM: checkLayerHeight(args.layerHeightMM ?? 0.2),
      layers: [{ id: crypto.randomUUID(), name: '堆叠层 1' }],
    };
    for (const o of creation.objects) {
      o.printLayerId = creation.printStack.layers[0].id;
      o.zMM = 0;
      o.useObjectZ = true;
      delete o.attachId;
    }
    for (const record of heightRecords(project, creation)) {
      if ('zOffsetMM' in record) record.zOffsetMM = 0;
    }
    for (const f of project.model.features) {
      if (f.mode === 'add') {
        f.zMM = 0;
        delete f.attachId;
      }
    }
  } else {
    const stack = creation.printStack;
    if (!stack) throw Error('请先启用打印分层');
    // Capture old counts before a profile change; never re-round scaled mm.
    syncPrintDimensions(project, creation);
    if (action === 'print_settings') {
      stack.layerHeightMM = checkLayerHeight(args.layerHeightMM);
    } else if (action === 'print_layer_add') {
      stack.layers.push({
        id: crypto.randomUUID(),
        name: args.name?.trim() || '堆叠层 ' + (stack.layers.length + 1),
      });
    } else if (action === 'print_assign') {
      if (!stack.layers.some((l) => l.id === args.layerId))
        throw Error('堆叠层不存在');
      if (!Array.isArray(args.objectIds) || !args.objectIds.length)
        throw Error('请先选择部件');
      for (const id of args.objectIds) {
        const object = creation.objects.find((o) => o.id === id);
        if (!object) throw Error('部件已不存在');
        object.printLayerId = args.layerId;
      }
    } else {
      const index = stack.layers.findIndex((l) => l.id === args.layerId);
      if (index < 0) throw Error('堆叠层不存在');
      if (action === 'print_layer_rename') {
        stack.layers[index].name = args.name?.trim();
      } else if (action === 'print_layer_move') {
        if (![1, -1].includes(args.direction))
          throw Error('层顺序调整方向无效');
        const next = index + args.direction;
        if (next < 0 || next >= stack.layers.length) return;
        [stack.layers[index], stack.layers[next]] = [
          stack.layers[next],
          stack.layers[index],
        ];
      } else if (action === 'print_layer_remove') {
        if (stack.layers.length === 1) throw Error('至少保留一个堆叠层');
        if (creation.objects.some((o) => o.printLayerId === args.layerId))
          throw Error('先将该层的部件移到其他层，再删除空层');
        stack.layers.splice(index, 1);
      } else throw Error('未知打印分层操作');
    }
  }
  syncPrintDimensions(project, creation);
}

// All consumers (canvas, mesh, Blender, export) receive these same resolved
// levels. A failed lower stage pauses higher stages instead of dropping them.
export function resolvePrintStack(creation, cells, sourceErrors = []) {
  if (!creation.printStack) return { cells, errors: sourceErrors };
  const { layers, layerHeightMM: h } = creation.printStack;
  const objects = new Map(creation.objects.map((o) => [o.id, o]));
  const errors = [...sourceErrors],
    levels = [],
    byLayer = new Map();
  let bottomLayers = 0,
    blockedBy = null;
  for (const layer of layers) {
    const members = creation.objects.filter((o) => o.printLayerId === layer.id);
    const printable = members.filter((o) => o.printable);
    const failure = errors.find((e) =>
      printable.some((o) => o.id === e.objectId),
    );
    if (failure && !blockedBy) blockedBy = layer.name;
    const own = cells.filter(
      (c) =>
        printable.some((o) => o.id === c.objectId) &&
        c.painted &&
        !c.flatOnly &&
        c.mode !== 'cut' &&
        c.mode !== 'through',
    );
    const heightLayers = Math.max(
      0,
      ...own.map((c) => printCount(c.heightMM, h)),
    );
    const level = {
      id: layer.id,
      name: layer.name,
      objectIds: members.map((o) => o.id),
      state: blockedBy ? 'blocked' : 'ready',
      bottomLayers: blockedBy ? null : bottomLayers,
      heightLayers: blockedBy ? null : heightLayers,
      topLayers: blockedBy ? null : bottomLayers + heightLayers,
      bottomMM: blockedBy ? null : printMM(bottomLayers, h),
      topMM: blockedBy ? null : printMM(bottomLayers + heightLayers, h),
      ...(blockedBy
        ? { message: `等待「${blockedBy}」的构造恢复，暂不计算上层位置` }
        : {}),
    };
    levels.push(level);
    byLayer.set(layer.id, level);
    if (blockedBy)
      for (const o of printable) {
        if (!errors.some((e) => e.objectId === o.id))
          errors.push({
            objectId: o.id,
            kind: 'pipeline',
            stage: 'stack',
            state: 'blocked',
            message: level.message,
          });
      }
    if (!blockedBy) bottomLayers += heightLayers;
  }
  return {
    printLevels: levels,
    errors,
    cells: cells
      .filter((c) => !errors.some((e) => e.objectId === c.objectId))
      .map((c) => {
        const o = objects.get(c.objectId),
          level = byLayer.get(o.printLayerId);
        if (!level || level.state === 'blocked') return null;
        const heightLayers = printCount(c.heightMM, h);
        // Downward cuts keep their tool semantics; additive surfaces share the
        // stage plane. Through cuts continue to span the compiled solid.
        const z = c.mode === 'cut' ? level.topMM : level.bottomMM;
        return {
          ...c,
          printLayerId: level.id,
          heightLayers,
          heightMM: printMM(heightLayers, h),
          zMM: z,
          bottomMM: z,
        };
      })
      .filter(Boolean)
      .sort(
        (a, b) =>
          layers.findIndex((l) => l.id === a.printLayerId) -
            layers.findIndex((l) => l.id === b.printLayerId) ||
          a.heightMM - b.heightMM,
      ),
  };
}
