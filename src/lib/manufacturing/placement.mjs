import { resolveThicknessMM } from './dimensions.mjs';
import { isExcluded, partForRelief } from './parts.mjs';
import { sameOutputRef } from '../relief/appearance.mjs';

const diag = (kind, message, ref) => ({
  severity: 'error',
  kind,
  ...(ref && { ref }),
  message,
});
const result = (status, value, diagnostics, dependencies) => ({
  domain: 'placed-relief',
  status,
  ...(value === undefined ? {} : { value }),
  diagnostics,
  dependencies: [...new Set(dependencies)],
});
const matrixFor = (matrices, id) =>
  typeof matrices === 'function'
    ? matrices(id)
    : matrices?.[id] || [1, 0, 0, 1, 0, 0];
const mapCoordinates = (value, matrix) =>
  Array.isArray(value)
    ? value.length >= 2 &&
      value.every((item, index) => (index < 2 ? Number.isFinite(item) : true))
      ? [
          matrix[0] * value[0] + matrix[2] * value[1] + matrix[4],
          matrix[1] * value[0] + matrix[3] * value[1] + matrix[5],
          ...value.slice(2),
        ]
      : value.map((item) => mapCoordinates(item, matrix))
    : value;

/** Resolves Z and Part only; it never changes scene XY poses or persisted intent. */
export function resolveManufacturing(
  document,
  reliefResult,
  worldMatrices = {},
) {
  if (!reliefResult || reliefResult.domain !== 'relief')
    return result(
      'blocked',
      undefined,
      [diag('invalid-input', '需要 ReliefSet')],
      [],
    );
  if (reliefResult.status === 'absent')
    return result(
      'absent',
      undefined,
      reliefResult.diagnostics || [],
      reliefResult.dependencies || [],
    );
  if (reliefResult.status === 'blocked')
    return result(
      'blocked',
      undefined,
      reliefResult.diagnostics || [],
      reliefResult.dependencies || [],
    );
  if (reliefResult.status === 'empty')
    return result(
      'empty',
      { reliefs: [], provenance: [] },
      reliefResult.diagnostics || [],
      reliefResult.dependencies || [],
    );
  const dependencies = [...(reliefResult.dependencies || [])],
    diagnostics = [],
    raw = reliefResult.value?.reliefs;
  if (!Array.isArray(raw))
    return result(
      'blocked',
      undefined,
      [diag('invalid-input', 'ReliefSet DTO 无效')],
      dependencies,
    );
  let members;
  try {
    members = raw
      .filter((item) => !isExcluded(document, item))
      .map((item) => ({
        ...structuredClone(item),
        partId: partForRelief(document, item),
        ...resolveThicknessMM(
          item.thickness,
          document.manufacturing.layerHeightMM,
        ),
      }));
  } catch (error) {
    return result(
      'blocked',
      undefined,
      [diag('invalid-reference', error.message)],
      dependencies,
    );
  }
  const layers = new Map(
    document.manufacturing.layerOrder.map((id) => [id, []]),
  );
  for (const item of members)
    if (item.placement.kind === 'layer') {
      if (!layers.has(item.placement.layerId))
        return result(
          'blocked',
          undefined,
          [
            diag(
              'unresolved-reference',
              `打印层不存在：${item.placement.layerId}`,
              item.ref,
            ),
          ],
          dependencies,
        );
      layers.get(item.placement.layerId).push(item);
    }
  const bases = new Map();
  let top = 0;
  for (const [id, items] of layers) {
    bases.set(id, top);
    top = Math.max(
      top,
      ...items
        .filter((item) => item.mode === 'add')
        .map((item) => top + item.mm + item.placement.offsetMM),
    );
  }
  const placed = new Map();
  for (const item of members)
    if (item.placement.kind !== 'attached') {
      const base =
        item.placement.kind === 'free'
          ? item.placement.zMM
          : bases.get(item.placement.layerId) + item.placement.offsetMM;
      placed.set(
        item.ref.key +
          JSON.stringify(item.ref.lineage) +
          JSON.stringify(item.ref.instances),
        {
          ...item,
          zBase: base,
          zTop: base + item.mm,
          geometry: {
            ...item.geometry,
            coordinates: mapCoordinates(
              item.geometry.coordinates,
              matrixFor(worldMatrices, item.ref.ownerNodeId),
            ),
          },
        },
      );
    }
  let pending = members.filter((item) => item.placement.kind === 'attached');
  while (pending.length) {
    const next = [];
    let progress = false;
    for (const item of pending) {
      const target = item.placement.target;
      const candidates = [...placed.values()].filter(
        (other) =>
          other.partId === item.partId &&
          other.enabled &&
          other.mode === 'add' &&
          (target.kind === 'output'
            ? sameOutputRef(other.ref, target)
            : other.ref.ownerNodeId === target.id),
      );
      if (!candidates.length) {
        next.push(item);
        continue;
      }
      const base =
        Math.max(...candidates.map((other) => other.zTop)) +
        item.placement.offsetMM;
      placed.set(
        item.ref.key +
          JSON.stringify(item.ref.lineage) +
          JSON.stringify(item.ref.instances),
        {
          ...item,
          zBase: base,
          zTop: base + item.mm,
          geometry: {
            ...item.geometry,
            coordinates: mapCoordinates(
              item.geometry.coordinates,
              matrixFor(worldMatrices, item.ref.ownerNodeId),
            ),
          },
        },
      );
      progress = true;
    }
    if (!progress)
      return result(
        'blocked',
        undefined,
        [diag('attachment-blocked', '依附目标缺失、跨 Part 或存在循环')],
        dependencies,
      );
    pending = next;
  }
  return result(
    placed.size ? 'ready' : 'empty',
    {
      reliefs: [...placed.values()],
      provenance: [...placed.values()].map((item) => ({
        ref: item.ref,
        sources: item.ref.lineage,
      })),
    },
    diagnostics,
    dependencies,
  );
}
