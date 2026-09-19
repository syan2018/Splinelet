import { sha256 } from '../../project-container.mjs';
import { evaluatePlanar } from '../../construction/document-evaluation.mjs';
import {
  creationDocument,
  dividerGraphCohorts,
  regionSources,
} from '../../creation-schema.mjs';
import { evaluateCreation } from '../../creation-engine.mjs';
import { readGeometry } from '../../region-engine.mjs';
import { createDocument, validateDocument } from '../schema.mjs';

const identity = () => [1, 0, 0, 1, 0, 0];
const regionKinds = new Set([
  'path',
  'stroke',
  'between',
  'union',
  'difference',
  'intersection',
  'split',
]);
const modifierKinds = new Set([
  'boolean',
  'split',
  'offset',
  'radial_array',
  'curve_mirror',
  'curve_array',
  'fill',
]);
const clone = (value) => structuredClone(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

export class LegacyImportError extends Error {
  constructor(message, report) {
    super(message);
    this.name = 'LegacyImportError';
    this.code = 'legacy-import-failed';
    this.report = report;
  }
}

const addIssue = (
  report,
  severity,
  code,
  message,
  ref = null,
  details = {},
) => {
  const result = { severity, code, message, ref, ...details };
  report.issues.push(result);
  return result;
};
const fail = (context, code, message, ref = null, details = {}) => {
  addIssue(context.report, 'error', code, message, ref, details);
  context.report.status = 'failed';
  throw new LegacyImportError(message, context.report);
};
const port = (ownerNodeId, operatorId, domain) => ({
  kind: 'port',
  ownerNodeId,
  operatorId,
  port: domain,
  domain,
});
const inputPort = (value) => ({
  ...value,
  space: 'local-result',
  transform: identity(),
});
const outputRef = (ownerNodeId, operatorId, key, lineage = [key]) => ({
  kind: 'output',
  ownerNodeId,
  operatorId,
  port: 'regions',
  key,
  lineage,
  instances: [],
});
const contractMember = (ref) => ({
  port: ref.port,
  key: ref.key,
  lineage: ref.lineage.slice(),
});

function makeContext(project, suppliedAssets) {
  const report = {
    status: 'ok',
    sourceVersion: project?.version ?? null,
    compiler: `v${project?.version ?? 'unknown'}-to-v4`,
    issues: [],
    copiedSources: [],
    mappings: [],
    preserved: {
      imageName: project?.imageName || '',
      sourceDocumentVersion: project?.version ?? null,
    },
  };
  const context = {
    project,
    suppliedAssets,
    report,
    used: new Set(),
    idMap: {},
  };
  context.id = (kind, legacyId) => {
    const digest = sha256(
      new TextEncoder().encode(`${kind}\u0000${String(legacyId)}`),
    ).slice(0, 20);
    const stem = `${kind}:${digest}`;
    let result = stem;
    for (let suffix = 2; context.used.has(result); suffix++)
      result = `${stem}:${suffix}`;
    context.used.add(result);
    return result;
  };
  context.map = (kind, legacyId, target, details = {}) => {
    const key = `${kind}:${legacyId}`;
    const old = context.idMap[key];
    context.idMap[key] = old
      ? Array.isArray(old)
        ? [...old, clone(target)]
        : [old, clone(target)]
      : clone(target);
    report.mappings.push({
      legacy: { kind, id: legacyId },
      target: clone(target),
      ...details,
    });
    return target;
  };
  return context;
}

function validateLegacy(context) {
  const p = context.project;
  if (!p || typeof p !== 'object' || Array.isArray(p))
    fail(context, 'invalid-input', '旧工程必须是已解码的 Project 对象');
  if (![1, 2, 3].includes(p.version))
    fail(
      context,
      'unsupported-version',
      `不支持的旧工程版本：${String(p.version)}`,
    );
  if (
    !finite(p.width) ||
    p.width <= 0 ||
    !finite(p.height) ||
    p.height <= 0 ||
    !finite(p.widthMM) ||
    p.widthMM <= 0 ||
    !Array.isArray(p.paths)
  )
    fail(context, 'invalid-project-metrics', '旧工程尺寸或 paths 无效');
  const ids = new Set();
  for (const path of p.paths) {
    if (!path?.id || ids.has(path.id) || !Array.isArray(path.curves))
      fail(context, 'invalid-path', '旧路径无效或 ID 重复', {
        kind: 'path',
        id: path?.id,
      });
    ids.add(path.id);
    if (
      path.curves.some(
        (c) =>
          !Array.isArray(c) ||
          c.length !== 4 ||
          c.some((point) => !finite(point?.x) || !finite(point?.y)),
      )
    )
      fail(context, 'invalid-cubic', '旧路径包含非法 cubic', {
        kind: 'path',
        id: path.id,
      });
  }
  for (const region of p.model?.regions || [])
    if (!regionKinds.has(region.kind))
      fail(
        context,
        'unsupported-region-recipe',
        `不支持的旧 region recipe：${region.kind}`,
        { kind: 'region', id: region.id },
        { recipe: region.kind },
      );
  for (const object of p.creation?.objects || [])
    for (const modifier of [
      ...(object.modifiers || []),
      ...Object.values(object.sources || {}).flatMap(
        (source) => source.modifiers || [],
      ),
    ])
      if (!modifierKinds.has(modifier.type))
        fail(
          context,
          'unsupported-modifier',
          `不支持的旧 modifier：${modifier.type}`,
          { kind: 'modifier', id: modifier.id },
          { modifierType: modifier.type },
        );
}

function owners(context) {
  const p = context.project;
  if (Array.isArray(p.creation?.objects)) {
    const result = p.creation.objects.map((object, order) => ({
      ...object,
      pathIds: [...(object.pathIds || [])],
      legacyOrder: order,
    }));
    const declared = new Set(result.flatMap((owner) => owner.pathIds));
    for (const path of p.paths)
      if (!declared.has(path.id)) {
        const owner = {
          id: `path-${path.id}`,
          name: path.name || path.id,
          pathIds: [path.id],
          roles: {},
          visible: path.visible !== false,
          printable: false,
          legacyOrder: result.length,
        };
        result.push(owner);
        addIssue(
          context.report,
          'info',
          'unowned-path-owner-derived',
          '旧路径没有 creation owner；已建立独立的唯一可写源 Shape',
          { kind: 'path', id: path.id },
          { ownerId: owner.id },
        );
      }
    return result;
  }
  addIssue(
    context.report,
    'info',
    'legacy-owner-derived',
    '工程没有 creation.objects；按旧 groupId 规则一次性建立 Shape',
  );
  const result = [],
    assigned = new Set();
  for (const group of p.groups || []) {
    const pathIds = p.paths
      .filter((path) => path.groupId === group.id)
      .map((path) => path.id);
    pathIds.forEach((id) => assigned.add(id));
    if (pathIds.length)
      result.push({
        id: `group-${group.id}`,
        name: group.name,
        pathIds,
        roles: {},
        visible: true,
        printable: true,
        legacyOrder: result.length,
      });
  }
  for (const path of p.paths)
    if (!assigned.has(path.id))
      result.push({
        id: `path-${path.id}`,
        name: path.name || path.id,
        pathIds: [path.id],
        roles: {},
        visible: path.visible !== false,
        printable: true,
        legacyOrder: result.length,
      });
  const regions = new Map(
    (p.model?.regions || []).map((value) => [value.id, value]),
  );
  const sourcePaths = (regionId, seen = new Set()) => {
    if (seen.has(regionId)) return [];
    seen.add(regionId);
    const value = regions.get(regionId);
    if (!value) return [];
    return [
      ...new Set([
        ...(value.pathId ? [value.pathId] : []),
        ...(value.pathIds || []),
        ...[value.a, value.b, value.baseId, value.boundaryRegionId]
          .filter(Boolean)
          .flatMap((input) => sourcePaths(input, seen)),
      ]),
    ];
  };
  for (const feature of p.model?.features || []) {
    const sources = sourcePaths(feature.regionId);
    const candidates = result.filter(
      (owner) =>
        sources.length &&
        sources.every((pathId) => owner.pathIds.includes(pathId)),
    );
    if (candidates.length !== 1)
      fail(
        context,
        'ambiguous-feature-owner',
        '无 creation 的旧 feature 无法由完整来源集合唯一确定 Shape',
        { kind: 'feature', id: feature.id },
        {
          sourcePathIds: sources,
          candidateObjectIds: candidates.map((owner) => owner.id),
        },
      );
    (candidates[0].featureIds ||= []).push(feature.id);
  }
  return result;
}

function dataAsset(context, document, assets) {
  const match =
    /^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(
      context.project.image || '',
    );
  let bytes, mediaType, extension;
  if (match) {
    const binary = atob(match[3]);
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    mediaType = match[1];
    extension = match[2] === 'jpeg' ? 'jpg' : match[2];
  } else if (context.suppliedAssets?.reference instanceof Uint8Array) {
    bytes = context.suppliedAssets.reference.slice();
    mediaType = 'image/png';
    extension = 'png';
  } else {
    addIssue(
      context.report,
      'warning',
      'reference-image-unavailable',
      '旧参考图只有兼容 URL，调用未提供资源字节；没有伪造 V4 asset',
      { kind: 'reference', id: context.project.imageName || 'reference' },
      { source: context.project.image },
    );
    return;
  }
  const assetId = context.id('asset', 'reference'),
    referenceId = context.id('reference', 'reference');
  document.assets[assetId] = {
    id: assetId,
    path: `assets/reference.${extension}`,
    mediaType,
    size: bytes.length,
    sha256: sha256(bytes),
  };
  const scale = context.project.widthMM / context.project.width;
  document.references[referenceId] = {
    id: referenceId,
    assetId,
    name: context.project.imageName || '参考图',
    pixelWidth: context.project.width,
    pixelHeight: context.project.height,
    pixelToWorld: [
      scale,
      0,
      0,
      -scale,
      (-context.project.width / 2) * scale,
      (context.project.height / 2) * scale,
    ],
    visible: true,
    locked: true,
    opacity: 1,
  };
  assets[assetId] = bytes;
  context.map('asset', 'reference', { kind: 'asset', id: assetId });
  context.map('reference', 'reference', { kind: 'reference', id: referenceId });
}

function copyPath(context, state, path) {
  const scale = context.project.widthMM / context.project.width;
  const point = (p) => [
    (p.x - context.project.width / 2) * scale,
    (context.project.height / 2 - p.y) * scale,
  ];
  const same = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-9;
  const pathId = context.id('path', `${state.owner.id}:${path.id}`),
    uses = [],
    nodeVertexIds = [],
    disconnectedNodes = new Set();
  let firstId, previousId, previousPoint, startVertexId;
  if (!path.curves.length) {
    if (path.closed)
      fail(
        context,
        'closed-empty-path',
        '旧闭合路径没有曲线段，无法构成闭合拓扑',
        { kind: 'path', id: path.id },
      );
    if (!finite(path.start?.x) || !finite(path.start?.y))
      fail(
        context,
        'missing-point-path-start',
        '旧单节点路径缺少有限的起点坐标',
        { kind: 'path', id: path.id },
      );
    startVertexId = context.id(
      'vertex',
      `${state.owner.id}:${path.id}:0:start`,
    );
    state.sketch.vertices[startVertexId] = {
      id: startVertexId,
      position: { kind: 'free', value: point(path.start) },
    };
    nodeVertexIds[0] = startVertexId;
    context.map(
      'vertex',
      `${path.id}:0`,
      { kind: 'vertex', sketchId: state.sketch.id, id: startVertexId },
      { ownerId: state.owner.id, pathId: path.id, nodeIndex: 0 },
    );
  }
  path.curves.forEach((legacyCubic, index) => {
    const cubic = legacyCubic.map(point);
    let startId;
    if (previousId && same(previousPoint, cubic[0])) startId = previousId;
    else {
      startId = context.id(
        'vertex',
        `${state.owner.id}:${path.id}:${index}:start`,
      );
      state.sketch.vertices[startId] = {
        id: startId,
        position: { kind: 'free', value: cubic[0] },
      };
      if (previousId)
        addIssue(
          context.report,
          'warning',
          'source-gap-preserved',
          '旧 cubic 端点缝隙已保留，未自动焊接',
          { kind: 'path', id: path.id },
          { ownerId: state.owner.id, segmentIndex: index },
        );
    }
    if (nodeVertexIds[index] && nodeVertexIds[index] !== startId)
      disconnectedNodes.add(index);
    nodeVertexIds[index] = startId;
    firstId ||= startId;
    const closes =
      path.closed &&
      index === path.curves.length - 1 &&
      same(cubic[3], point(path.curves[0][0]));
    const endId = closes
      ? firstId
      : context.id('vertex', `${state.owner.id}:${path.id}:${index}:end`);
    if (!closes)
      state.sketch.vertices[endId] = {
        id: endId,
        position: { kind: 'free', value: cubic[3] },
      };
    nodeVertexIds[index + 1] = endId;
    const edgeId = context.id('edge', `${state.owner.id}:${path.id}:${index}`);
    state.sketch.edges[edgeId] = {
      id: edgeId,
      startVertexId: startId,
      endVertexId: endId,
      startHandle: {
        kind: 'free',
        vector: [cubic[1][0] - cubic[0][0], cubic[1][1] - cubic[0][1]],
      },
      endHandle: {
        kind: 'free',
        vector: [cubic[2][0] - cubic[3][0], cubic[2][1] - cubic[3][1]],
      },
    };
    uses.push({ edgeId, reversed: false });
    context.map(
      'edge',
      `${path.id}:${index}`,
      { kind: 'edge', sketchId: state.sketch.id, id: edgeId },
      { ownerId: state.owner.id },
    );
    previousId = endId;
    previousPoint = cubic[3];
  });
  const expectedNodeCount = path.closed
    ? path.curves.length
    : path.curves.length + 1;
  if (
    path.nodeModes !== undefined &&
    (!Array.isArray(path.nodeModes) ||
      path.nodeModes.length !== expectedNodeCount ||
      path.nodeModes.some(
        (mode) => !['corner', 'smooth', 'symmetric'].includes(mode),
      ))
  )
    fail(
      context,
      'invalid-node-modes',
      '旧路径的节点编辑模式与路径拓扑不匹配',
      { kind: 'path', id: path.id },
      { expectedNodeCount },
    );
  const handleModes = {};
  for (const [index, mode] of (path.nodeModes || []).entries()) {
    if (mode === 'corner') continue;
    if (!path.curves.length)
      fail(
        context,
        'invalid-point-path-node-mode',
        '旧单节点路径不能声明连续控制柄模式',
        { kind: 'path', id: path.id },
        { nodeIndex: index, mode },
      );
    if (disconnectedNodes.has(index))
      fail(
        context,
        'disconnected-node-mode',
        '旧路径在不连续端点上声明了连续控制柄模式',
        { kind: 'path', id: path.id },
        { nodeIndex: index, mode },
      );
    handleModes[nodeVertexIds[index]] = mode;
    const counts = (context.report.preserved.pathHandleModes ||= {
      smooth: 0,
      symmetric: 0,
    });
    counts[mode]++;
  }
  state.sketch.paths[pathId] = {
    id: pathId,
    name: path.name || path.id,
    order: context.project.paths.findIndex((entry) => entry.id === path.id),
    edges: uses,
    visible: path.visible !== false,
    ...(startVertexId ? { startVertexId } : {}),
    ...(Object.keys(handleModes).length ? { handleModes } : {}),
  };
  state.paths.set(path.id, { pathId, path });
  context.map(
    'path',
    path.id,
    { kind: 'path', sketchId: state.sketch.id, id: pathId },
    { ownerId: state.owner.id, copied: true },
  );
}

function operator(context, state, kind, legacyId, fields) {
  const id = context.id('operator', `${state.owner.id}:${kind}:${legacyId}`);
  const result = { id, ...fields };
  state.program.operators[id] = result;
  context.map(
    kind,
    legacyId,
    { kind: 'operator', id },
    { ownerId: state.owner.id },
  );
  return result;
}

function source(context, state, legacyPathId) {
  if (state.sources.has(legacyPathId)) return state.sources.get(legacyPathId);
  const owner = context.pathOwners.get(legacyPathId);
  if (!owner)
    fail(
      context,
      'unowned-source',
      '旧构造引用的路径没有唯一可写所有者',
      { kind: 'path', id: legacyPathId },
      { consumerOwnerId: state.owner.id },
    );
  let op;
  if (owner === state) {
    const owned = state.paths.get(legacyPathId);
    if (!owned)
      fail(
        context,
        'owned-source-missing',
        '旧路径所有者缺少对应的 V4 可写源',
        { kind: 'path', id: legacyPathId },
        { ownerId: state.owner.id },
      );
    op = operator(context, state, 'path-source', legacyPathId, {
      type: 'source',
      name: owned.path.name || '源线',
      enabled: true,
      inputs: {
        paths: [
          {
            kind: 'sketch',
            sketchId: state.sketch.id,
            pathIds: [owned.pathId],
          },
        ],
      },
      params: {},
    });
  } else {
    const upstream = source(context, owner, legacyPathId);
    op = operator(context, state, 'path-reference', legacyPathId, {
      type: 'curve-reference',
      name: context.paths.get(legacyPathId)?.name || '外部源线',
      enabled: true,
      inputs: {
        input: [
          {
            ...upstream,
            space: 'world-result',
            transform: identity(),
          },
        ],
      },
      params: {},
    });
    addIssue(
      context.report,
      'info',
      'cross-owner-source-referenced',
      '旧跨对象来源已映射为指向唯一可写源的外部输入',
      { kind: 'path', id: legacyPathId },
      {
        ownerId: state.owner.id,
        sourceOwnerId: owner.owner.id,
        operatorId: op.id,
      },
    );
  }
  const result = port(state.shape.id, op.id, 'curves');
  state.sources.set(legacyPathId, result);
  return result;
}

function region(context, state, id) {
  if (state.regionResults.has(id)) return state.regionResults.get(id);
  if (state.visiting.has(id))
    fail(context, 'region-cycle', '旧 region DAG 包含环', {
      kind: 'region',
      id,
    });
  const old = state.regions.get(id);
  if (!old)
    fail(context, 'missing-region', '旧 region 引用不存在', {
      kind: 'region',
      id,
    });
  state.visiting.add(id);
  let op;
  if (old.kind === 'path' || old.kind === 'stroke') {
    const legacyPath = context.paths.get(old.pathId);
    if (!legacyPath)
      fail(context, 'missing-path', '旧 region 引用的路径不存在', {
        kind: 'path',
        id: old.pathId,
      });
    const openPath = old.kind === 'path' && !legacyPath.closed;
    if (openPath && old.close !== true)
      fail(
        context,
        'open-path-region-not-closed',
        '旧开放路径 region 未启用首尾直线封口',
        { kind: 'region', id },
        { pathId: old.pathId },
      );
    op = operator(context, state, 'region', id, {
      type: old.kind,
      name: old.name || id,
      enabled: true,
      inputs: {
        input: [inputPort(source(context, state, old.pathId))],
      },
      params:
        old.kind === 'stroke'
          ? { widthMM: old.widthMM }
          : {
              rule: 'even-odd',
              closure: 'straight',
              ...(old.repair === true ? { repair: true } : {}),
            },
    });
    if (openPath)
      addIssue(
        context.report,
        'info',
        'implicit-region-closure-compiled',
        '旧 path region 的隐式封口已编译为随首末端点求值的直线封口',
        { kind: 'region', id },
        { pathId: old.pathId, operatorId: op.id },
      );
  } else if (old.kind === 'between') {
    if (!Array.isArray(old.pathIds) || old.pathIds.length !== 2)
      fail(context, 'invalid-between', '旧 between 缺少两条路径', {
        kind: 'region',
        id,
      });
    const externalPathIds = old.pathIds.filter(
      (pathId) => context.pathOwners.get(pathId) !== state,
    );
    if (externalPathIds.length)
      fail(
        context,
        'unsupported-cross-owner-multi-curve',
        '跨对象多曲线 region 需要显式曲线集合算子',
        { kind: 'region', id },
        { recipe: 'between', pathIds: externalPathIds },
      );
    const src = operator(context, state, 'between-source', id, {
      type: 'source',
      name: `${old.name || id} · 来源`,
      enabled: true,
      inputs: {
        paths: old.pathIds.map((pathId) => {
          source(context, state, pathId);
          return {
            kind: 'sketch',
            sketchId: state.sketch.id,
            pathIds: [state.paths.get(pathId).pathId],
          };
        }),
      },
      params: {},
    });
    const inputs = {
      input: [inputPort(port(state.shape.id, src.id, 'curves'))],
    };
    const params = {
      curveKeys: old.pathIds.map(
        (pathId, index) =>
          `${state.paths.get(pathId).pathId}@${src.id}:${index}`,
      ),
      boundaryJoinMM: old.boundaryJoinMM ?? old.joinMM ?? 0,
      repair: old.repair === true,
    };
    if (old.boundaryRegionId) {
      const boundary = region(context, state, old.boundaryRegionId);
      inputs.boundary = [inputPort(boundary.port)];
      params.boundaryRef = boundary.target;
    }
    op = operator(context, state, 'region', id, {
      type: 'between',
      name: old.name || id,
      enabled: true,
      inputs,
      params,
    });
  } else if (old.kind === 'split') {
    const base = region(context, state, old.baseId);
    const externalPathIds = (old.pathIds || []).filter(
      (pathId) => context.pathOwners.get(pathId) !== state,
    );
    if (externalPathIds.length)
      fail(
        context,
        'unsupported-cross-owner-multi-curve',
        '跨对象多曲线 partition 需要显式曲线集合算子',
        { kind: 'region', id },
        { recipe: 'split', pathIds: externalPathIds },
      );
    const cutter = operator(context, state, 'partition-source', id, {
      type: 'source',
      name: `${old.name || id} · 切分线`,
      enabled: true,
      inputs: {
        paths: (old.pathIds || []).map((pathId) => {
          source(context, state, pathId);
          return {
            kind: 'sketch',
            sketchId: state.sketch.id,
            pathIds: [state.paths.get(pathId).pathId],
          };
        }),
      },
      params: {},
    });
    op = operator(context, state, 'region', id, {
      type: 'partition',
      name: old.name || id,
      enabled: true,
      inputs: {
        input: [inputPort(base.port)],
        cutter: [inputPort(port(state.shape.id, cutter.id, 'curves'))],
      },
      params: { scope: { kind: 'all' } },
    });
  } else {
    const base = region(context, state, old.a),
      operand = region(context, state, old.b);
    op = operator(context, state, 'region', id, {
      type: 'boolean',
      name: old.name || id,
      enabled: true,
      inputs: {
        input: [inputPort(base.port)],
        operand: [inputPort(operand.port)],
      },
      params: { operation: old.kind, scope: { kind: 'all' } },
    });
  }
  context.legacyRegionByOperator.set(op.id, {
    id,
    kind: old.kind,
  });
  const key = `legacy-region:${id}`;
  const target = outputRef(state.shape.id, op.id, key, [key]);
  op.outputContract = {
    version: 1,
    members: [
      {
        ...contractMember(target),
        ...(old.contourSignature ? { topology: old.contourSignature } : {}),
      },
    ],
  };
  const result = {
    domain: 'regions',
    operator: op,
    port: port(state.shape.id, op.id, 'regions'),
    target,
  };
  state.regionResults.set(id, result);
  state.visiting.delete(id);
  context.map('region-output', id, target, { ownerId: state.owner.id });
  return result;
}

function selectedScope(context, state, modifier, current) {
  if (modifier.targets?.kind !== 'selected') return { kind: 'all' };
  if (!modifier.targets.refs?.length)
    fail(
      context,
      'ambiguous-selected-scope',
      'selected modifier 缺少稳定 refs；拒绝降级为 all',
      { kind: 'modifier', id: modifier.id },
    );
  const members = [...(current.operator.outputContract?.members || [])];
  return {
    kind: 'selected',
    refs: modifier.targets.refs.map((ref) => {
      const featureId = ref.key?.startsWith('feature:')
        ? ref.key.slice('feature:'.length)
        : null;
      if (featureId && context.featureTargets.has(featureId))
        return clone(context.featureTargets.get(featureId));
      let member = members.find((entry) => entry.key === ref.key);
      if (!member) {
        member = {
          port: 'regions',
          key: ref.key,
          lineage: [ref.topology || `legacy-target:${ref.key}`],
          ...(ref.topology ? { topology: ref.topology } : {}),
        };
        members.push(member);
        current.operator.outputContract = { version: 1, members };
      }
      return outputRef(
        state.shape.id,
        current.operator.id,
        member.key,
        member.lineage,
      );
    }),
  };
}

function modifierOperand(context, state, modifier, expectedDomain) {
  if (modifier.input?.kind === 'path') {
    const curves = source(context, state, modifier.input.id);
    if (expectedDomain === 'curves') return { domain: 'curves', port: curves };
    const fill = operator(
      context,
      state,
      'modifier-operand-fill',
      modifier.id,
      {
        type: 'path',
        name: `${modifier.name || modifier.id} · 操作面`,
        enabled: true,
        inputs: { input: [inputPort(curves)] },
        params: { rule: 'even-odd' },
      },
    );
    return {
      domain: 'regions',
      operator: fill,
      port: port(state.shape.id, fill.id, 'regions'),
    };
  }
  if (modifier.input?.kind === 'region')
    return region(context, state, modifier.input.id);
  if (modifier.input?.kind === 'object') {
    const external = context.states.get(modifier.input.id)?.publishedRegion;
    if (!external)
      fail(
        context,
        'unresolved-object-input',
        '对象 modifier 引用的 Shape 没有已发布 region',
        { kind: 'object', id: modifier.input.id },
      );
    return external;
  }
  fail(context, 'missing-modifier-input', 'modifier 缺少明确输入', {
    kind: 'modifier',
    id: modifier.id,
  });
}

function compileRepeatedJoin(context, state, current, modifier) {
  const stage = evaluatePlanar(context.document).components[
    `operator:${current.operator.id}`
  ]?.ports?.curves;
  if (stage?.status !== 'ready')
    fail(
      context,
      'tolerance-fill-input-unavailable',
      '旧容差 Fill 的曲线上游无法求值，不能生成显式 Join',
      { kind: 'modifier', id: modifier.id },
      { ownerId: state.owner.id, stageStatus: stage?.status || 'absent' },
    );
  const arrayOperator =
      current.operator.type === 'curve-array' ? current.operator : null,
    count = arrayOperator?.params?.count,
    tolerance = modifier.joinMM,
    distance = (left, right) =>
      Math.hypot(
        left.point[0] - right.point[0],
        left.point[1] - right.point[1],
      ),
    endpoints = stage.value.curves.flatMap((curve) => {
      if (curve.closed || !curve.edges.length) return [];
      const first = curve.edges[0],
        last = curve.edges.at(-1);
      return [
        { edge: first, end: 'start', point: first.cubic[0] },
        { edge: last, end: 'end', point: last.cubic[3] },
      ];
    }),
    pairs = [],
    paired = new Set();
  for (let index = 0; index < endpoints.length; index++) {
    if (paired.has(index)) continue;
    const candidates = endpoints
      .map((endpoint, candidateIndex) => ({ endpoint, candidateIndex }))
      .filter(
        ({ endpoint, candidateIndex }) =>
          candidateIndex !== index &&
          !paired.has(candidateIndex) &&
          distance(endpoints[index], endpoint) <= tolerance,
      );
    if (candidates.length !== 1)
      fail(
        context,
        'ambiguous-tolerance-join',
        candidates.length
          ? '旧容差 Fill 的端点在连接距离内存在多个候选，拒绝猜测 Join'
          : '旧容差 Fill 存在未连接端点，无法生成完整 Join',
        { kind: 'modifier', id: modifier.id },
        {
          ownerId: state.owner.id,
          endpoint: {
            edgeId: endpoints[index].edge.source.id,
            end: endpoints[index].end,
          },
          candidateCount: candidates.length,
        },
      );
    paired.add(index);
    paired.add(candidates[0].candidateIndex);
    pairs.push([endpoints[index], candidates[0].endpoint]);
  }
  if (!pairs.length)
    fail(
      context,
      'empty-tolerance-join',
      '旧容差 Fill 没有可编译的开放端点连接',
      { kind: 'modifier', id: modifier.id },
      { ownerId: state.owner.id },
    );

  const endpointDescriptor = (endpoint, selectorOperatorId) => ({
      edgeEnd: {
        kind: 'edge-end',
        sketchId: endpoint.edge.source.sketchId,
        edgeId: endpoint.edge.source.id,
        end: endpoint.end,
      },
      instances: (endpoint.edge.instances || [])
        .filter((instance) => instance.operatorId !== selectorOperatorId)
        .map(clone),
    }),
    instanceIndex = (endpoint, operatorId) =>
      endpoint.edge.instances?.find(
        (instance) => instance.operatorId === operatorId,
      )?.index;
  if (!arrayOperator)
    return pairs.map(([left, right]) => {
      const selectorOperatorId = current.operator.id,
        leftIndex = instanceIndex(left, selectorOperatorId),
        rightIndex = instanceIndex(right, selectorOperatorId);
      if (!Number.isInteger(leftIndex) || !Number.isInteger(rightIndex))
        fail(
          context,
          'unsupported-tolerance-join',
          '旧容差 Fill 的上游实例无法用稳定 selector 表达',
          { kind: 'modifier', id: modifier.id },
        );
      return {
        a: {
          ...endpointDescriptor(left, selectorOperatorId),
          selector: {
            operatorId: selectorOperatorId,
            index: leftIndex,
            wrap: false,
          },
        },
        b: {
          ...endpointDescriptor(right, selectorOperatorId),
          selector: {
            operatorId: selectorOperatorId,
            index: rightIndex,
            wrap: false,
          },
        },
      };
    });
  if (!Number.isInteger(count) || count < 1)
    fail(
      context,
      'unsupported-tolerance-join',
      '旧容差 Fill 的 Array 数量不是可编译整数',
      { kind: 'modifier', id: modifier.id },
    );
  const groups = new Map();
  for (const pair of pairs) {
    let [left, right] = pair;
    let leftIndex = instanceIndex(left, arrayOperator.id),
      rightIndex = instanceIndex(right, arrayOperator.id),
      leftDescriptor = endpointDescriptor(left, arrayOperator.id),
      rightDescriptor = endpointDescriptor(right, arrayOperator.id),
      leftKey = JSON.stringify(leftDescriptor),
      rightKey = JSON.stringify(rightDescriptor);
    if (!Number.isInteger(leftIndex) || !Number.isInteger(rightIndex))
      fail(
        context,
        'unsupported-tolerance-join',
        '旧容差 Fill 的端点缺少 Array 实例身份',
        { kind: 'modifier', id: modifier.id },
      );
    if (leftKey > rightKey) {
      [left, right] = [right, left];
      [leftIndex, rightIndex] = [rightIndex, leftIndex];
      [leftDescriptor, rightDescriptor] = [rightDescriptor, leftDescriptor];
      [leftKey, rightKey] = [rightKey, leftKey];
    }
    const delta = (rightIndex - leftIndex + count) % count,
      key = JSON.stringify([leftKey, rightKey, delta]);
    if (!groups.has(key))
      groups.set(key, {
        left: leftDescriptor,
        right: rightDescriptor,
        delta,
        iterations: new Set(),
      });
    groups.get(key).iterations.add(leftIndex);
  }
  return [...groups.values()].map((group) => {
    if (
      group.iterations.size !== count ||
      ![...Array(count).keys()].every((index) => group.iterations.has(index))
    )
      fail(
        context,
        'non-repeating-tolerance-join',
        '旧容差 Fill 的连接不能按 Array 实例稳定重复',
        { kind: 'modifier', id: modifier.id },
      );
    const rightIndex =
      group.delta === 0
        ? 'each'
        : group.delta === 1
          ? 'next'
          : group.delta === count - 1
            ? 'previous'
            : null;
    if (!rightIndex)
      fail(
        context,
        'unsupported-array-join-offset',
        '旧容差 Fill 的跨实例连接超出现有 Join 的 each/next/previous 合同',
        { kind: 'modifier', id: modifier.id },
        { ownerId: state.owner.id, delta: group.delta, count },
      );
    return {
      a: {
        ...group.left,
        selector: {
          operatorId: arrayOperator.id,
          index: 'each',
          wrap: true,
        },
      },
      b: {
        ...group.right,
        selector: {
          operatorId: arrayOperator.id,
          index: rightIndex,
          wrap: true,
        },
      },
    };
  });
}

function modifiers(context, state, current, list) {
  for (const old of list || []) {
    let op;
    if (old.type === 'curve_mirror' || old.type === 'curve_array') {
      if (current?.domain !== 'curves')
        fail(
          context,
          'modifier-domain-mismatch',
          '曲线 modifier 的上游不是 curves',
          { kind: 'modifier', id: old.id },
        );
      op = operator(context, state, 'modifier', old.id, {
        type: old.type.replace('_', '-'),
        name: old.name || old.id,
        enabled: old.enabled !== false,
        inputs: { input: [inputPort(current.port)] },
        params: {
          center: [old.centerMM?.x ?? 0, old.centerMM?.y ?? 0],
          angleRad: ((old.angleDeg ?? 0) * Math.PI) / 180,
          ...(old.type === 'curve_array' ? { count: old.count } : {}),
        },
      });
      current = {
        domain: 'curves',
        operator: op,
        port: port(state.shape.id, op.id, 'curves'),
      };
      continue;
    }
    if (old.type === 'fill') {
      if (current?.domain !== 'curves')
        fail(context, 'modifier-domain-mismatch', 'Fill 的上游不是 curves', {
          kind: 'modifier',
          id: old.id,
        });
      if (old.joinMM > 0) {
        const connections = compileRepeatedJoin(context, state, current, old),
          join = operator(context, state, 'modifier-join', old.id, {
            type: 'join',
            name: `${old.name || old.id} · 显式连接`,
            enabled: old.enabled !== false,
            inputs: { input: [inputPort(current.port)] },
            params: { connections },
          });
        addIssue(
          context.report,
          'info',
          'tolerance-fill-join-compiled',
          '旧 Fill 的端点容差连接已编译为稳定 edgeEnd/instance Join',
          { kind: 'modifier', id: old.id },
          { ownerId: state.owner.id, connectionCount: connections.length },
        );
        current = {
          domain: 'curves',
          operator: join,
          port: port(state.shape.id, join.id, 'curves'),
        };
      }
      op = operator(context, state, 'modifier', old.id, {
        type: 'fill',
        name: old.name || old.id,
        enabled: old.enabled !== false,
        inputs: { input: [inputPort(current.port)] },
        params: { rule: 'even-odd' },
      });
    } else {
      if (current?.domain !== 'regions')
        fail(
          context,
          'modifier-domain-mismatch',
          '区域 modifier 的上游不是 regions',
          { kind: 'modifier', id: old.id },
        );
      const scope = selectedScope(context, state, old, current);
      if (old.type === 'offset' || old.type === 'radial_array')
        op = operator(context, state, 'modifier', old.id, {
          type: old.type === 'radial_array' ? 'region-array' : 'offset',
          name: old.name || old.id,
          enabled: old.enabled !== false,
          inputs: { input: [inputPort(current.port)] },
          params:
            old.type === 'offset'
              ? { scope, distanceMM: old.distanceMM }
              : {
                  scope,
                  center: [old.centerMM?.x ?? 0, old.centerMM?.y ?? 0],
                  angleRad: ((old.angleDeg ?? 0) * Math.PI) / 180,
                  count: old.count,
                },
        });
      else {
        const operand = modifierOperand(
          context,
          state,
          old,
          old.type === 'split' ? 'curves' : 'regions',
        );
        op = operator(context, state, 'modifier', old.id, {
          type: old.type === 'split' ? 'partition' : 'boolean',
          name: old.name || old.id,
          enabled: old.enabled !== false,
          inputs:
            old.type === 'split'
              ? {
                  input: [inputPort(current.port)],
                  cutter: [inputPort(operand.port)],
                }
              : {
                  input: [inputPort(current.port)],
                  operand: [inputPort(operand.port)],
                },
          params:
            old.type === 'split'
              ? { scope }
              : { operation: old.operation, scope },
        });
      }
    }
    if (Array.isArray(old.outputContract))
      op.outputContract = {
        version: 1,
        members: old.outputContract.map((entry) => ({
          port: 'regions',
          key: entry.key,
          lineage: [`legacy-modifier:${old.id}`, entry.key],
          ...(entry.signature ? { topology: entry.signature } : {}),
        })),
      };
    if (old.type === 'fill' && Array.isArray(old.outputContract))
      for (const entry of old.outputContract) {
        const target = outputRef(state.shape.id, op.id, entry.key, [
          `legacy-modifier:${old.id}`,
          entry.key,
        ]);
        context.map('modifier-output', entry.key, target, {
          ownerId: state.owner.id,
        });
        context.map('surface-output', entry.key, target, {
          ownerId: state.owner.id,
        });
        const style = old.styles?.find((value) => value.key === entry.key);
        if (style)
          context.pendingOutputAssignments.push({
            state,
            target: clone(target),
            style,
          });
      }
    if (old.enabled === false && old.type !== 'fill') {
      addIssue(
        context.report,
        'info',
        'disabled-step-preserved',
        '停用的同域旧步骤已保留在 Program 中，后续链继续引用其上游结果',
        { kind: 'modifier', id: old.id },
      );
      continue;
    }
    current = {
      domain: 'regions',
      operator: op,
      port: port(state.shape.id, op.id, 'regions'),
      target: outputRef(state.shape.id, op.id, `legacy-modifier:${old.id}`),
    };
  }
  return current;
}

function bindSingletonOperatorRefs(document) {
  for (const program of Object.values(document.programs))
    for (const operator of Object.values(program.operators))
      if (operator.type === 'region-collect') delete operator.outputContract;
  const evaluation = evaluatePlanar(document),
    singleton = new Map();
  for (const component of Object.values(evaluation.components)) {
    const stage = component.ports?.regions;
    if (stage?.status === 'ready' && stage.value.regions.length === 1)
      singleton.set(
        stage.value.regions[0].ref.operatorId,
        stage.value.regions[0].ref,
      );
  }
  const replace = (ref) =>
    ref?.kind === 'output' && singleton.has(ref.operatorId)
      ? clone(singleton.get(ref.operatorId))
      : ref;
  for (const program of Object.values(document.programs))
    for (const operator of Object.values(program.operators)) {
      if (operator.params?.boundaryRef)
        operator.params.boundaryRef = replace(operator.params.boundaryRef);
      if (operator.params?.scope?.kind === 'selected')
        operator.params.scope.refs = operator.params.scope.refs.map(replace);
    }
}

function bindEvaluatedOutputs(context, document) {
  bindSingletonOperatorRefs(document);
  const initialEvaluation = evaluatePlanar(document);
  for (const program of Object.values(document.programs))
    for (const operator of Object.values(program.operators))
      if (operator.params?.scope?.kind === 'selected')
        operator.params.scope.refs = operator.params.scope.refs.flatMap(
          (ref) => {
            const key = `${ref.operatorId}\u0000${ref.key}`,
              stage =
                initialEvaluation.components[`operator:${ref.operatorId}`]
                  ?.ports?.regions,
              actual = stage?.status === 'ready' ? stage.value.regions : [];
            return context.wholeOutputs.has(key) && actual.length
              ? actual.map((item) => clone(item.ref))
              : [ref];
          },
        );
  const evaluation = evaluatePlanar(document);
  const replacements = new Map();
  const singleton = new Map();
  const actualByOperator = new Map();
  const actualItemsByOperator = new Map();
  const proposedContracts = new Map();
  for (const component of Object.values(evaluation.components)) {
    const stage = component.ports?.regions;
    const componentOperatorId = component.id.startsWith('operator:')
      ? component.id.slice('operator:'.length)
      : component.id;
    const op = Object.values(document.programs)
      .flatMap((program) => Object.values(program.operators))
      .find((candidate) => candidate.id === componentOperatorId);
    const members = op?.outputContract?.members;
    const actual =
      stage?.status === 'ready'
        ? stage.value.regions.map((item) => item.ref)
        : [];
    actualItemsByOperator.set(
      componentOperatorId,
      stage?.status === 'ready' ? stage.value.regions : [],
    );
    proposedContracts.set(
      componentOperatorId,
      stage?.status === 'ready'
        ? stage.value.provenance?.find(
            (entry) => entry.kind === 'output-contract-proposal',
          )?.members
        : undefined,
    );
    actualByOperator.set(componentOperatorId, actual.map(clone));
    const legacyRegion =
      context.legacyRegionByOperator.get(componentOperatorId);
    if (op?.type === 'path' && members?.length === 1 && actual.length > 1) {
      const expectedKey = `${componentOperatorId}\u0000${members[0].key}`,
        bindingRequired =
          context.wholeOutputs.has(expectedKey) ||
          context.spatialBindings.some(
            (binding) => binding.target.operatorId === componentOperatorId,
          );
      addIssue(
        context.report,
        'warning',
        'path-fill-multi-output',
        '旧 path 区域的实时 Fill 产生多个独立输出；已作为完整 RegionSet 继续参与后续动态构造',
        {
          kind: 'region',
          id: legacyRegion?.id || componentOperatorId,
        },
        {
          operatorId: componentOperatorId,
          outputCount: actual.length,
          stableSingleOutputBinding: false,
        },
      );
      delete op.outputContract;
      if (bindingRequired)
        fail(
          context,
          'path-fill-output-binding-ambiguous',
          '旧 path 区域直接发布为一个稳定输出，但实时 Fill 产生多个输出；拒绝猜测样式或浮雕绑定',
          {
            kind: 'region',
            id: legacyRegion?.id || componentOperatorId,
          },
          { operatorId: componentOperatorId, outputCount: actual.length },
        );
    }
    if (actual.length === 1)
      singleton.set(componentOperatorId, clone(actual[0]));
    if (members?.length === 1 && actual.length === 1) {
      const old = members[0],
        next = actual[0];
      replacements.set(`${componentOperatorId}\u0000${old.key}`, clone(next));
      op.outputContract = {
        version: 1,
        members: [
          {
            port: next.port,
            key: next.key,
            lineage: next.lineage,
            ...(old.topology ? { topology: old.topology } : {}),
          },
        ],
      };
    }
  }
  const scaleGeometry = (geometry, factor) => {
    const coordinates = (value) =>
      typeof value?.[0] === 'number'
        ? value.map((coordinate) => coordinate * factor)
        : value.map(coordinates);
    if (geometry.coordinates)
      return { ...geometry, coordinates: coordinates(geometry.coordinates) };
    return {
      ...geometry,
      geometries: geometry.geometries?.map((item) =>
        scaleGeometry(item, factor),
      ),
    };
  };
  const spatialByOperator = Map.groupBy(
    context.spatialBindings,
    (binding) => binding.target.operatorId,
  );
  for (const [operatorId, bindings] of spatialByOperator) {
    const candidates = actualItemsByOperator.get(operatorId) || [];
    const unmatched = new Set(candidates);
    const failures = [];
    for (const binding of bindings) {
      const frozen = readGeometry(
          scaleGeometry(
            binding.geometry,
            binding.normalized === false ? 1 : context.project.widthMM,
          ),
        ),
        available = [...unmatched].map((candidate) => ({
          candidate,
          geometry: readGeometry(candidate.geometry),
        })),
        ranked = available
          .map((entry) => ({
            ...entry,
            differenceMM2: frozen.symDifference(entry.geometry).getArea(),
          }))
          .sort((left, right) => left.differenceMM2 - right.differenceMM2),
        best = ranked[0],
        bestArea = Math.max(frozen.getArea(), best?.geometry.getArea() || 0),
        bestTolerance = Math.max(0.001, bestArea * 0.00001),
        contained = available.filter(({ geometry }) =>
          frozen.covers(geometry.getInteriorPoint()),
        ),
        selected =
          best?.differenceMM2 <= bestTolerance
            ? [best]
            : contained.length
              ? contained
              : best
                ? [best]
                : [];
      const merged = selected
        .map((entry) => entry.geometry)
        .reduce(
          (result, geometry) => (result ? result.union(geometry) : geometry),
          null,
        );
      const differenceMM2 = merged
          ? frozen.symDifference(merged).getArea()
          : Infinity,
        referenceAreaMM2 = Math.max(frozen.getArea(), merged?.getArea() || 0),
        toleranceMM2 = Math.max(0.001, referenceAreaMM2 * 0.00001);
      if (!selected.length || differenceMM2 > toleranceMM2) {
        failures.push({
          paintId: binding.paintId,
          candidateIndices: selected.map((entry) =>
            candidates.indexOf(entry.candidate),
          ),
          differenceMM2,
          referenceAreaMM2,
        });
        continue;
      }
      selected.forEach((entry) => unmatched.delete(entry.candidate));
      const targets = selected.map((entry) => clone(entry.candidate.ref));
      replacements.set(
        `${operatorId}\u0000${binding.target.key}`,
        targets.length === 1 ? targets[0] : targets,
      );
    }
    if (failures.length)
      fail(
        context,
        'spatial-paint-ambiguous',
        '旧 paint 冻结几何无法唯一匹配 V4 实时输出',
        { kind: 'operator', id: operatorId },
        {
          ownerId: bindings[0]?.ownerId,
          paintIds: failures.map((failure) => failure.paintId),
          candidateKeys: candidates.map((candidate) => candidate.ref.key),
          bestMatches: failures,
          diagnostics: clone(
            evaluation.components[`operator:${operatorId}`]?.ports?.regions
              ?.diagnostics || [],
          ),
        },
      );
    const op = Object.values(document.programs)
      .flatMap((program) => Object.values(program.operators))
      .find((candidate) => candidate.id === operatorId);
    if (op)
      op.outputContract = {
        version: 1,
        members:
          clone(proposedContracts.get(operatorId)) ||
          candidates.map((candidate) => contractMember(candidate.ref)),
      };
  }
  const replace = (ref) => {
    if (ref?.kind !== 'output') return ref;
    const replacement = replacements.get(`${ref.operatorId}\u0000${ref.key}`);
    return clone(
      (Array.isArray(replacement) ? null : replacement) ||
        singleton.get(ref.operatorId) ||
        ref,
    );
  };
  const expandSpatialAssignments = (table, kind) => {
    for (const [id, item] of Object.entries(table)) {
      const replacement = replacements.get(
        `${item.target?.operatorId}\u0000${item.target?.key}`,
      );
      if (!Array.isArray(replacement)) continue;
      delete table[id];
      replacement.forEach((target, index) => {
        const nextId = context.id(kind, `${id}:spatial:${index}`);
        table[nextId] = { ...clone(item), id: nextId, target: clone(target) };
      });
    }
  };
  const expandWholeAssignments = (table, kind) => {
    for (const [id, item] of Object.entries(table)) {
      const key = `${item.target?.operatorId}\u0000${item.target?.key}`;
      const actual = actualByOperator.get(item.target?.operatorId) || [];
      if (!context.wholeOutputs.has(key) || actual.length <= 1) continue;
      delete table[id];
      actual.forEach((target, index) => {
        const nextId = context.id(kind, `${id}:${index}`);
        table[nextId] = { ...clone(item), id: nextId, target: clone(target) };
      });
    }
  };
  expandSpatialAssignments(document.appearances.overrides, 'appearance');
  expandSpatialAssignments(document.reliefDefinitions.overrides, 'relief');
  expandSpatialAssignments(
    document.manufacturing.assignments,
    'manufacturing-assignment',
  );
  expandWholeAssignments(document.appearances.overrides, 'appearance');
  expandWholeAssignments(document.reliefDefinitions.overrides, 'relief');
  expandWholeAssignments(
    document.manufacturing.assignments,
    'manufacturing-assignment',
  );
  for (const item of Object.values(document.appearances.overrides))
    item.target = replace(item.target);
  for (const item of Object.values(document.reliefDefinitions.overrides)) {
    item.target = replace(item.target);
    if (item.value.placement?.kind === 'attached')
      item.value.placement.target = replace(item.value.placement.target);
  }
  for (const item of Object.values(document.manufacturing.assignments))
    item.target = replace(item.target);
  document.manufacturing.excluded =
    document.manufacturing.excluded.map(replace);
  const replaceReportRef = (ref) => {
    if (ref?.kind !== 'output') return ref;
    const key = `${ref.operatorId}\u0000${ref.key}`;
    const replacement = replacements.get(key),
      actual = actualByOperator.get(ref.operatorId) || [];
    if (Array.isArray(replacement)) return replacement.map(clone);
    return context.wholeOutputs.has(key) && actual.length > 1
      ? actual.map(clone)
      : replace(ref);
  };
  for (const [key, value] of Object.entries(context.idMap)) {
    const values = Array.isArray(value) ? value : [value];
    const next = values.flatMap((item) => {
      const replaced = replaceReportRef(item);
      return Array.isArray(replaced) ? replaced : [replaced];
    });
    context.idMap[key] = next.length === 1 ? next[0] : next;
  }
  for (const mapping of context.report.mappings)
    mapping.target = replaceReportRef(mapping.target);
  for (const table of [
    document.appearances.overrides,
    document.reliefDefinitions.overrides,
    document.manufacturing.assignments,
  ])
    for (const item of Object.values(table))
      if (item.target?.key?.startsWith('feature:')) {
        const mapped =
          context.idMap[
            `feature-output:${item.target.key.slice('feature:'.length)}`
          ];
        if (mapped && !Array.isArray(mapped)) item.target = clone(mapped);
      }
  const assigned = [
    ...Object.values(document.appearances.overrides).map((item) => item.target),
    ...Object.values(document.reliefDefinitions.overrides).map(
      (item) => item.target,
    ),
    ...Object.values(document.manufacturing.assignments).map(
      (item) => item.target,
    ),
  ];
  for (const ref of assigned) {
    const stage =
      evaluation.components[`operator:${ref.operatorId}`]?.ports?.regions;
    if (stage?.status !== 'ready') {
      addIssue(
        context.report,
        'warning',
        'output-binding-unresolved',
        '旧逐输出属性的构造上游当前失效；保留可修复 OutputRef 与原诊断',
        { kind: 'output', id: ref.key },
        {
          operatorId: ref.operatorId,
          stageStatus: stage?.status || 'absent',
          diagnostics: clone(stage?.diagnostics || []),
        },
      );
      continue;
    }
    if (!stage.value.regions.some((item) => item.ref.key === ref.key))
      fail(
        context,
        'ambiguous-output-binding',
        '旧逐输出属性无法唯一绑定到 V4 region 输出',
        { kind: 'output', id: ref.key },
        {
          operatorId: ref.operatorId,
          stageStatus: stage?.status || 'absent',
          diagnostics: clone(stage?.diagnostics || []),
          candidateKeys:
            stage?.value?.regions?.map((item) => item.ref.key) || [],
        },
      );
  }
}

function relief(context, object, feature) {
  const layers = feature?.heightLayers ?? object.heightLayers;
  const thickness = Number.isInteger(layers)
    ? { kind: 'layers', count: layers }
    : {
        kind: 'mm',
        value:
          feature?.heightMM ?? object.heightMM ?? context.project.depthMM ?? 1,
      };
  const attach = feature?.attachId ?? object.attachId;
  let placement;
  if (attach) {
    let target = feature
      ? context.featureTargets.get(attach)
      : context.states.get(attach)
        ? { kind: 'node', id: context.states.get(attach).shape.id }
        : null;
    if (feature && (!target || !context.publishedFeatureIds.has(attach))) {
      const parent = context.features.get(attach);
      if (parent) {
        const bottom = (value, seen = new Set()) => {
          if (seen.has(value.id))
            fail(context, 'attachment-cycle', '旧高度依附形成环', {
              kind: 'feature',
              id: value.id,
            });
          seen.add(value.id);
          const ancestor = value.attachId
            ? context.features.get(value.attachId)
            : null;
          return (
            (value.zMM || 0) +
            (ancestor ? bottom(ancestor, seen) + (ancestor.heightMM || 0) : 0)
          );
        };
        placement = {
          kind: 'free',
          zMM: bottom(parent) + (parent.heightMM || 0) + (feature.zMM || 0),
        };
        addIssue(
          context.report,
          'warning',
          'attachment-flattened-unpublished-target',
          '旧 feature 依附目标不在任何可发布 RegionSet 中；已保留当前 Z，但该未发布支撑的后续厚度编辑无法联动',
          { kind: 'feature', id: feature.id },
          { attachId: attach, zMM: placement.zMM },
        );
        target = null;
      }
    }
    if (target)
      placement = {
        kind: 'attached',
        target: clone(target),
        offsetMM: feature?.zMM ?? object.zMM ?? 0,
      };
    else if (!placement)
      fail(context, 'missing-attachment', '旧高度依附对象不存在', {
        kind: 'feature-or-object',
        id: attach,
      });
  } else if (object.printLayerId) {
    const layerId = context.layers.get(object.printLayerId);
    if (!layerId)
      fail(context, 'missing-print-layer', '旧打印层不存在', {
        kind: 'print-layer',
        id: object.printLayerId,
      });
    placement = {
      kind: 'layer',
      layerId,
      offsetMM: feature?.zMM ?? object.zMM ?? 0,
    };
  } else placement = { kind: 'free', zMM: feature?.zMM ?? object.zMM ?? 0 };
  return {
    enabled: feature?.enabled ?? object.printable !== false,
    thickness,
    mode: feature?.mode || 'add',
    placement,
  };
}

function assignment(context, document, state, feature, target, style = {}) {
  const swatchId = context.swatches.get(style.swatchId);
  if (swatchId) {
    const id = context.id(
      'appearance',
      `${state.owner.id}:${feature?.id || target.key}`,
    );
    document.appearances.overrides[id] = {
      id,
      target: clone(target),
      value: { swatchId },
    };
  }
  const value = relief(context, state.owner, feature);
  if (style.heightMM !== undefined)
    value.thickness = Number.isInteger(style.heightLayers)
      ? { kind: 'layers', count: style.heightLayers }
      : { kind: 'mm', value: style.heightMM };
  if (style.zOffsetMM !== undefined) {
    if (value.placement.kind === 'free') value.placement.zMM += style.zOffsetMM;
    else value.placement.offsetMM += style.zOffsetMM;
  }
  const reliefId = context.id(
    'relief',
    `${state.owner.id}:${feature?.id || target.key}`,
  );
  document.reliefDefinitions.overrides[reliefId] = {
    id: reliefId,
    target: clone(target),
    value,
  };
  if (feature?.partId) {
    const partId = context.parts.get(feature.partId);
    if (!partId)
      fail(context, 'missing-part', '旧 feature 引用的 Part 不存在', {
        kind: 'part',
        id: feature.partId,
      });
    const id = context.id(
      'manufacturing-assignment',
      `${state.owner.id}:${feature.id}`,
    );
    document.manufacturing.assignments[id] = {
      id,
      target: clone(target),
      partId,
    };
  }
}

function metadata(context, document, allOwners) {
  context.swatches = new Map();
  context.parts = new Map();
  context.layers = new Map();
  for (const swatch of context.project.creation?.swatches || []) {
    const id = context.id('swatch', swatch.id);
    document.appearances.swatches[id] = {
      id,
      name: swatch.name,
      color: swatch.color.toLowerCase(),
    };
    context.swatches.set(swatch.id, id);
    context.map('swatch', swatch.id, { kind: 'swatch', id });
  }
  const parts = context.project.model?.parts || [];
  if (parts.length) {
    document.manufacturing.parts = {};
    for (const part of parts) {
      const id = context.id('part', part.id);
      document.manufacturing.parts[id] = { id, name: part.name };
      context.parts.set(part.id, id);
      context.map('part', part.id, { kind: 'part', id });
    }
    document.manufacturing.defaultPartId = context.parts.get(parts[0].id);
  }
  const stack = context.project.creation?.printStack;
  if (stack) {
    document.manufacturing.layerHeightMM = stack.layerHeightMM;
    for (const layer of stack.layers || []) {
      const id = context.id('layer', layer.id);
      document.manufacturing.layers[id] = { id, name: layer.name };
      document.manufacturing.layerOrder.push(id);
      context.layers.set(layer.id, id);
      context.map('print-layer', layer.id, { kind: 'layer', id });
    }
  }
  document.manufacturing.slicerTemplate = clone(
    context.project.model?.slicerTemplate || null,
  );
  for (const object of allOwners) {
    const state = context.states.get(object.id),
      swatchId = context.swatches.get(object.swatchId);
    if (swatchId) document.appearances.defaults[state.shape.id] = { swatchId };
    document.reliefDefinitions.defaults[state.shape.id] = relief(
      context,
      object,
    );
    if (object.printable === false)
      document.manufacturing.excluded.push({
        kind: 'node',
        id: state.shape.id,
      });
  }
}

function compileOwner(context, document, state) {
  const features = new Map(
    (context.project.model?.features || []).map((value) => [value.id, value]),
  );
  let current = null;
  let partitionOutput = null;
  const featureResults = [];
  const publishResults = [];
  const publishedFeatures = [];
  const replacedFeatures = new Set(state.owner.replacedFeatureIds || []);
  const dividerPathIds = [...state.paths.keys()].filter(
    (pathId) => state.owner.roles?.[pathId] === 'divider',
  );
  const automaticPartition =
    (dividerPathIds.length > 0 || state.owner.legacyPartition === true) &&
    replacedFeatures.size === 0;
  for (const featureId of state.owner.featureIds || []) {
    const feature = features.get(featureId);
    if (!feature)
      fail(
        context,
        'missing-feature',
        'creation object 引用的 feature 不存在',
        { kind: 'feature', id: featureId },
      );
    let featureResult = region(
      context,
      state,
      state.owner.sources?.[featureId]?.regionId || feature.regionId,
    );
    if (state.owner.sources?.[featureId])
      featureResult = modifiers(
        context,
        state,
        featureResult,
        state.owner.sources[featureId].modifiers,
      );
    if (feature.enabled !== false) featureResults.push(featureResult);
    const target =
      featureResult.target ||
      outputRef(
        state.shape.id,
        featureResult.operator.id,
        `legacy-feature:${feature.id}`,
        [`legacy-region:${feature.regionId}`, `legacy-feature:${feature.id}`],
      );
    const members = featureResult.operator.outputContract?.members || [];
    if (!members.some((member) => member.key === target.key))
      featureResult.operator.outputContract = {
        version: 1,
        members: [...members, contractMember(target)],
      };
    context.map('feature-output', feature.id, target, {
      ownerId: state.owner.id,
    });
    context.featureTargets.set(feature.id, clone(target));
    if (
      feature.enabled !== false &&
      !replacedFeatures.has(feature.id) &&
      !automaticPartition
    ) {
      publishResults.push(featureResult);
      context.publishedFeatureIds.add(feature.id);
      context.wholeOutputs.add(`${target.operatorId}\u0000${target.key}`);
      context.pendingFeatureAssignments.push({
        state,
        feature,
        target: clone(target),
        style: { swatchId: state.owner.featureSwatches?.[feature.id] },
      });
      publishedFeatures.push({ feature, result: featureResult, target });
    }
  }
  for (const regionId of state.owner.regionIds || []) {
    if ([...features.values()].some((feature) => feature.regionId === regionId))
      continue;
    if (!state.regions.has(regionId)) {
      addIssue(
        context.report,
        'info',
        'stale-region-id-ignored',
        '旧 creation.regionIds 含有已删除的兼容 ID；保持旧引擎的无操作语义',
        { kind: 'region', id: regionId },
        { ownerId: state.owner.id },
      );
      continue;
    }
    current = region(context, state, regionId);
    publishResults.push(current);
  }

  const baseRegionIds = state.owner.baseRegionIds || [];
  let partitionBases = baseRegionIds.length
    ? baseRegionIds.map((regionId) => region(context, state, regionId))
    : automaticPartition
      ? featureResults
      : [];
  if (
    state.owner.surfaceGraph &&
    baseRegionIds.length > 1 &&
    !dividerPathIds.length
  ) {
    context.legacyEvaluation ||= evaluateCreation(clone(context.project));
    const cells = context.legacyEvaluation.modifierBaseCells.filter(
      (cell) => cell.objectId === state.owner.id,
    );
    if (!cells.length)
      fail(
        context,
        'surface-base-missing',
        '旧 surfaceGraph 没有可用于迁移的求值底面',
        { kind: 'object', id: state.owner.id },
      );
    const sourceBases = partitionBases,
      baseEvaluation = evaluatePlanar(document),
      baseGeometries = sourceBases.map((base) => {
        const stage =
          baseEvaluation.components[`operator:${base.operator.id}`]?.ports
            ?.regions;
        if (stage?.status !== 'ready' || !stage.value.regions.length)
          fail(
            context,
            'surface-arrangement-base-unavailable',
            '旧 surfaceGraph 的动态底面无法求值',
            { kind: 'object', id: state.owner.id },
            {
              operatorId: base.operator.id,
              status: stage?.status || 'absent',
              diagnostics: clone(stage?.diagnostics || []),
            },
          );
        return stage.value.regions
          .map((item) => readGeometry(item.geometry))
          .reduce((sum, geometry) => (sum ? sum.union(geometry) : geometry));
      }),
      membershipKeys = new Map(),
      cellTolerances = new Map();
    const arrangedBases = cells.map((cell) => {
      const frozen = readGeometry(cell.geometry),
        toleranceMM2 = Math.max(0.001, frozen.getArea() * 0.00001),
        included = [],
        excluded = [];
      cellTolerances.set(cell.key, toleranceMM2);
      baseGeometries.forEach((geometry, index) => {
        const overlapMM2 = frozen.intersection(geometry).getArea(),
          missingMM2 = frozen.difference(geometry).getArea();
        if (missingMM2 <= toleranceMM2) included.push(index);
        else if (overlapMM2 <= toleranceMM2) excluded.push(index);
        else
          fail(
            context,
            'surface-arrangement-partial-membership',
            '旧 surfaceGraph 输出与动态底面只有部分重叠，无法编译稳定的集合关系',
            { kind: 'surface-output', id: cell.key },
            {
              ownerId: state.owner.id,
              baseRegionId: baseRegionIds[index],
              overlapMM2,
              missingMM2,
              toleranceMM2,
            },
          );
      });
      const membership = included
          .map((index) => baseRegionIds[index])
          .sort((left, right) => left.localeCompare(right)),
        membershipKey = membership.join('\u0000');
      if (!included.length)
        fail(
          context,
          'surface-arrangement-unbound-cell',
          '旧 surfaceGraph 输出不在任何动态底面内',
          { kind: 'surface-output', id: cell.key },
          { ownerId: state.owner.id },
        );
      if (membershipKeys.has(membershipKey))
        fail(
          context,
          'surface-arrangement-membership-ambiguous',
          '多个旧 surfaceGraph 输出具有相同底面成员关系，现有布尔算子无法稳定区分轮廓身份',
          { kind: 'surface-output', id: cell.key },
          {
            ownerId: state.owner.id,
            conflictingOutputId: membershipKeys.get(membershipKey),
            baseRegionIds: membership,
          },
        );
      membershipKeys.set(membershipKey, cell.key);
      let result = sourceBases[included[0]];
      for (const index of included.slice(1)) {
        const op = operator(
          context,
          state,
          'surface-arrangement-intersection',
          `${cell.key}:${baseRegionIds[index]}`,
          {
            type: 'boolean',
            name: `${state.owner.name || state.owner.id} · ${cell.key} · 交集`,
            enabled: true,
            inputs: {
              input: [inputPort(result.port)],
              operand: [inputPort(sourceBases[index].port)],
            },
            params: { operation: 'intersection', scope: { kind: 'all' } },
          },
        );
        result = {
          domain: 'regions',
          operator: op,
          port: port(state.shape.id, op.id, 'regions'),
        };
      }
      for (const index of excluded) {
        const op = operator(
          context,
          state,
          'surface-arrangement-difference',
          `${cell.key}:${baseRegionIds[index]}`,
          {
            type: 'boolean',
            name: `${state.owner.name || state.owner.id} · ${cell.key} · 差集`,
            enabled: true,
            inputs: {
              input: [inputPort(result.port)],
              operand: [inputPort(sourceBases[index].port)],
            },
            params: { operation: 'difference', scope: { kind: 'all' } },
          },
        );
        result = {
          domain: 'regions',
          operator: op,
          port: port(state.shape.id, op.id, 'regions'),
        };
      }
      addIssue(
        context.report,
        'info',
        'surface-arrangement-compiled',
        '旧 surfaceGraph 重叠底面已编译为动态布尔构造',
        { kind: 'surface-output', id: cell.key },
        { ownerId: state.owner.id, baseRegionIds: membership },
      );
      return result;
    });
    const arrangedEvaluation = evaluatePlanar(document);
    arrangedBases.forEach((result, index) => {
      const cell = cells[index],
        stage =
          arrangedEvaluation.components[`operator:${result.operator.id}`]?.ports
            ?.regions;
      if (stage?.status !== 'ready')
        fail(
          context,
          'surface-arrangement-evaluation-failed',
          '旧 surfaceGraph 的动态布尔构造无法求值',
          { kind: 'surface-output', id: cell.key },
          {
            ownerId: state.owner.id,
            operatorId: result.operator.id,
            status: stage?.status || 'absent',
            diagnostics: clone(stage?.diagnostics || []),
          },
        );
      const actual = stage.value.regions
          .map((item) => readGeometry(item.geometry))
          .reduce((sum, geometry) => (sum ? sum.union(geometry) : geometry)),
        differenceMM2 = readGeometry(cell.geometry)
          .symDifference(actual)
          .getArea(),
        toleranceMM2 = cellTolerances.get(cell.key);
      if (differenceMM2 > toleranceMM2)
        fail(
          context,
          'surface-arrangement-geometry-mismatch',
          '旧 surfaceGraph 输出的动态布尔构造与原几何不等价',
          { kind: 'surface-output', id: cell.key },
          {
            ownerId: state.owner.id,
            operatorId: result.operator.id,
            differenceMM2,
            toleranceMM2,
          },
        );
    });
    partitionBases = arrangedBases;
  }
  const usedPathIds = new Set(
    [
      ...(state.owner.featureIds || []),
      ...(state.owner.regionIds || []),
      ...baseRegionIds,
    ].flatMap((id) => {
      const feature = features.get(id);
      return regionSources(context.project.model, feature?.regionId || id);
    }),
  );
  const explicitBasePathIds = new Set(state.owner.basePathIds || []);
  const boundaryBasePathIds = [...state.paths.entries()]
    .filter(
      ([pathId, entry]) =>
        !explicitBasePathIds.has(pathId) &&
        (state.owner.roles?.[pathId] ||
          (entry.path.closed ? 'boundary' : 'guide')) === 'boundary' &&
        !usedPathIds.has(pathId),
    )
    .map(([pathId]) => pathId);
  for (const pathId of [...explicitBasePathIds, ...boundaryBasePathIds]) {
    const curves = source(context, state, pathId);
    const fill = operator(
      context,
      state,
      'legacy-partition-base-path',
      pathId,
      {
        type: 'path',
        name: `${state.paths.get(pathId).path.name || pathId} · 分区底面`,
        enabled: true,
        inputs: { input: [inputPort(curves)] },
        params: { rule: 'even-odd' },
      },
    );
    partitionBases.push({
      domain: 'regions',
      operator: fill,
      port: port(state.shape.id, fill.id, 'regions'),
    });
  }
  if (partitionBases.length) {
    let partitionBase = partitionBases[0];
    if (partitionBases.length > 1) {
      const collect = operator(
        context,
        state,
        'legacy-partition-base-collect',
        state.owner.id,
        {
          type: 'region-collect',
          name: `${state.owner.name || state.owner.id} · 分区底面集合`,
          enabled: true,
          inputs: {
            input: partitionBases.map((result) => inputPort(result.port)),
          },
          params: {},
        },
      );
      partitionBase = {
        domain: 'regions',
        operator: collect,
        port: port(state.shape.id, collect.id, 'regions'),
      };
    }
    for (const clipRegionId of state.owner.clipRegionIds || []) {
      const operand = region(context, state, clipRegionId);
      const clip = operator(
        context,
        state,
        'legacy-partition-clip',
        clipRegionId,
        {
          type: 'boolean',
          name: `${state.owner.name || state.owner.id} · 分区裁剪`,
          enabled: true,
          inputs: {
            input: [inputPort(partitionBase.port)],
            operand: [inputPort(operand.port)],
          },
          params: { operation: 'intersection', scope: { kind: 'all' } },
        },
      );
      partitionBase = {
        domain: 'regions',
        operator: clip,
        port: port(state.shape.id, clip.id, 'regions'),
      };
    }
    if (dividerPathIds.length) {
      const cutterPaths = dividerPathIds.map((legacyPathId) => {
        source(context, state, legacyPathId);
        const sourcePath = state.paths.get(legacyPathId);
        if (!sourcePath)
          fail(
            context,
            'partition-divider-missing',
            '旧分区线缺少 canonical V4 Path',
            { kind: 'path', id: legacyPathId },
            { ownerId: state.owner.id },
          );
        return { legacyPathId, pathId: sourcePath.pathId };
      });
      const pathIds = new Map(
        cutterPaths.map((item) => [item.legacyPathId, item.pathId]),
      );
      const seenCohortPaths = new Set();
      // Cohorts preserve the accepted legacy divider graph: later dividers may
      // attach to earlier ones without pulling an older endpoint to a new line.
      const cohorts = dividerGraphCohorts(state.owner).map((cohort) =>
        [...cohort].map((legacyPathId) => {
          const pathId = pathIds.get(legacyPathId);
          if (!pathId)
            fail(
              context,
              'partition-cohort-path-missing',
              '旧分区 cohort 引用了不属于当前 cutter 的 Path',
              { kind: 'path', id: legacyPathId },
              { ownerId: state.owner.id },
            );
          if (seenCohortPaths.has(pathId))
            fail(
              context,
              'partition-cohort-path-duplicate',
              '旧分区 cohort 重复引用同一 Path',
              { kind: 'path', id: legacyPathId },
              { ownerId: state.owner.id, pathId },
            );
          seenCohortPaths.add(pathId);
          return pathId;
        }),
      );
      const disabled = Object.entries(
        state.owner.connectionDisabled || {},
      ).flatMap(([key, value]) => {
        if (value !== true) return [];
        const match = /^(.*):([01])$/.exec(key),
          pathId = match && pathIds.get(match[1]);
        if (!match || !pathId)
          fail(
            context,
            'partition-disabled-endpoint-missing',
            '旧分区禁用连接引用了不属于当前 cutter 的端点',
            { kind: 'object', id: state.owner.id },
            { endpoint: key },
          );
        return [{ pathId, endpoint: Number(match[2]) }];
      });
      const cutter = operator(
        context,
        state,
        'legacy-partition-cutters',
        state.owner.id,
        {
          type: 'source',
          name: `${state.owner.name || state.owner.id} · 分区线`,
          enabled: true,
          inputs: {
            paths: cutterPaths.map(({ pathId }) => {
              return {
                kind: 'sketch',
                sketchId: state.sketch.id,
                pathIds: [pathId],
              };
            }),
          },
          params: {},
        },
      );
      const partition = operator(
        context,
        state,
        'legacy-partition',
        state.owner.id,
        {
          type: 'partition',
          name: `${state.owner.name || state.owner.id} · 旧分区`,
          enabled: true,
          inputs: {
            input: [inputPort(partitionBase.port)],
            cutter: [inputPort(port(state.shape.id, cutter.id, 'curves'))],
          },
          params: {
            scope: { kind: 'all' },
            endpointJoin: {
              toleranceMM: state.owner.joinMM || 0,
              disabled,
              cohorts,
            },
          },
        },
      );
      current = {
        domain: 'regions',
        operator: partition,
        port: port(state.shape.id, partition.id, 'regions'),
        target: outputRef(
          state.shape.id,
          partition.id,
          `legacy-partition:${state.owner.id}`,
        ),
      };
      partitionOutput = current;
      context.wholeOutputs.add(
        `${current.target.operatorId}\u0000${current.target.key}`,
      );
    } else current = partitionBase;
    if (
      !partitionOutput &&
      (explicitBasePathIds.size || boundaryBasePathIds.length) &&
      !state.owner.modifiers?.length
    )
      partitionOutput = current;
    publishResults.push(current);
  }
  if (!publishResults.length && state.paths.size) {
    const regionFirst = ['boolean', 'split', 'offset', 'radial_array'].includes(
      state.owner.modifiers?.[0]?.type,
    );
    const explicitBase = new Set(state.owner.basePathIds || []);
    const baseEntries = [...state.paths.entries()].filter(
      ([legacyId, entry]) =>
        explicitBase.has(legacyId) ||
        (!explicitBase.size &&
          entry.path.closed &&
          !['hole', 'divider', 'guide'].includes(
            state.owner.roles?.[legacyId],
          )),
    );
    const selectedEntries =
      regionFirst && baseEntries.length
        ? baseEntries.map(([, entry]) => entry)
        : [...state.paths.values()];
    const op = operator(context, state, 'object-source', state.owner.id, {
      type: 'source',
      name: `${state.owner.name || state.owner.id} · 源线`,
      enabled: true,
      inputs: {
        paths: selectedEntries.map((entry) => ({
          kind: 'sketch',
          sketchId: state.sketch.id,
          pathIds: [entry.pathId],
        })),
      },
      params: {},
    });
    current = {
      domain: 'curves',
      operator: op,
      port: port(state.shape.id, op.id, 'curves'),
    };
    if (regionFirst) {
      const fill = operator(
        context,
        state,
        'legacy-base-fill',
        state.owner.id,
        {
          type: 'path',
          name: `${state.owner.name || state.owner.id} · 基础面`,
          enabled: true,
          inputs: { input: [inputPort(current.port)] },
          params: { rule: 'even-odd' },
        },
      );
      current = {
        domain: 'regions',
        operator: fill,
        port: port(state.shape.id, fill.id, 'regions'),
        target: outputRef(
          state.shape.id,
          fill.id,
          `legacy-object:${state.owner.id}:base`,
        ),
      };
    }
    publishResults.push(current);
  }
  if (publishResults.length === 1) current = publishResults[0];
  else if (publishResults.length > 1) {
    const collect = operator(context, state, 'region-collect', state.owner.id, {
      type: 'region-collect',
      name: `${state.owner.name || state.owner.id} · 区域集合`,
      enabled: true,
      inputs: {
        input: publishResults.map((result) => inputPort(result.port)),
      },
      params: {},
    });
    current = {
      domain: 'regions',
      operator: collect,
      port: port(state.shape.id, collect.id, 'regions'),
    };
  }
  const beforeObjectModifiers = current;
  current = modifiers(context, state, current, state.owner.modifiers);
  if (current?.domain === 'regions')
    for (const oldModifier of state.owner.modifiers || [])
      for (const ref of oldModifier.targets?.refs || []) {
        const featureId = ref.key?.startsWith('feature:')
          ? ref.key.slice('feature:'.length)
          : null;
        if (!featureId) continue;
        context.legacyEvaluation ||= evaluateCreation(clone(context.project));
        const legacyCell = context.legacyEvaluation.cells.find(
          (cell) =>
            cell.objectId === state.owner.id && cell.featureId === featureId,
        );
        if (!legacyCell?.geometry) continue;
        const target = outputRef(
          state.shape.id,
          current.operator.id,
          `legacy-feature:${featureId}`,
          [`legacy-feature:${featureId}`],
        );
        delete current.operator.outputContract;
        context.spatialBindings.push({
          paintId: `feature:${featureId}`,
          ownerId: state.owner.id,
          target: clone(target),
          geometry: clone(legacyCell.geometry),
          normalized: false,
        });
        context.featureTargets.set(featureId, clone(target));
        // Keep the upstream whole-output marker: selected modifier scopes were
        // authored against that feature and expand it before downstream bind.
        const pending = context.pendingFeatureAssignments.find(
          (item) => item.state === state && item.feature.id === featureId,
        );
        if (pending) pending.target = clone(target);
        context.idMap[`feature-output:${featureId}`] = clone(target);
        for (const mapping of context.report.mappings)
          if (
            mapping.legacy.kind === 'feature-output' &&
            mapping.legacy.id === featureId &&
            mapping.ownerId === state.owner.id
          )
            mapping.target = clone(target);
      }
  if (
    publishResults.length === 1 &&
    publishedFeatures.length === 1 &&
    current?.target &&
    current.operator.id !== beforeObjectModifiers?.operator?.id
  ) {
    const [{ feature, target }] = publishedFeatures;
    context.featureTargets.set(feature.id, clone(current.target));
    context.wholeOutputs.delete(`${target.operatorId}\u0000${target.key}`);
    context.wholeOutputs.add(
      `${current.target.operatorId}\u0000${current.target.key}`,
    );
    const pending = context.pendingFeatureAssignments.find(
      (entry) => entry.state === state && entry.feature.id === feature.id,
    );
    if (pending) pending.target = clone(current.target);
    context.idMap[`feature-output:${feature.id}`] = clone(current.target);
    for (const mapping of context.report.mappings)
      if (
        mapping.legacy.kind === 'feature-output' &&
        mapping.legacy.id === feature.id &&
        mapping.ownerId === state.owner.id
      )
        mapping.target = clone(current.target);
  }
  if (current?.domain === 'curves') state.program.outputs.curves = current.port;
  if (current?.domain === 'regions')
    state.program.outputs.regions = current.port;
  state.publishedRegion = current?.domain === 'regions' ? current : null;
  const styledResult = partitionOutput || current;
  const styledFinal = styledResult?.operator;
  if (state.owner.surfaceGraph?.outputs?.length) {
    if (!styledFinal || styledResult.domain !== 'regions')
      fail(
        context,
        'orphan-surface-graph',
        '旧 surfaceGraph 没有区域算子承载',
        { kind: 'object', id: state.owner.id },
      );
    // Legacy contracts describe the old engine's topology tokens. Geometry is
    // bound below against the V4 result, then a native V4 contract is stored.
    delete styledFinal.outputContract;
    context.legacyEvaluation ||= evaluateCreation(clone(context.project));
    for (const entry of state.owner.surfaceGraph.outputs) {
      const target = outputRef(state.shape.id, styledFinal.id, entry.key, [
        entry.signature,
      ]);
      context.map('surface-output', entry.key, target, {
        ownerId: state.owner.id,
      });
      {
        const legacyCell = context.legacyEvaluation.cells.find(
          (cell) => cell.objectId === state.owner.id && cell.key === entry.key,
        );
        if (!legacyCell?.geometry) {
          addIssue(
            context.report,
            entry.style ? 'warning' : 'info',
            entry.style
              ? 'stale-styled-surface-output-preserved'
              : 'stale-surface-output-ignored',
            entry.style
              ? '旧 surfaceGraph 样式输出已不在当前求值结果中；样式记录保留在迁移报告中，未捏造几何或赋值'
              : '旧 surfaceGraph 未着色输出已不在当前求值结果中',
            { kind: 'surface-output', id: entry.key },
            {
              ownerId: state.owner.id,
              ...(entry.style ? { style: clone(entry.style) } : {}),
            },
          );
          continue;
        }
        if (legacyCell.featureId) {
          const previous = context.featureTargets.get(legacyCell.featureId);
          context.featureTargets.set(legacyCell.featureId, clone(target));
          if (previous)
            context.wholeOutputs.delete(
              `${previous.operatorId}\u0000${previous.key}`,
            );
          const pending = context.pendingFeatureAssignments.find(
            (item) =>
              item.state === state && item.feature.id === legacyCell.featureId,
          );
          if (pending) pending.target = clone(target);
          context.idMap[`feature-output:${legacyCell.featureId}`] =
            clone(target);
          for (const mapping of context.report.mappings)
            if (
              mapping.legacy.kind === 'feature-output' &&
              mapping.legacy.id === legacyCell.featureId &&
              mapping.ownerId === state.owner.id
            )
              mapping.target = clone(target);
        }
        context.spatialBindings.push({
          paintId: `surface:${entry.key}`,
          ownerId: state.owner.id,
          target: clone(target),
          geometry: clone(legacyCell.geometry),
          normalized: false,
        });
      }
      if (entry.style)
        assignment(context, document, state, null, target, entry.style);
    }
  }
  for (const paint of state.owner.paints || []) {
    if (!styledFinal || styledResult.domain !== 'regions')
      fail(context, 'orphan-paint', '旧 paint 没有区域算子承载', {
        kind: 'paint',
        id: paint.id,
      });
    const spatial = styledFinal.type === 'partition' && paint.geometry;
    const key = spatial
      ? `legacy-paint:${paint.id}`
      : paint.boundaryPathIds?.length
        ? `paths:${[...paint.boundaryPathIds]
            .sort((left, right) => left.localeCompare(right))
            .join('|')}`
        : `legacy-paint:${paint.id}`;
    const target = outputRef(
      state.shape.id,
      styledFinal.id,
      key,
      !spatial && paint.boundaryPathIds?.length
        ? paint.boundaryPathIds.map((id) => `legacy-path:${id}`)
        : [`legacy-paint:${paint.id}`],
    );
    const members = styledFinal.outputContract?.members || [];
    if (!spatial && !members.some((member) => member.key === key))
      styledFinal.outputContract = {
        version: 1,
        members: [...members, contractMember(target)],
      };
    context.map('paint-output', paint.id, target, { ownerId: state.owner.id });
    if (spatial || !paint.boundaryPathIds?.length) {
      if (!paint.geometry)
        fail(
          context,
          'spatial-paint-ambiguous',
          '旧 paint 既没有边界 ID 也没有冻结几何',
          { kind: 'paint', id: paint.id },
          { ownerId: state.owner.id },
        );
      context.spatialBindings.push({
        paintId: paint.id,
        ownerId: state.owner.id,
        target: clone(target),
        geometry: clone(paint.geometry),
      });
      addIssue(
        context.report,
        'info',
        'spatial-paint-matched-once',
        '旧 paint 没有边界 ID；导入时以冻结几何唯一匹配 V4 输出',
        { kind: 'paint', id: paint.id },
        { ownerId: state.owner.id },
      );
    }
    assignment(context, document, state, null, target, paint);
  }
}

function compile(context) {
  validateLegacy(context);
  const p = context.project;
  p.creation = creationDocument(p);
  const allOwners = owners(context),
    assets = {};
  context.wholeOutputs = new Set();
  const document = createDocument({
    id: context.id('document', `legacy-v${p.version}`),
    idFactory: () => context.id('generated', 'default-part'),
  });
  context.document = document;
  document.geometrySettings.curveToleranceMM = p.model?.toleranceMM || 0.015;
  document.geometrySettings.joinToleranceMM = Math.max(
    document.geometrySettings.joinToleranceMM,
    ...allOwners.flatMap((object) =>
      (object.modifiers || [])
        .filter(
          (modifier) =>
            modifier.type === 'fill' &&
            modifier.enabled !== false &&
            modifier.joinMM > 0,
        )
        .map((modifier) => modifier.joinMM),
    ),
  );
  dataAsset(context, document, assets);
  context.states = new Map();
  const paths = new Map(p.paths.map((path) => [path.id, path]));
  context.paths = paths;
  context.pathOwners = new Map();
  context.features = new Map(
    (p.model?.features || []).map((feature) => [feature.id, feature]),
  );
  context.featureTargets = new Map();
  context.publishedFeatureIds = new Set();
  context.pendingFeatureAssignments = [];
  context.pendingOutputAssignments = [];
  context.spatialBindings = [];
  context.legacyRegionByOperator = new Map();
  for (const object of allOwners) {
    const shapeId = context.id('shape', object.id),
      programId = context.id('program', object.id),
      sketchId = context.id('sketch', object.id);
    const shape = {
      id: shapeId,
      name: object.name || object.id,
      parentId: null,
      order: object.legacyOrder,
      pose: { translationMM: [0, 0], rotationRad: 0 },
      visible: object.visible !== false,
      locked: false,
      kind: 'shape',
      programId,
    };
    const program = {
      id: programId,
      ownerNodeId: shapeId,
      operators: {},
      outputs: {},
    };
    const sketch = {
      id: sketchId,
      ownerNodeId: shapeId,
      vertices: {},
      edges: {},
      paths: {},
    };
    document.nodes[shapeId] = shape;
    document.programs[programId] = program;
    document.sketches[sketchId] = sketch;
    context.map('object', object.id, { kind: 'node', id: shapeId });
    const state = {
      owner: object,
      shape,
      program,
      sketch,
      paths: new Map(),
      sources: new Map(),
      regions: new Map(
        (p.model?.regions || []).map((value) => [value.id, value]),
      ),
      regionResults: new Map(),
      visiting: new Set(),
    };
    context.states.set(object.id, state);
  }
  for (const object of allOwners) {
    const state = context.states.get(object.id);
    for (const pathId of object.pathIds || []) {
      const path = paths.get(pathId);
      if (!path)
        fail(
          context,
          'missing-path',
          'creation object 引用的路径不存在',
          { kind: 'path', id: pathId },
          { ownerId: object.id },
        );
      const previous = context.pathOwners.get(pathId);
      if (previous)
        fail(
          context,
          'ambiguous-path-owner',
          '旧路径被多个对象声明为可写源，无法确定唯一所有者',
          { kind: 'path', id: pathId },
          { ownerIds: [previous.owner.id, object.id] },
        );
      context.pathOwners.set(pathId, state);
    }
  }
  for (const [pathId, state] of context.pathOwners) {
    const path = paths.get(pathId);
    copyPath(context, state, path);
    context.report.copiedSources.push({
      code: 'source-owned',
      pathId,
      ownerId: state.owner.id,
      sketchId: state.sketch.id,
    });
  }
  metadata(context, document, allOwners);
  for (const object of allOwners)
    compileOwner(context, document, context.states.get(object.id));
  for (const pending of context.pendingFeatureAssignments)
    assignment(
      context,
      document,
      pending.state,
      pending.feature,
      pending.target,
      pending.style,
    );
  for (const pending of context.pendingOutputAssignments)
    assignment(
      context,
      document,
      pending.state,
      null,
      pending.target,
      pending.style,
    );
  for (const group of p.groups || []) {
    const id = context.id('collection', group.id);
    const members = [];
    for (const path of p.paths.filter((path) => path.groupId === group.id)) {
      const owningStates = [...context.states.values()].filter((state) =>
        state.owner.pathIds?.includes(path.id),
      );
      if (!owningStates.length)
        fail(
          context,
          'group-path-owner-missing',
          '旧分组路径没有可确定的 Shape 所有者',
          { kind: 'path', id: path.id },
          { groupId: group.id },
        );
      if (owningStates.length > 1)
        addIssue(
          context.report,
          'warning',
          'group-path-multiple-owners',
          '旧分组路径由多个 Shape 真实拥有；分组按原对象顺序包含全部独立路径',
          { kind: 'path', id: path.id },
          {
            groupId: group.id,
            ownerIds: owningStates.map((state) => state.owner.id),
          },
        );
      for (const state of owningStates) {
        const copied = state.paths.get(path.id);
        if (!copied)
          fail(
            context,
            'group-path-copy-missing',
            '旧分组路径所有者缺少已导入的可编辑路径',
            { kind: 'path', id: path.id },
            { groupId: group.id, ownerId: state.owner.id },
          );
        members.push({
          kind: 'path',
          sketchId: state.sketch.id,
          id: copied.pathId,
        });
      }
    }
    document.collections[id] = {
      id,
      name: group.name || group.id,
      order: p.groups.indexOf(group),
      members,
      origin: 'legacy',
    };
    context.map('group', group.id, { kind: 'collection', id });
  }
  bindEvaluatedOutputs(context, document);
  validateDocument(document);
  context.report.status = context.report.issues.some(
    (entry) => entry.severity === 'warning',
  )
    ? 'ok-with-warnings'
    : 'ok';
  return {
    documentV4: document,
    document,
    idMap: context.idMap,
    report: context.report,
    assets,
  };
}

const importV1 = (context) => compile(context);
const importV2 = (context) => compile(context);
const importV3 = (context) => compile(context);

/** One-way import of a decoded Project or `{ project, assets }`. */
export function importLegacy(input) {
  const wrapper = input?.project
    ? input
    : { project: input, assets: undefined };
  const project = clone(wrapper.project);
  const context = makeContext(project, wrapper.assets);
  const importer = { 1: importV1, 2: importV2, 3: importV3 }[project?.version];
  if (!importer) validateLegacy(context);
  return importer(context);
}
