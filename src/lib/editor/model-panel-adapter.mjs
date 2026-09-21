import { creationCellKey } from './creation-view.mjs';
import { resolveThicknessMM } from '../manufacturing/dimensions.mjs';
import { requestedPrintCount } from '../print-stack.mjs';

const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
};
const clone = (value) => structuredClone(value);
const has = (value, key) => Object.hasOwn(value, key);
const finite = (value) => Number.isFinite(value);
const attachmentToken = (target) =>
  target?.kind === 'output'
    ? creationCellKey(target)
    : target?.kind === 'node'
      ? `node:${target.id}`
      : null;

function diagnosticsFor(region) {
  const messages = [];
  if (region.authoredRelief?.status !== 'ready')
    messages.push(
      ...(region.authoredRelief?.diagnostics || [])
        .map((item) => item.message)
        .filter(Boolean),
    );
  if (region.part?.status === 'blocked' && region.part.message)
    messages.push(region.part.message);
  return [...new Set(messages)].join('；');
}

function labelForAttachment(view, target) {
  if (target.kind === 'output') {
    const region = (view.regions || []).find(
      (item) =>
        item.outputRef?.kind === 'output' &&
        creationCellKey(item.outputRef) === creationCellKey(target),
    );
    return region ? region.name : `输出：${creationCellKey(target)}`;
  }
  const object = view.creation?.creation?.objects?.find(
    (item) => item.id === target.id,
  );
  return object ? object.name : `节点：${target.id}`;
}

function thicknessFor(region, layerHeightMM) {
  const thickness = region.authoredRelief.value.thickness;
  const resolved = resolveThicknessMM(thickness, layerHeightMM);
  if (region.authoredRelief.value.placement.kind !== 'layer')
    return {
      heightMM: resolved.mm,
      ...(resolved.layers ? { heightLayers: resolved.layers } : {}),
    };
  const heightLayers =
    resolved.layers ??
    requestedPrintCount({ heightMM: resolved.mm }, layerHeightMM);
  return {
    heightMM: resolved.mm,
    heightLayers,
  };
}

function projectFeature(view, region) {
  const relief = region.authoredRelief.value;
  const thickness = thicknessFor(region, view.layerHeightMM);
  const attachment =
    relief.placement.kind === 'attached'
      ? attachmentToken(relief.placement.target)
      : null;
  if (relief.placement.kind === 'attached' && !attachment)
    throw Error('依附目标无效');
  const base =
    relief.placement.kind === 'free'
      ? relief.placement.zMM
      : relief.placement.kind === 'attached'
        ? relief.placement.offsetMM
        : relief.placement.offsetMM;
  return {
    id: region.id,
    name: region.reliefName ?? region.objectName ?? region.name,
    regionId: region.id,
    partId: region.part.id,
    mode: relief.mode,
    // The former Model panel stores a cut's top; canonical placement stores
    // its bottom. Attached offsets follow the same convention.
    zMM: relief.mode === 'cut' ? base + thickness.heightMM : base,
    ...thickness,
    attachId: attachment || '',
    enabled: relief.enabled,
    color: region.color,
    ...(attachment
      ? { attachmentLabel: labelForAttachment(view, relief.placement.target) }
      : {}),
  };
}

/**
 * Read-only compatibility DTO for the established Model panel. Its regions
 * are evaluated outputs, never a reconstructed V1 model recipe.
 */
export function projectModelPanel(view) {
  if (!view || !Array.isArray(view.regions))
    throw Error('模型面板需要当前区域视图');
  if (!finite(view.geometrySettings?.curveToleranceMM))
    throw Error('模型面板缺少曲线公差');
  if (!finite(view.layerHeightMM) || view.layerHeightMM <= 0)
    throw Error('模型面板缺少有效层高');
  const regions = view.regions.map((region) => ({
    id: region.id,
    name: region.name,
    color: region.color,
    geometry: clone(region.geometry),
    areaMM2: region.areaMM2,
    components: region.components,
    holes: region.holes,
    ...(diagnosticsFor(region) ? { error: diagnosticsFor(region) } : {}),
  }));
  const features = [];
  for (const region of view.regions) {
    const relief = region.authoredRelief;
    // A blocked conflict is a diagnostic, never a made-up V1 feature.
    if (relief?.status !== 'ready') continue;
    if (!region.reliefDefined && !relief.value.enabled) continue;
    if (region.part?.status !== 'ready') continue;
    try {
      features.push(projectFeature(view, region));
    } catch (error) {
      const projected = regions.find((item) => item.id === region.id);
      projected.error = [projected.error, error.message]
        .filter(Boolean)
        .join('；');
    }
  }
  return freeze({
    model: {
      version: 1,
      toleranceMM: view.geometrySettings.curveToleranceMM,
      manufacturingMM: view.cleanupRadiusMM ?? 0,
      slicerTemplate: clone(view.slicerTemplate),
      regions: view.regions.map((region) => ({
        id: region.id,
        name: region.name,
        color: region.color,
        kind: 'output',
        visible: region.visible !== false,
      })),
      features,
      parts: clone(view.parts || []),
    },
    regions,
  });
}

function requiredRegion(view, id) {
  if (typeof id !== 'string' || !id) throw Error('体块 ID 无效');
  const matches = view?.regions?.filter((region) => region.id === id) || [];
  if (matches.length !== 1) throw Error('体块区域已失效或身份冲突');
  const region = matches[0];
  if (region.authoredRelief?.status !== 'ready')
    throw Error('体块属性存在冲突，需先解决');
  return region;
}

function currentBase(placement) {
  if (placement.kind === 'free') return placement.zMM;
  if (placement.kind === 'attached' || placement.kind === 'layer')
    return placement.offsetMM;
  throw Error('体块放置方式无效');
}

function samePlacement(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function targetForAttachId(view, regionId, attachId) {
  if (attachId === '') return null;
  if (typeof attachId !== 'string' || !attachId) throw Error('依附对象无效');
  if (attachId.startsWith('node:')) {
    const id = attachId.slice('node:'.length);
    if (
      !id ||
      !(view.creation?.creation?.objects || []).some((item) => item.id === id)
    )
      throw Error('依附节点已失效');
    return { kind: 'node', id };
  }
  const matches = (view.regions || []).filter((item) => item.id === attachId);
  if (matches.length !== 1 || matches[0].outputRef?.kind !== 'output')
    throw Error('依附体块已失效');
  if (attachId === regionId) throw Error('体块不能依附自身');
  return clone(matches[0].outputRef);
}

function nextThickness(changes, placement, layerHeightMM) {
  const hasMM = has(changes, 'heightMM');
  const hasLayers = has(changes, 'heightLayers');
  if (!hasMM && !hasLayers) return null;
  if (hasMM && hasLayers) throw Error('厚度只能指定 mm 或打印层数');
  if (hasMM && (!finite(changes.heightMM) || changes.heightMM <= 0))
    throw Error('厚度必须为正数');
  if (
    hasLayers &&
    (!Number.isInteger(changes.heightLayers) || changes.heightLayers <= 0)
  )
    throw Error('厚度必须为正整数打印层数');
  if (placement.kind === 'layer') {
    const count = requestedPrintCount(changes, layerHeightMM);
    return {
      resolved: resolveThicknessMM({ kind: 'layers', count }, layerHeightMM),
      value: { kind: 'layers', count },
    };
  }
  const value = hasMM
    ? { kind: 'mm', value: changes.heightMM }
    : { kind: 'layers', count: changes.heightLayers };
  return { resolved: resolveThicknessMM(value, layerHeightMM), value };
}

/** Compile legacy panel edits into a sparse canonical relief patch. */
export function compileModelFeatureChange(view, id, changes) {
  const region = requiredRegion(view, id);
  if (!changes || typeof changes !== 'object' || Array.isArray(changes))
    throw Error('体块属性变更无效');
  const allowed = new Set([
    'enabled',
    'mode',
    'heightMM',
    'heightLayers',
    'zMM',
    'attachId',
    'regionId',
  ]);
  for (const key of Object.keys(changes)) {
    if (!allowed.has(key)) throw Error(`体块属性尚未适配：${key}`);
    if (key === 'regionId' && changes.regionId !== id)
      throw Error('更换来源面需要专用命令');
  }
  const relief = region.authoredRelief.value;
  const placement = relief.placement;
  const h = view.layerHeightMM;
  if (!finite(h) || h <= 0) throw Error('层高无效');
  if (has(changes, 'enabled') && typeof changes.enabled !== 'boolean')
    throw Error('启用状态无效');
  if (has(changes, 'mode') && !['add', 'cut', 'through'].includes(changes.mode))
    throw Error('体块用途无效');
  const independentZ = has(changes, 'zMM') && !has(changes, 'mode');
  // The established mode selector submits its displayed Z together with the
  // mode. Preserve that coordinate outside print layers; layer placement owns
  // Z, so its incidental selector value remains irrelevant.
  const suppliedModeZ =
    has(changes, 'zMM') && has(changes, 'mode') && placement.kind !== 'layer';
  const writesZ = independentZ || suppliedModeZ;
  if (writesZ && !finite(changes.zMM)) throw Error('体块起始高度无效');
  if (placement.kind === 'layer' && (independentZ || has(changes, 'attachId')))
    throw Error('打印分层已接管起始高度，请在所属堆叠层中调整');

  const patch = {};
  if (has(changes, 'enabled') && changes.enabled !== relief.enabled)
    patch.enabled = changes.enabled;
  const nextMode = has(changes, 'mode') ? changes.mode : relief.mode;
  if (nextMode !== relief.mode) patch.mode = nextMode;

  const currentThickness = resolveThicknessMM(relief.thickness, h);
  const next = nextThickness(changes, placement, h);
  if (next && JSON.stringify(next.value) !== JSON.stringify(relief.thickness))
    patch.thickness = next.value;
  const nextMM = next?.resolved.mm ?? currentThickness.mm;

  const attachmentChanged = has(changes, 'attachId');
  let nextPlacement = placement;
  if (attachmentChanged) {
    const target = targetForAttachId(view, id, changes.attachId);
    nextPlacement = target
      ? { kind: 'attached', target, offsetMM: currentBase(placement) }
      : { kind: 'free', zMM: currentBase(placement) };
  }
  if (writesZ) {
    const base = changes.zMM - (nextMode === 'cut' ? nextMM : 0);
    nextPlacement =
      nextPlacement.kind === 'attached'
        ? { ...nextPlacement, offsetMM: base }
        : { kind: 'free', zMM: base };
  } else if (
    next &&
    placement.kind !== 'layer' &&
    relief.mode === 'cut' &&
    nextMode === 'cut'
  ) {
    // Change cut depth by moving its canonical bottom, retaining the legacy
    // panel's top/start coordinate. This is equally true for an attachment.
    const base = currentBase(placement) + currentThickness.mm - nextMM;
    nextPlacement =
      nextPlacement.kind === 'attached'
        ? { ...nextPlacement, offsetMM: base }
        : { kind: 'free', zMM: base };
  }
  if (!samePlacement(nextPlacement, placement)) patch.placement = nextPlacement;
  return { regionIds: [id], changes: patch };
}
