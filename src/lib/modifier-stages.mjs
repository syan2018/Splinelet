// Shared evaluation/UI contract: each operator declares its geometry domain.
export const modifierStages = {
  curve_mirror: { name: '曲线镜像', input: 'curves', output: 'curves' },
  curve_array: { name: '曲线旋转阵列', input: 'curves', output: 'curves' },
  fill: { name: '闭合构面', input: 'curves', output: 'surfaces' },
  boolean: { name: '布尔', input: 'surfaces', output: 'surfaces' },
  split: { name: '分区', input: 'surfaces', output: 'surfaces' },
  offset: { name: '轮廓偏移', input: 'surfaces', output: 'surfaces' },
  radial_array: { name: '面旋转阵列', input: 'surfaces', output: 'surfaces' },
};
export const usesCurvePipeline = (object) =>
  (object.modifiers || []).some(
    (m) => modifierStages[m.type]?.input === 'curves',
  );
export function objectPipeline(object) {
  const curves = usesCurvePipeline(object);
  return [
    {
      id: 'source',
      name: curves ? '源贝塞尔曲线' : '来源构面',
      input: 'paths',
      output: curves ? 'curves' : 'surfaces',
      enabled: true,
    },
    ...(object.modifiers || []).map((m) => ({
      ...modifierStages[m.type],
      id: m.id,
      name: m.name,
      enabled: m.enabled,
    })),
    {
      id: 'style',
      name: '颜色与厚度',
      input: 'surfaces',
      output: 'styled-surfaces',
      enabled: true,
    },
    {
      id: 'solid',
      name: '分层定位与实体输出',
      input: 'styled-surfaces',
      output: 'solid',
      enabled: true,
    },
  ];
}
