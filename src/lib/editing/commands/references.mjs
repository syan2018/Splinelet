import { validateDocument } from '../../document/schema.mjs';

const clone = (value) => structuredClone(value);
const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const own = (value, key) => Object.hasOwn(value, key);
const same = (left, right) =>
  Array.isArray(left) &&
  Array.isArray(right) &&
  left.length === right.length &&
  left.every(
    (value, index) =>
      finite(value) &&
      finite(right[index]) &&
      Math.abs(value - right[index]) <=
        1e-9 * Math.max(1, Math.abs(value), Math.abs(right[index])),
  );

const referenceRef = (id) => ({ kind: 'reference', id });
const referenceOrder = (reference) => reference.order ?? 0;

/** References are painted bottom-to-top. Legacy documents sort predictably. */
export function orderedReferences(document) {
  return Object.values(document.references).sort(
    (left, right) =>
      referenceOrder(left) - referenceOrder(right) ||
      left.id.localeCompare(right.id),
  );
}

const frameMatrix = (frame) => {
  const scale = frame.widthMM / frame.width;
  return [scale, 0, 0, -scale, -frame.widthMM / 2, (frame.height * scale) / 2];
};

/** The explicit role wins. For old documents, recover the calibrated image. */
export function baseReference(document) {
  const references = orderedReferences(document);
  const explicit = references.find((reference) => reference.role === 'base');
  if (explicit) return explicit;
  const eligible = references.filter(
    (reference) => reference.role !== 'overlay',
  );
  if (!document.sourceFrame) return eligible[0];
  const frame = document.sourceFrame;
  const matrix = frameMatrix(frame);
  return eligible.find(
    (reference) =>
      reference.pixelWidth === frame.width &&
      reference.pixelHeight === frame.height &&
      same(reference.pixelToWorld, matrix),
  );
}

const requireFields = (value, fields, label) => {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    throw Error(`${label} 请求字段无效`);
};
const requireId = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw Error(`${label} 无效`);
  return value;
};
const requireReference = (document, id) => {
  requireId(id, 'Reference ID');
  const reference = document.references[id];
  if (!reference) throw Error(`Reference 不存在：${id}`);
  return reference;
};
const allIds = (document) => {
  const values = new Set();
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.id === 'string') values.add(value.id);
    Object.values(value).forEach(visit);
  };
  visit(document);
  return values;
};
const affine = (value) =>
  Array.isArray(value) && value.length === 6 && value.every(finite);
const validName = (value) =>
  typeof value === 'string' && value.trim() && value.length <= 200;
const validatePatch = (patch) => {
  const fields = ['name', 'visible', 'locked', 'opacity', 'pixelToWorld'];
  if (!isRecord(patch) || !Object.keys(patch).length)
    throw Error('Reference.patch 不能为空');
  if (Object.keys(patch).some((key) => !fields.includes(key)))
    throw Error('Reference.patch 含不支持字段');
  if (own(patch, 'name') && !validName(patch.name))
    throw Error('Reference.name 无效');
  if (own(patch, 'visible') && typeof patch.visible !== 'boolean')
    throw Error('Reference.visible 无效');
  if (own(patch, 'locked') && typeof patch.locked !== 'boolean')
    throw Error('Reference.locked 无效');
  if (
    own(patch, 'opacity') &&
    (!finite(patch.opacity) || patch.opacity < 0 || patch.opacity > 1)
  )
    throw Error('Reference.opacity 无效');
  if (own(patch, 'pixelToWorld') && !affine(patch.pixelToWorld))
    throw Error('Reference.pixelToWorld 无效');
};
const normaliseOverlayOrder = (document) => {
  const base = baseReference(document);
  const overlays = orderedReferences(document).filter(
    (reference) => reference.id !== base?.id,
  );
  if (base) base.order = 0;
  overlays.forEach((reference, index) => {
    reference.order = index + 1;
    if (reference.role === undefined) reference.role = 'overlay';
  });
  return { base, overlays };
};
const assetUsed = (document, assetId) =>
  Object.values(document.references).some(
    (reference) => reference.assetId === assetId,
  );

const validateAdd = (document, action) => {
  requireFields(action, ['kind', 'references', 'assets'], 'reference-add');
  if (!Array.isArray(action.references) || !action.references.length)
    throw Error('reference-add 需要至少一个 Reference');
  if (!Array.isArray(action.assets))
    throw Error('reference-add.assets 必须是数组');
  const ids = allIds(document);
  const incomingAssets = new Set();
  for (const asset of action.assets) {
    requireFields(
      asset,
      ['id', 'path', 'mediaType', 'size', 'sha256'],
      'Asset',
    );
    requireId(asset.id, 'Asset ID');
    if (ids.has(asset.id) || incomingAssets.has(asset.id))
      throw Error('Asset ID 重复');
    incomingAssets.add(asset.id);
  }
  const incomingReferences = new Set();
  let explicitBaseCount = 0;
  for (const reference of action.references) {
    requireFields(
      reference,
      [
        'id',
        'assetId',
        'name',
        'pixelWidth',
        'pixelHeight',
        'pixelToWorld',
        'visible',
        'locked',
        'opacity',
        'role',
        'order',
      ],
      'Reference',
    );
    requireId(reference.id, 'Reference ID');
    if (ids.has(reference.id) || incomingReferences.has(reference.id))
      throw Error('Reference ID 重复');
    incomingReferences.add(reference.id);
    if (reference.role === 'base') explicitBaseCount++;
  }
  if (explicitBaseCount > 1 || (explicitBaseCount && baseReference(document)))
    throw Error('工程只能有一张基准参考图');
};

/**
 * Reference-image edits have no geometry side effects. The caller owns image
 * bytes; this command only stores and removes their validated descriptors.
 */
export function createReferenceCommand(request) {
  const action = clone(request);
  return (document) => {
    const next = clone(document);
    validateDocument(next);
    let changedRefs = [];
    if (action?.kind === 'reference-add') {
      validateAdd(next, action);
      const existing = normaliseOverlayOrder(next);
      let nextOrder = existing.overlays.length + 1;
      for (const asset of action.assets) next.assets[asset.id] = clone(asset);
      for (const item of action.references) {
        const reference = clone(item);
        // Additions are overlays unless the caller deliberately creates the
        // one calibrated base image.
        reference.role ||= 'overlay';
        reference.order = reference.role === 'base' ? 0 : nextOrder++;
        next.references[reference.id] = reference;
      }
      const { base, overlays } = normaliseOverlayOrder(next);
      if (base?.role === 'base' && !base.locked)
        throw Error('基准参考图必须保持锁定');
      changedRefs = action.references.map((reference) =>
        referenceRef(reference.id),
      );
      if (overlays.length)
        changedRefs = orderedReferences(next).map((reference) =>
          referenceRef(reference.id),
        );
    } else if (action?.kind === 'reference-update') {
      requireFields(action, ['kind', 'id', 'patch'], 'reference-update');
      const reference = requireReference(next, action.id);
      validatePatch(action.patch);
      const base = baseReference(next);
      const transform = own(action.patch, 'pixelToWorld');
      if (base?.id === reference.id) {
        if (transform || own(action.patch, 'locked'))
          throw Error('基准参考图不能调整变换或锁定状态');
      } else if (reference.locked && transform)
        throw Error('已锁定的参考图不能调整变换');
      Object.assign(reference, clone(action.patch));
      changedRefs = [referenceRef(reference.id)];
    } else if (action?.kind === 'reference-delete') {
      requireFields(action, ['kind', 'id'], 'reference-delete');
      const reference = requireReference(next, action.id);
      if (baseReference(next)?.id === reference.id)
        throw Error('基准参考图不能删除');
      delete next.references[reference.id];
      if (!assetUsed(next, reference.assetId))
        delete next.assets[reference.assetId];
      normaliseOverlayOrder(next);
      changedRefs = [referenceRef(reference.id)];
    } else if (action?.kind === 'reference-duplicate') {
      requireFields(action, ['kind', 'id', 'newId'], 'reference-duplicate');
      const reference = requireReference(next, action.id);
      requireId(action.newId, '新 Reference ID');
      if (allIds(next).has(action.newId)) throw Error('新 Reference ID 重复');
      const { overlays } = normaliseOverlayOrder(next);
      const duplicate = {
        ...clone(reference),
        id: action.newId,
        role: 'overlay',
        order: overlays.length + 1,
      };
      next.references[duplicate.id] = duplicate;
      normaliseOverlayOrder(next);
      changedRefs = [referenceRef(duplicate.id)];
    } else if (action?.kind === 'reference-reorder') {
      requireFields(action, ['kind', 'id', 'direction'], 'reference-reorder');
      const reference = requireReference(next, action.id);
      if (!['up', 'down'].includes(action.direction))
        throw Error('Reference.direction 必须是 up 或 down');
      const { base, overlays } = normaliseOverlayOrder(next);
      if (base?.id === reference.id) throw Error('基准参考图不能调整叠放顺序');
      const index = overlays.findIndex((item) => item.id === reference.id);
      const target = index + (action.direction === 'up' ? 1 : -1);
      if (target >= 0 && target < overlays.length)
        [overlays[index], overlays[target]] = [
          overlays[target],
          overlays[index],
        ];
      overlays.forEach((item, order) => {
        item.order = order + 1;
      });
      changedRefs = overlays.map((item) => referenceRef(item.id));
    } else throw Error(`不支持的 Reference 动作：${action?.kind}`);
    if (
      ['reference-add', 'reference-duplicate'].includes(action.kind) &&
      Object.keys(next.references).length > 32
    )
      throw Error('最多放置 32 张参考图');
    validateDocument(next);
    return { document: next, changedRefs };
  };
}
