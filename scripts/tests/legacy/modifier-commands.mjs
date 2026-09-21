import { targetForCell } from '../../../src/lib/modifier-schema.mjs';

export function modifierCommand(project, creation, action, args, scene) {
  const object = creation.objects.find((o) => o.id === args.objectId);
  if (!object) throw Error('请选择一个部件');
  const stack = args.sourceFeatureId
    ? object.sources?.[args.sourceFeatureId]?.modifiers
    : object.modifiers;
  if (!stack) throw Error('修改器来源已不存在');
  const index = stack.findIndex((m) => m.id === args.modifierId),
    current = stack[index];
  const targets = () =>
    args.targets ||
    (args.cellKeys?.length
      ? {
          kind: 'selected',
          refs: args.cellKeys.map((key) => {
            const cell = scene?.cells.find(
              (c) => c.key === key && c.objectId === object.id,
            );
            if (!cell) throw Error('选区已变化，请重新选择作用面');
            return targetForCell(cell);
          }),
        }
      : { kind: 'all' });
  if (action === 'modifier_add') {
    stack.push({
      id: crypto.randomUUID(),
      name:
        args.name ||
        {
          boolean: '布尔',
          split: '分区',
          offset: '轮廓偏移',
          radial_array: '旋转阵列',
          curve_mirror: '曲线镜像',
          curve_array: '曲线旋转阵列',
          fill: '闭合构面',
        }[args.type],
      type: args.type,
      enabled: true,
      targets: targets(),
      ...(args.type === 'boolean'
        ? { operation: args.operation || 'difference' }
        : {}),
      ...(args.type === 'offset'
        ? { distanceMM: args.distanceMM ?? 0.5 }
        : ['radial_array', 'curve_array'].includes(args.type)
          ? {
              count: args.count ?? 4,
              angleDeg: args.angleDeg ?? 90,
              centerMM: structuredClone(args.centerMM ?? { x: 0, y: 0 }),
            }
          : args.type === 'curve_mirror'
            ? {
                angleDeg: args.angleDeg ?? 90,
                centerMM: structuredClone(args.centerMM ?? { x: 0, y: 0 }),
              }
            : args.type === 'fill'
              ? { joinMM: args.joinMM ?? 0.001 }
              : { input: structuredClone(args.input) }),
      ...(args.type === 'split' ? { joinMM: args.joinMM ?? 0 } : {}),
    });
    return;
  }
  if (!current) throw Error('修改器已不存在');
  if (action === 'modifier_update') {
    for (const [key, value] of Object.entries(args.changes || {})) {
      if (
        ![
          'name',
          'enabled',
          'operation',
          'input',
          'targets',
          'distanceMM',
          'joinMM',
          'count',
          'angleDeg',
          'centerMM',
        ].includes(key)
      )
        throw Error('修改器参数不支持修改');
      current[key] = structuredClone(value);
    }
    if (args.cellKeys || args.targets) current.targets = targets();
    if (args.cellKeys || args.targets || args.changes?.targets)
      delete current.outputContract;
    if (
      current.type === 'radial_array' &&
      ['count', 'angleDeg', 'centerMM'].some((k) => k in (args.changes || {}))
    )
      delete current.outputContract;
  } else if (action === 'modifier_truncate') {
    if (args.confirm !== true)
      throw Error('移除此步及下游会解除相关修改器和输出样式，请确认');
    for (const m of stack.splice(index))
      if (m.rolePathId) object.roles[m.rolePathId] = 'guide';
  } else if (action === 'modifier_remove') stack.splice(index, 1);
  else if (action === 'modifier_move') {
    delete current.outputContract;
    stack.splice(index, 1);
    const at =
      args.beforeId === null
        ? stack.length
        : args.beforeId
          ? stack.findIndex((m) => m.id === args.beforeId)
          : Math.max(0, Math.min(stack.length, index + args.direction));
    if (at < 0 || !Number.isInteger(at)) throw Error('修改器排序目标无效');
    stack.splice(at, 0, current);
  } else throw Error('未知修改器操作');
  if (
    current.rolePathId &&
    (action === 'modifier_remove' ||
      !(
        (current.type === 'boolean' && current.operation === 'difference') ||
        current.type === 'split'
      ) ||
      current.input.kind !== 'path' ||
      current.input.id !== current.rolePathId)
  ) {
    object.roles[current.rolePathId] = 'guide';
    delete current.rolePathId;
  }
}
