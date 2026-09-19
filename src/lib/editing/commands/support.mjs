import { validateDocument } from '../../document/schema.mjs';
import { effectiveNodeState } from '../../scene/hierarchy.mjs';
import { evaluateProgram } from '../../construction/document-evaluation.mjs';
import { createCommandIdAllocator } from '../command-ids.mjs';
import { partForRelief } from '../../manufacturing/parts.mjs';
import {
  printCount,
  requestedPrintCount,
  printMM,
} from '../../print-stack.mjs';

const nodeRef = (id) => ({ kind: 'node', id });
const port = (ownerNodeId, operatorId) => ({
  kind: 'port',
  ownerNodeId,
  operatorId,
  port: 'regions',
  domain: 'regions',
});
const input = (ref, space = 'local-result') => ({
  ...ref,
  space,
  transform: [1, 0, 0, 1, 0, 0],
});
const defaultRelief = () => ({
  enabled: false,
  thickness: { kind: 'mm', value: 1 },
  mode: 'add',
  placement: { kind: 'free', zMM: 0 },
});

/** Live support geometry depends on published source regions; its Z does not.
 * Source XY geometry, appearance and thickness remain authoritative in place.
 */
export function createSupportCommand(request) {
  const action = structuredClone(request);
  return (document, { idFactory }) => {
    validateDocument(document);
    if (
      action?.kind !== 'create-support' ||
      Object.keys(action).some(
        (key) =>
          ![
            'kind',
            'nodeIds',
            'offsetMM',
            'heightMM',
            'heightLayers',
            'swatchId',
            'stack',
          ].includes(key),
      )
    )
      throw Error('承托命令参数无效');
    if (
      !Array.isArray(action.nodeIds) ||
      !action.nodeIds.length ||
      action.nodeIds.some((id) => typeof id !== 'string')
    )
      throw Error('先选择需要承托的部件');
    const selected = [...new Set(action.nodeIds)];
    const sourceParts = new Set();
    const sources = selected.map((id) => {
      const node = document.nodes[id];
      if (node?.kind !== 'shape') throw Error('承托来源必须是部件');
      if (effectiveNodeState(document, id).locked) throw Error('部件已锁定');
      const source = document.programs[node.programId].outputs.regions;
      const regions = evaluateProgram(document, id).regions;
      if (!source || !['ready', 'empty'].includes(regions.status))
        throw Error('承托来源区域不可用');
      for (const region of regions.value.regions)
        sourceParts.add(partForRelief(document, region));
      return source;
    });
    let swatchId =
      action.swatchId ?? Object.keys(document.appearances.swatches)[0];
    if (swatchId !== undefined && !document.appearances.swatches[swatchId])
      throw Error('承托颜色不存在');
    const offsetMM = action.offsetMM ?? 1;
    const layered = document.manufacturing.layerOrder.length > 0;
    if (!layered && action.stack !== false && sourceParts.size > 1)
      throw Error('顶面依附的承托来源需要属于同一制造零件');
    if (action.stack !== undefined && typeof action.stack !== 'boolean')
      throw Error('stack 必须为布尔值');
    if (action.heightMM !== undefined && action.heightLayers !== undefined)
      throw Error('厚度只能指定 mm 或打印层数');
    if (!layered && action.heightLayers !== undefined)
      throw Error('请先启用打印分层');
    const thickness = layered
      ? {
          kind: 'layers',
          count: requestedPrintCount(
            action.heightLayers !== undefined || action.heightMM !== undefined
              ? action
              : {
                  heightLayers: printCount(
                    2,
                    document.manufacturing.layerHeightMM,
                  ),
                },
            document.manufacturing.layerHeightMM,
          ),
        }
      : { kind: 'mm', value: action.heightMM ?? 2 };
    const height = layered
      ? printMM(thickness.count, document.manufacturing.layerHeightMM)
      : thickness.value;
    if (
      !Number.isFinite(offsetMM) ||
      offsetMM < 0 ||
      offsetMM > 20 ||
      !Number.isFinite(height) ||
      height < (layered ? document.manufacturing.layerHeightMM : 0.1) ||
      height > 1000
    )
      throw Error('底板边距或厚度无效');

    const next = structuredClone(document),
      allocate = createCommandIdAllocator(next, idFactory);
    const id = allocate(),
      programId = allocate();
    if (swatchId === undefined) {
      swatchId = allocate();
      next.appearances.swatches[swatchId] = {
        id: swatchId,
        name: '金色',
        color: '#b99a60',
      };
    }
    next.nodes[id] = {
      id,
      programId,
      kind: 'shape',
      name: '底板',
      parentId: null,
      order:
        Math.min(
          0,
          ...Object.values(next.nodes)
            .filter((node) => node.parentId === null)
            .map((node) => node.order),
        ) - 1,
      pose: { translationMM: [0, 0], rotationRad: 0 },
      visible: true,
      locked: false,
    };
    const program = {
      id: programId,
      ownerNodeId: id,
      operators: {},
      outputs: {},
    };
    next.programs[programId] = program;
    const add = (type, name, inputs, params = {}) => {
      const operatorId = allocate();
      program.operators[operatorId] = {
        id: operatorId,
        type,
        name,
        enabled: true,
        inputs,
        params,
      };
      return port(id, operatorId);
    };
    let outline;
    sources.forEach((source, i) => {
      const shape = add(
        'region-outline',
        `引用 ${document.nodes[selected[i]].name}`,
        { input: [input(source, 'world-result')] },
      );
      outline = outline
        ? add(
            'boolean',
            '合并外形',
            { input: [input(outline)], operand: [input(shape)] },
            { operation: 'union', scope: { kind: 'all' } },
          )
        : shape;
    });
    const expanded = add(
      'offset',
      '底板边距',
      { input: [input(outline)] },
      { distanceMM: offsetMM, scope: { kind: 'all' } },
    );
    program.outputs.regions = expanded;
    const result = evaluateProgram(next, id).regions;
    if (result.status !== 'ready' || !result.value.regions.length)
      throw Error('底板没有有效面积');
    let placement = { kind: 'free', zMM: 0 };
    const changedRefs = [nodeRef(id), ...selected.map(nodeRef)];
    if (layered) {
      const layerId = allocate();
      next.manufacturing.layers[layerId] = { id: layerId, name: '底板层' };
      next.manufacturing.layerOrder.unshift(layerId);
      placement = { kind: 'layer', layerId, offsetMM: 0 };
    } else if (action.stack !== false) {
      const attach = { kind: 'attached', target: nodeRef(id), offsetMM: 0 };
      for (const sourceId of selected)
        next.reliefDefinitions.defaults[sourceId] = {
          ...defaultRelief(),
          ...next.reliefDefinitions.defaults[sourceId],
          placement: structuredClone(attach),
        };
      for (const override of Object.values(next.reliefDefinitions.overrides))
        if (selected.includes(override.target.ownerNodeId))
          override.value.placement = structuredClone(attach);
    }
    next.appearances.defaults[id] = { swatchId };
    if (
      sourceParts.size === 1 &&
      !sourceParts.has(next.manufacturing.defaultPartId)
    ) {
      const assignmentId = allocate();
      next.manufacturing.assignments[assignmentId] = {
        id: assignmentId,
        target: nodeRef(id),
        partId: [...sourceParts][0],
      };
    }
    next.reliefDefinitions.defaults[id] = {
      enabled: true,
      thickness,
      mode: 'add',
      placement,
    };
    validateDocument(next);
    return {
      document: next,
      changedRefs,
      selectionIntent: {
        scope: 'objects',
        entityRefs: [nodeRef(id)],
        activeRef: nodeRef(id),
      },
    };
  };
}
