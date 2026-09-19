import {
  childrenOf,
  effectiveNodeState,
  groupNodes,
  transformNodes,
} from '../../scene/hierarchy.mjs';
import {
  inverseTransform,
  transformPoint,
  worldMatrix,
} from '../../scene/transforms.mjs';
import { ungroupNodes } from '../../scene/operations.mjs';
import { createSourceCommand, SOURCE_ACTIONS } from './source.mjs';
import { evaluateProgram } from '../../construction/document-evaluation.mjs';
import { sameOutputRef } from '../../relief/appearance.mjs';
import { firstPaintPlan } from '../../relief/assignments.mjs';
import { createRegionCommand } from './regions.mjs';
import { createAdvancedCommand, ADVANCED_ACTIONS } from './advanced.mjs';
import { createSourceTransferCommand } from './source-transfer.mjs';
import { createResourceCommand, RESOURCE_ACTIONS } from './resources.mjs';
import { extendPath } from '../../geometry/extend-path.mjs';
import { nextSourcePathOrder } from '../../geometry/source-order.mjs';
import {
  createPathMetadataCommand,
  PATH_METADATA_ACTIONS,
} from './path-metadata.mjs';
import {
  createPathDeletionCommand,
  PATH_DELETION_ACTIONS,
} from './path-deletion.mjs';
import {
  createPathGeometryCommand,
  PATH_GEOMETRY_ACTIONS,
} from './path-geometry.mjs';
import {
  createPathNodeDeletionCommand,
  PATH_NODE_DELETION_ACTIONS,
} from './path-node-deletion.mjs';
import { PATH_MERGE_ACTIONS } from './path-merge.mjs';
import { createPathMergeAuthoringCommand } from './path-merge-authoring.mjs';
import {
  createSourceOrganizationCommand,
  SOURCE_ORGANIZATION_ACTIONS,
} from './source-organization.mjs';

const identity = () => [1, 0, 0, 1, 0, 0];
const nodeRef = (id) => ({ kind: 'node', id });
const vec = (value) =>
  Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
const writable = (document, id) => {
  if (!document.nodes[id]) throw Error('部件不存在');
  if (effectiveNodeState(document, id).locked) throw Error('部件已锁定');
};
const port = (ownerNodeId, operatorId, domain) => ({
  kind: 'port',
  ownerNodeId,
  operatorId,
  port: domain,
  domain,
});
const operator = (id, type, inputs, params = {}) => ({
  id,
  type,
  name: type,
  enabled: true,
  inputs,
  params,
});
function createShape(document, action, idFactory) {
  const id = idFactory(),
    programId = idFactory(),
    parentId = action.parentId ?? null;
  if (parentId !== null) {
    writable(document, parentId);
    if (document.nodes[parentId].kind !== 'group') throw Error('父级必须是组');
  }
  document.nodes[id] = {
    id,
    programId,
    kind: 'shape',
    name: action.name || '部件',
    parentId,
    order: childrenOf(document, parentId).length,
    pose: { translationMM: [0, 0], rotationRad: 0 },
    visible: true,
    locked: false,
  };
  document.programs[programId] = {
    id: programId,
    ownerNodeId: id,
    operators: {},
    outputs: {},
  };
  return id;
}
// The ordinary drawing command only extends a plain Source / Fill program.
// Complex programs require an explicit authoring target, never silent replacement.
function basicProgram(document, ownerNodeId) {
  writable(document, ownerNodeId);
  const node = document.nodes[ownerNodeId];
  if (node.kind !== 'shape') throw Error('线条必须属于部件');
  const program = document.programs[node.programId];
  const all = Object.values(program.operators);
  const source = program.operators[program.outputs.curves?.operatorId];
  const fill = program.operators[program.outputs.regions?.operatorId];
  const fillSource =
    fill && program.operators[fill.inputs.input?.[0]?.operatorId];
  const known = new Set([source, fill, fillSource].filter(Boolean));
  if (
    all.some((item) => !known.has(item)) ||
    (source && (!source.enabled || source.type !== 'source')) ||
    (fill &&
      (!fill.enabled ||
        fill.inputs.input?.length !== 1 ||
        fill.type !== 'fill' ||
        fillSource?.type !== 'source' ||
        !fillSource.enabled ||
        program.outputs.regions?.operatorId !== fill.id))
  )
    throw Error('高级构造需要明确指定线条来源，不能用普通绘制替换');
  return { program, source, fill };
}
function ensureFill(document, program, source, ownerNodeId, idFactory) {
  const fill = program.operators[program.outputs.regions?.operatorId];
  let fillSource = fill && program.operators[fill.inputs.input[0].operatorId];
  if (!fillSource || fillSource.id === source.id) {
    fillSource = operator(idFactory(), 'source', { paths: [] });
    program.operators[fillSource.id] = fillSource;
  }
  // Save explicit closed-path membership; unrelated open drawing cannot break Fill.
  fillSource.inputs.paths = source.inputs.paths
    .map((input) => {
      const sketch = document.sketches[input.sketchId];
      const pathIds = (input.pathIds || Object.keys(sketch.paths)).filter(
        (id) => {
          const uses = sketch.paths[id].edges;
          if (!uses.length) return false;
          const first = uses[0],
            last = uses.at(-1);
          return (
            sketch.edges[first.edgeId][
              first.reversed ? 'endVertexId' : 'startVertexId'
            ] ===
            sketch.edges[last.edgeId][
              last.reversed ? 'startVertexId' : 'endVertexId'
            ]
          );
        },
      );
      return { ...input, pathIds };
    })
    .filter((input) => input.pathIds.length);
  const id = fill?.id || idFactory();
  program.operators[id] = operator(
    id,
    'fill',
    {
      input: [
        {
          ...port(ownerNodeId, fillSource.id, 'curves'),
          space: 'local-result',
          transform: identity(),
        },
      ],
    },
    { rule: 'even-odd' },
  );
  program.outputs.regions = port(ownerNodeId, id, 'regions');
}
function drawPath(document, action, idFactory) {
  if (
    !Array.isArray(action.points) ||
    action.points.length <
      (action.kind === 'start-path' ? 1 : action.closed ? 3 : 2) ||
    !action.points.every(vec)
  )
    throw Error('线条需要有限的世界坐标点');
  const ownerNodeId =
    action.ownerNodeId || createShape(document, action, idFactory);
  writable(document, ownerNodeId);
  const { program, source: existing } = action.auxiliary
    ? {}
    : basicProgram(document, ownerNodeId);
  const matrix = inverseTransform(worldMatrix(document, ownerNodeId));
  const points = action.points.map((p) => transformPoint(matrix, p));
  const count = action.closed ? points.length : points.length - 1;
  if (
    action.cubics &&
    (!Array.isArray(action.cubics) ||
      action.cubics.length !== count ||
      !action.cubics.every(
        (c) => Array.isArray(c) && c.length === 4 && c.every(vec),
      ))
  )
    throw Error('曲线段与路径点不匹配');
  const sketchId = idFactory(),
    pathId = idFactory();
  const sketch = {
    id: sketchId,
    ownerNodeId,
    vertices: {},
    edges: {},
    paths: {},
  };
  const vertices = points.map((value) => {
    const id = idFactory();
    sketch.vertices[id] = { id, position: { kind: 'free', value } };
    return id;
  });
  const uses = [];
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % points.length,
      id = idFactory();
    const cubic = action.cubics?.[i]?.map((p) => transformPoint(matrix, p));
    if (
      cubic &&
      (Math.hypot(...cubic[0].map((x, k) => x - points[i][k])) > 1e-9 ||
        Math.hypot(...cubic[3].map((x, k) => x - points[j][k])) > 1e-9)
    )
      throw Error('曲线端点必须与路径拓扑一致');
    sketch.edges[id] = {
      id,
      startVertexId: vertices[i],
      endVertexId: vertices[j],
      startHandle: {
        kind: 'free',
        vector: cubic ? cubic[1].map((v, k) => v - points[i][k]) : [0, 0],
      },
      endHandle: {
        kind: 'free',
        vector: cubic ? cubic[2].map((v, k) => v - points[j][k]) : [0, 0],
      },
    };
    uses.push({ edgeId: id, reversed: false });
  }
  sketch.paths[pathId] = {
    id: pathId,
    name: action.name || '线条',
    order: nextSourcePathOrder(document),
    visible: true,
    edges: uses,
    ...(uses.length === 0 ? { startVertexId: vertices[0] } : {}),
  };
  document.sketches[sketchId] = sketch;
  if (action.auxiliary)
    return { document, changedRefs: [{ kind: 'path', sketchId, id: pathId }] };
  const source = existing || operator(idFactory(), 'source', { paths: [] });
  source.inputs.paths.push({ kind: 'sketch', sketchId, pathIds: [pathId] });
  program.operators[source.id] = source;
  program.outputs.curves = port(ownerNodeId, source.id, 'curves');
  if (action.closed || program.outputs.regions)
    ensureFill(document, program, source, ownerNodeId, idFactory);
  return {
    document,
    changedRefs: [nodeRef(ownerNodeId), { kind: 'path', sketchId, id: pathId }],
    selectionIntent: {
      scope: 'objects',
      entityRefs: [nodeRef(ownerNodeId)],
      activeRef: nodeRef(ownerNodeId),
    },
  };
}
function currentTarget(document, target) {
  if (target?.kind !== 'output') throw Error('请指定当前区域');
  writable(document, target.ownerNodeId);
  const stage = evaluateProgram(document, target.ownerNodeId).regions;
  if (
    stage.status !== 'ready' ||
    !stage.value.regions.some((region) => sameOutputRef(region.ref, target))
  )
    throw Error('区域已失效，请重新选择当前区域');
}
function assign(record, target, value, idFactory) {
  const matches = Object.values(record).filter((item) =>
    sameOutputRef(item.target, target),
  );
  if (matches.length > 1) throw Error('区域存在冲突赋值，需先解决');
  const id = matches[0]?.id || idFactory();
  record[id] = {
    id,
    target: structuredClone(target),
    value: { ...matches[0]?.value, ...value },
  };
}
/** Returns a synchronous T12 transaction. All UI/API entry points share it. */
export function createAuthoringCommand(action) {
  const request = structuredClone(action);
  return (document, { idFactory }) => {
    const action = request;
    if (action.kind === 'transfer-source')
      return createSourceTransferCommand(action)(document, { idFactory });
    if (RESOURCE_ACTIONS.includes(action.kind))
      return createResourceCommand(action)(document, { idFactory });
    if (action.kind === 'set-print-settings') {
      if (action.layerHeightMM !== undefined) {
        if (!Number.isFinite(action.layerHeightMM) || action.layerHeightMM <= 0)
          throw Error('打印层高必须是正数');
        document.manufacturing.layerHeightMM = action.layerHeightMM;
      }
      if (action.layerOrder !== undefined) {
        const ids = Object.keys(document.manufacturing.layers);
        if (
          !Array.isArray(action.layerOrder) ||
          action.layerOrder.length !== ids.length ||
          new Set(action.layerOrder).size !== ids.length ||
          action.layerOrder.some((id) => !ids.includes(id))
        )
          throw Error('层顺序必须完整且不重复');
        document.manufacturing.layerOrder = [...action.layerOrder];
      }
      return { document, changedRefs: [] };
    }
    if (action.kind === 'clear-region-paint') {
      currentTarget(document, action.target);
      for (const [id, item] of Object.entries(document.appearances.overrides))
        if (sameOutputRef(item.target, action.target))
          delete document.appearances.overrides[id];
      assign(
        document.reliefDefinitions.overrides,
        action.target,
        { enabled: false },
        idFactory,
      );
      return { document, changedRefs: [action.target] };
    }
    if (action.kind === 'set-relief') {
      currentTarget(document, action.target);
      assign(
        document.reliefDefinitions.overrides,
        action.target,
        action.value,
        idFactory,
      );
      return { document, changedRefs: [action.target] };
    }
    if (Object.values(ADVANCED_ACTIONS).includes(action.kind))
      return createAdvancedCommand(action)(document, { idFactory });
    if (SOURCE_ACTIONS.includes(action.kind))
      return createSourceCommand(action)(document, { idFactory });
    if (PATH_METADATA_ACTIONS.includes(action.kind))
      return createPathMetadataCommand(action)(document);
    if (PATH_DELETION_ACTIONS.includes(action.kind))
      return createPathDeletionCommand(action)(document);
    if (PATH_GEOMETRY_ACTIONS.includes(action.kind))
      return createPathGeometryCommand(action)(document);
    if (PATH_NODE_DELETION_ACTIONS.includes(action.kind))
      return createPathNodeDeletionCommand(action)(document, { idFactory });
    if (PATH_MERGE_ACTIONS.includes(action.kind))
      return createPathMergeAuthoringCommand(action)(document, { idFactory });
    if (SOURCE_ORGANIZATION_ACTIONS.includes(action.kind))
      return createSourceOrganizationCommand(action)(document, { idFactory });
    if (action.kind === 'set-node') {
      const node = document.nodes[action.nodeId];
      if (!node) throw Error('部件不存在');
      if (
        Object.keys(action.value || {}).some(
          (key) => !['name', 'visible', 'locked'].includes(key),
        )
      )
        throw Error('只能修改名称、显示与锁定');
      if (Object.hasOwn(action.value || {}, 'name'))
        writable(document, node.id);
      Object.assign(node, action.value);
      return { document, changedRefs: [nodeRef(node.id)] };
    }
    if (['partition-regions', 'cut-hole'].includes(action.kind))
      return createRegionCommand(action)(document, { idFactory });
    if (['draw-partition', 'draw-hole'].includes(action.kind)) {
      if (!action.targets?.length) throw Error('请先选择要修改的区域');
      if (action.kind === 'draw-hole' && !action.closed)
        throw Error('孔需要明确闭合的轮廓');
      const drawn = drawPath(
        document,
        {
          ...action,
          auxiliary: true,
          ownerNodeId: action.targets[0].ownerNodeId,
        },
        idFactory,
      );
      const ref = drawn.changedRefs[0];
      const result = createRegionCommand({
        kind: action.kind === 'draw-hole' ? 'cut-hole' : 'partition-regions',
        targets: action.targets,
        cutter: { kind: 'sketch', sketchId: ref.sketchId, pathIds: [ref.id] },
      })(drawn.document, { idFactory });
      return {
        ...result,
        selectionIntent: {
          scope: 'regions',
          entityRefs: result.changedRefs,
          activeRef: result.changedRefs[0] || null,
        },
      };
    }
    if (action.kind === 'draw-path')
      return drawPath(document, action, idFactory);
    if (action.kind === 'start-path')
      return drawPath(
        document,
        { ...action, points: [action.point], closed: false, cubics: [] },
        idFactory,
      );
    if (action.kind === 'extend-path') {
      const sketch = document.sketches[action.sketchId];
      if (!sketch) throw Error('线条来源不存在');
      writable(document, sketch.ownerNodeId);
      return extendPath(document, { ...action, close: false }, { idFactory });
    }
    if (action.kind === 'create-shape') {
      const id = createShape(document, action, idFactory);
      return {
        document,
        changedRefs: [nodeRef(id)],
        selectionIntent: {
          scope: 'objects',
          entityRefs: [nodeRef(id)],
          activeRef: nodeRef(id),
        },
      };
    }
    if (action.kind === 'move-nodes') {
      if (!vec(action.deltaMM)) throw Error('移动量必须是有限 Vec2');
      action.nodeIds.forEach((id) => writable(document, id));
      return {
        document: transformNodes(document, action.nodeIds, [
          1,
          0,
          0,
          1,
          ...action.deltaMM,
        ]),
        changedRefs: action.nodeIds.map(nodeRef),
      };
    }
    if (action.kind === 'close-path') {
      const sketch = document.sketches[action.sketchId],
        path = sketch?.paths[action.pathId];
      if (!path?.edges.length) throw Error('路径不存在或为空');
      const { program, source } = basicProgram(document, sketch.ownerNodeId);
      if (
        !source?.inputs.paths.some(
          (input) =>
            input.sketchId === sketch.id &&
            (!input.pathIds || input.pathIds.includes(path.id)),
        )
      )
        throw Error('路径不属于当前来源');
      const first = path.edges[0],
        last = path.edges.at(-1);
      const start =
        sketch.edges[first.edgeId][
          first.reversed ? 'endVertexId' : 'startVertexId'
        ];
      const end =
        sketch.edges[last.edgeId][
          last.reversed ? 'startVertexId' : 'endVertexId'
        ];
      const extended =
        start !== end
          ? extendPath(document, { ...action, close: true }, { idFactory })
          : {
              changedRefs: [{ kind: 'path', sketchId: sketch.id, id: path.id }],
            };
      ensureFill(document, program, source, sketch.ownerNodeId, idFactory);
      return {
        document,
        changedRefs: extended.changedRefs,
      };
    }
    if (action.kind === 'paint-region' || action.kind === 'set-thickness') {
      currentTarget(document, action.target);
      if (action.kind === 'paint-region') {
        if (!document.appearances.swatches[action.swatchId])
          throw Error('颜色不存在');
        const plan = firstPaintPlan(action);
        const painted = Object.values(document.appearances.overrides).some(
          (item) => sameOutputRef(item.target, action.target),
        );
        const previous = Object.values(
          document.reliefDefinitions.overrides,
        ).find((item) => sameOutputRef(item.target, action.target));
        assign(
          document.appearances.overrides,
          action.target,
          plan.appearance.value,
          idFactory,
        );
        // Recoloring must retain thickness, placement and mode already authored.
        if (!painted)
          assign(
            document.reliefDefinitions.overrides,
            action.target,
            {
              ...plan.relief.value,
              ...document.reliefDefinitions.defaults[action.target.ownerNodeId],
              ...previous?.value,
              enabled: true,
            },
            idFactory,
          );
      } else
        assign(
          document.reliefDefinitions.overrides,
          action.target,
          { thickness: action.thickness },
          idFactory,
        );
      return { document, changedRefs: [action.target] };
    }
    if (action.kind === 'group-nodes') {
      action.nodeIds.forEach((id) => writable(document, id));
      const id = idFactory();
      return {
        document: groupNodes(document, action.nodeIds, {
          id,
          name: action.name,
        }),
        changedRefs: [nodeRef(id)],
      };
    }
    if (action.kind === 'ungroup-nodes') {
      action.nodeIds.forEach((id) => writable(document, id));
      return {
        document: ungroupNodes(document, action.nodeIds),
        changedRefs: action.nodeIds.map(nodeRef),
      };
    }
    throw Error(`不支持的编辑动作：${action.kind}`);
  };
}
