import {
  defaultConstructionRegistry,
  declarativeConstructionRegistry,
} from '../../construction/document-evaluation.mjs';
import {
  buildDependencyGraph,
  topologicalComponents,
} from '../../construction/dependencies.mjs';
import { effectiveNodeState } from '../../scene/hierarchy.mjs';

/** Replace one declared input, or supply the next missing required input.
 * Geometry failures remain inspectable;
 * this command never changes a selected scope or guesses new subregions. */
export function createRebindModifierInputCommand(request) {
  const change = structuredClone(request);
  return (document) => {
    const { ownerNodeId, operatorId, input, index, reference } = change;
    const node = document.nodes[ownerNodeId];
    const program = document.programs[node?.programId];
    const operator = program?.operators[operatorId];
    if (
      node?.kind !== 'shape' ||
      program.ownerNodeId !== ownerNodeId ||
      !operator
    )
      throw Error('待修复步骤不属于指定部件');
    if (effectiveNodeState(document, ownerNodeId).locked)
      throw Error('待修复部件已锁定');
    if (operator.authoring) throw Error('请先完成绘制');
    const registry =
      document.version === 5
        ? declarativeConstructionRegistry
        : defaultConstructionRegistry;
    const specification = registry.get(operator.type);
    const definition = specification?.inputPorts?.[input];
    const refs = operator.inputs[input] || [];
    const missingRequired =
      index === refs.length && refs.length < (definition?.min || 0);
    if (
      !definition ||
      !Array.isArray(refs) ||
      !Number.isInteger(index) ||
      index < 0 ||
      (index >= refs.length && !missingRequired)
    )
      throw Error('待修复输入端口或位置不存在');
    if (reference?.kind !== 'port' || reference.domain !== definition.domain)
      throw Error('替代输入的类型不匹配');
    const producerNode = document.nodes[reference.ownerNodeId];
    const producer =
      document.programs[producerNode?.programId]?.operators[
        reference.operatorId
      ];
    const output = registry.get(producer?.type)?.outputPorts?.[reference.port];
    if (
      producerNode?.kind !== 'shape' ||
      !producer ||
      !output ||
      output.domain !== definition.domain
    )
      throw Error('替代输入的生产者或输出端口不存在');
    if (producer.authoring) throw Error('替代输入尚未完成绘制');
    if (
      !['local-result', 'world-result'].includes(reference.space) ||
      !Array.isArray(reference.transform) ||
      reference.transform.length !== 6 ||
      !reference.transform.every(Number.isFinite)
    )
      throw Error('替代输入必须声明坐标空间和有限变换');
    if (
      reference.space === 'local-result' &&
      reference.ownerNodeId !== ownerNodeId
    )
      throw Error('跨部件重绑必须明确使用世界坐标输入');
    const previousCycles = new Set(
      topologicalComponents(buildDependencyGraph(document, registry)).cycles,
    );
    operator.inputs[input] = [...refs];
    operator.inputs[input][index] = structuredClone(reference);
    const graph = buildDependencyGraph(document, registry);
    if (
      topologicalComponents(graph).cycles.some((id) => !previousCycles.has(id))
    )
      throw Error('重新指定输入会形成依赖环');
    return {
      document,
      changedRefs: [
        { kind: 'node', id: ownerNodeId },
        { kind: 'program', id: program.id },
      ],
    };
  };
}
