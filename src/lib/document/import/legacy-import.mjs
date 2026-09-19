import { sha256 } from '../../project-container.mjs';
import { evaluatePlanar } from '../../construction/document-evaluation.mjs';
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
    const safeLegacyId = encodeURIComponent(String(legacyId));
    const stem = `${kind}:${safeLegacyId}`;
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
  if (Array.isArray(p.creation?.objects))
    return p.creation.objects.map((object, order) => ({
      ...object,
      pathIds: [...(object.pathIds || [])],
      legacyOrder: order,
    }));
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
    pixelToWorld: [scale, 0, 0, -scale, 0, context.project.height * scale],
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
  const point = (p) => [p.x * scale, (context.project.height - p.y) * scale];
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  const pathId = context.id('path', `${state.owner.id}:${path.id}`),
    uses = [];
  let firstId, previousId, previousPoint;
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
  state.sketch.paths[pathId] = {
    id: pathId,
    name: path.name || path.id,
    edges: uses,
    visible: path.visible !== false,
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
  const copied = state.paths.get(legacyPathId);
  if (!copied) {
    const candidates = [...context.states.values()].filter((candidate) =>
      candidate.paths.has(legacyPathId),
    );
    if (candidates.length !== 1)
      fail(
        context,
        'ambiguous-cross-owner-source',
        '旧构造的跨 Shape 路径来源不唯一；拒绝猜测归属',
        { kind: 'path', id: legacyPathId },
        {
          ownerId: state.owner.id,
          candidateObjectIds: candidates.map((candidate) => candidate.owner.id),
        },
      );
    const remote = source(context, candidates[0], legacyPathId);
    const reference = operator(context, state, 'path-reference', legacyPathId, {
      type: 'curve-reference',
      name: `${candidates[0].owner.name || candidates[0].owner.id} · 引用线`,
      enabled: true,
      inputs: {
        input: [
          {
            ...remote,
            space: 'world-result',
            transform: identity(),
          },
        ],
      },
      params: {},
    });
    const result = port(state.shape.id, reference.id, 'curves');
    state.sources.set(legacyPathId, result);
    addIssue(
      context.report,
      'info',
      'cross-owner-source-referenced',
      '旧 region 的跨 Shape 路径已编译为显式 curve-reference',
      { kind: 'path', id: legacyPathId },
      { ownerId: state.owner.id, sourceOwnerId: candidates[0].owner.id },
    );
    return result;
  }
  const op = operator(context, state, 'path-source', legacyPathId, {
    type: 'source',
    name: copied.path.name || '源线',
    enabled: true,
    inputs: {
      paths: [
        { kind: 'sketch', sketchId: state.sketch.id, pathIds: [copied.pathId] },
      ],
    },
    params: {},
  });
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
    op = operator(context, state, 'region', id, {
      type: old.kind,
      name: old.name || id,
      enabled: old.visible !== false,
      inputs: { input: [inputPort(source(context, state, old.pathId))] },
      params:
        old.kind === 'stroke' ? { widthMM: old.widthMM } : { rule: 'even-odd' },
    });
  } else if (old.kind === 'between') {
    if (!Array.isArray(old.pathIds) || old.pathIds.length !== 2)
      fail(context, 'invalid-between', '旧 between 缺少两条路径', {
        kind: 'region',
        id,
      });
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
      curveKeys: old.pathIds.map((pathId) => state.paths.get(pathId).pathId),
      boundaryJoinMM: old.boundaryJoinMM ?? old.joinMM ?? 0,
    };
    if (old.boundaryRegionId) {
      const boundary = region(context, state, old.boundaryRegionId);
      inputs.boundary = [inputPort(boundary.port)];
      params.boundaryRef = boundary.target;
    }
    op = operator(context, state, 'region', id, {
      type: 'between',
      name: old.name || id,
      enabled: old.visible !== false,
      inputs,
      params,
    });
  } else if (old.kind === 'split') {
    const base = region(context, state, old.baseId);
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
      enabled: old.visible !== false,
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
      enabled: old.visible !== false,
      inputs: {
        input: [inputPort(base.port)],
        operand: [inputPort(operand.port)],
      },
      params: { operation: old.kind, scope: { kind: 'all' } },
    });
  }
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

function modifierOperand(context, state, modifier) {
  if (modifier.input?.kind === 'path')
    return {
      domain: 'curves',
      port: source(context, state, modifier.input.id),
    };
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
        const operand = modifierOperand(context, state, old);
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

function bindEvaluatedOutputs(context, document) {
  const evaluation = evaluatePlanar(document);
  const replacements = new Map();
  const singleton = new Map();
  const actualByOperator = new Map();
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
    actualByOperator.set(componentOperatorId, actual.map(clone));
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
  const replace = (ref) => {
    if (ref?.kind !== 'output') return ref;
    return clone(
      replacements.get(`${ref.operatorId}\u0000${ref.key}`) ||
        singleton.get(ref.operatorId) ||
        ref,
    );
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
    const actual = actualByOperator.get(ref.operatorId) || [];
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
    const target = context.states.get(attach);
    if (!target)
      fail(context, 'missing-attachment', '旧高度依附对象不存在', {
        kind: 'object',
        id: attach,
      });
    placement = {
      kind: 'attached',
      target: { kind: 'node', id: target.shape.id },
      offsetMM: feature?.zMM ?? object.zMM ?? 0,
    };
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
  for (const featureId of state.owner.featureIds || []) {
    const feature = features.get(featureId);
    if (!feature)
      fail(
        context,
        'missing-feature',
        'creation object 引用的 feature 不存在',
        { kind: 'feature', id: featureId },
      );
    current = region(
      context,
      state,
      state.owner.sources?.[featureId]?.regionId || feature.regionId,
    );
    if (state.owner.sources?.[featureId])
      current = modifiers(
        context,
        state,
        current,
        state.owner.sources[featureId].modifiers,
      );
    const target =
      current.target ||
      outputRef(
        state.shape.id,
        current.operator.id,
        `legacy-feature:${feature.id}`,
        [`legacy-region:${feature.regionId}`, `legacy-feature:${feature.id}`],
      );
    const members = current.operator.outputContract?.members || [];
    if (!members.some((member) => member.key === target.key))
      current.operator.outputContract = {
        version: 1,
        members: [...members, contractMember(target)],
      };
    context.map('feature-output', feature.id, target, {
      ownerId: state.owner.id,
    });
    context.wholeOutputs.add(`${target.operatorId}\u0000${target.key}`);
    assignment(context, document, state, feature, target, {
      swatchId: state.owner.featureSwatches?.[feature.id],
    });
  }
  for (const regionId of state.owner.regionIds || [])
    current = region(context, state, regionId);
  if (!current && state.paths.size) {
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
  }
  current = modifiers(context, state, current, state.owner.modifiers);
  if (current?.domain === 'curves') state.program.outputs.curves = current.port;
  if (current?.domain === 'regions')
    state.program.outputs.regions = current.port;
  state.publishedRegion = current?.domain === 'regions' ? current : null;
  const final = current?.operator;
  if (state.owner.surfaceGraph?.outputs?.length) {
    if (!final || current.domain !== 'regions')
      fail(
        context,
        'orphan-surface-graph',
        '旧 surfaceGraph 没有区域算子承载',
        { kind: 'object', id: state.owner.id },
      );
    final.outputContract = {
      version: 1,
      members: state.owner.surfaceGraph.outputs.map((entry) => ({
        port: 'regions',
        key: entry.key,
        lineage: [entry.signature],
        topology: entry.signature,
      })),
    };
    for (const entry of state.owner.surfaceGraph.outputs) {
      const target = outputRef(state.shape.id, final.id, entry.key, [
        entry.signature,
      ]);
      context.map('surface-output', entry.key, target, {
        ownerId: state.owner.id,
      });
      if (entry.style)
        assignment(context, document, state, null, target, entry.style);
    }
  }
  for (const paint of state.owner.paints || []) {
    if (!paint.boundaryPathIds?.length)
      fail(
        context,
        'spatial-paint-ambiguous',
        '旧 paint 只有空间 geometry，没有稳定 boundaryPathIds；拒绝静默猜测',
        { kind: 'paint', id: paint.id },
        { ownerId: state.owner.id },
      );
    if (!final || current.domain !== 'regions')
      fail(context, 'orphan-paint', '旧 paint 没有区域算子承载', {
        kind: 'paint',
        id: paint.id,
      });
    const key = `paths:${[...paint.boundaryPathIds]
      .sort((left, right) => left.localeCompare(right))
      .join('|')}`;
    const target = outputRef(
      state.shape.id,
      final.id,
      key,
      paint.boundaryPathIds.map((id) => `legacy-path:${id}`),
    );
    const members = final.outputContract?.members || [];
    if (!members.some((member) => member.key === key))
      final.outputContract = {
        version: 1,
        members: [...members, contractMember(target)],
      };
    context.map('paint-output', paint.id, target, { ownerId: state.owner.id });
    assignment(context, document, state, null, target, paint);
  }
}

function compile(context) {
  validateLegacy(context);
  const p = context.project,
    allOwners = owners(context),
    assets = {};
  context.wholeOutputs = new Set();
  const document = createDocument({
    id: context.id('document', `legacy-v${p.version}`),
    idFactory: () => context.id('generated', 'default-part'),
  });
  document.geometrySettings.curveToleranceMM = p.model?.toleranceMM || 0.015;
  dataAsset(context, document, assets);
  context.states = new Map();
  const paths = new Map(p.paths.map((path) => [path.id, path])),
    copies = new Map();
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
      copyPath(context, state, path);
      const count = (copies.get(pathId) || 0) + 1;
      copies.set(pathId, count);
      context.report.copiedSources.push({
        code: count > 1 ? 'shared-source-copied' : 'source-copied',
        pathId,
        ownerId: object.id,
        sketchId,
      });
      if (count > 1)
        addIssue(
          context.report,
          'info',
          'shared-source-copied',
          '共享旧路径已为每个 Shape 复制独立可写源',
          { kind: 'path', id: pathId },
          { ownerId: object.id, sketchId },
        );
    }
  }
  metadata(context, document, allOwners);
  for (const object of allOwners)
    compileOwner(context, document, context.states.get(object.id));
  for (const group of p.groups || []) {
    const id = context.id('collection', group.id);
    const grouped = new Set(
      p.paths
        .filter((path) => path.groupId === group.id)
        .map((path) => path.id),
    );
    const members = [...context.states.values()]
      .filter((state) => [...grouped].some((pathId) => state.paths.has(pathId)))
      .map((state) => ({ kind: 'node', id: state.shape.id }));
    document.collections[id] = {
      id,
      name: group.name || group.id,
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
