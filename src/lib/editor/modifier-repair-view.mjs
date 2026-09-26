import {
  defaultConstructionRegistry,
  declarativeConstructionRegistry,
} from '../construction/document-evaluation.mjs';
import { buildDependencyGraph } from '../construction/dependencies.mjs';

const clone = (value) => structuredClone(value);
const operatorLabels = {
  source: '源线条',
  'curve-collect': '线条汇集',
  'curve-filter': '线条筛选',
  'region-collect': '区域汇集',
  'curve-mirror': '曲线镜像',
  'curve-array': '曲线阵列',
  'region-array': '区域阵列',
  'region-reference': '区域引用',
  'region-outline': '区域轮廓',
  'region-select': '区域选择',
  'curve-endpoint-attach': '曲线端点接边',
  'region-snapshot-source': '固定区域快照',
  fill: '闭合构面',
  join: '连接边界',
  partition: '分区',
  boolean: '布尔运算',
  stroke: '笔画构面',
  offset: '轮廓偏移',
};
export function projectModifierInputs(document, ownerNodeId, operatorId) {
  const operator =
    document.programs[document.nodes[ownerNodeId]?.programId]?.operators[
      operatorId
    ];
  if (!operator) throw Error('修改器不属于指定部件');
  const registry =
    document.version === 5
      ? declarativeConstructionRegistry
      : defaultConstructionRegistry;
  const spec = registry.get(operator.type);
  const graph = buildDependencyGraph(document, registry);
  const excluded = new Set([`operator:${operatorId}`]);
  const pending = [...excluded];
  while (pending.length)
    for (const id of graph.dependents.get(pending.pop()) || [])
      if (!excluded.has(id)) {
        excluded.add(id);
        pending.push(id);
      }
  const candidates = Object.values(document.programs).flatMap((program) =>
    Object.values(program.operators)
      .filter((item) => !item.authoring && !excluded.has(`operator:${item.id}`))
      .flatMap((item, index) =>
        Object.entries(registry.get(item.type)?.outputPorts || {}).map(
          ([port, definition]) => ({
            label: `${document.nodes[program.ownerNodeId]?.name || program.ownerNodeId} / ${index + 1}. ${operatorLabels[item.type] || item.name}${item.name && item.name !== item.type && item.name !== 'source' ? ` · ${item.name}` : ''} / ${port === 'curves' ? '曲线' : '区域'}`,
            reference: {
              kind: 'port',
              ownerNodeId: program.ownerNodeId,
              operatorId: item.id,
              port,
              domain: definition.domain,
            },
          }),
        ),
      ),
  );
  return {
    inputs: [
      ...new Set([
        ...Object.keys(spec?.inputPorts || {}),
        ...Object.keys(operator.inputs),
      ]),
    ].flatMap((input) => {
      const refs = operator.inputs[input] || [];
      const slots =
        refs.length < (spec?.inputPorts?.[input]?.min || 0)
          ? [...refs, null]
          : refs;
      return slots.map((reference, index) => ({
        input,
        index,
        reference: clone(reference),
        label:
          candidates.find(
            (item) =>
              item.reference.operatorId === reference?.operatorId &&
              item.reference.ownerNodeId === reference?.ownerNodeId &&
              item.reference.port === reference?.port,
          )?.label ||
          (!reference
            ? '缺少输入'
            : reference.kind === 'sketch'
              ? '源线条'
              : '原输入已不可用'),
        options:
          !reference || reference.kind === 'port'
            ? candidates
                .filter(
                  (item) =>
                    item.reference.domain ===
                      spec?.inputPorts?.[input]?.domain &&
                    ((reference?.space || 'local-result') !== 'local-result' ||
                      item.reference.ownerNodeId === ownerNodeId),
                )
                .map((item) => ({
                  label: item.label,
                  reference: {
                    ...item.reference,
                    space: reference?.space || 'local-result',
                    transform: clone(
                      reference?.transform || [1, 0, 0, 1, 0, 0],
                    ),
                  },
                }))
            : [],
      }));
    }),
    outputs: Object.keys(spec?.outputPorts || {}),
  };
}
