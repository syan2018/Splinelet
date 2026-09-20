import { resolveThicknessMM } from './dimensions.mjs';
import { isExcluded, partForRelief } from './parts.mjs';
import { outputIdentity, sameOutputRef } from '../relief/appearance.mjs';
import {
  aggregateReliefBranches,
  readyReliefMembers,
} from '../evaluation/branch-stages.mjs';

const diag = (kind, message, ref) => ({
  severity: 'error',
  kind,
  ...(ref && { ref }),
  message,
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

/** Resolve each dependency once. Branch results are current preview data; only
 * the complete aggregate is eligible for solid construction and export. */
export function resolveManufacturing(
  document,
  reliefResult,
  worldMatrices = {},
) {
  if (!reliefResult || reliefResult.domain !== 'relief')
    return aggregateReliefBranches('placed-relief', [
      {
        status: 'blocked',
        diagnostics: [diag('invalid-input', '需要 ReliefSet')],
      },
    ]);
  const branches = reliefResult.branches || [reliefResult];
  const failures = new Map();
  const ownerBranches = new Map();
  const excludedOwner = (id) =>
    document.manufacturing.excluded.some(
      (ref) => ref.kind === 'node' && ref.id === id,
    );
  for (const branch of branches) {
    const id = branch.ownerNodeId || null;
    if (excludedOwner(id)) continue;
    ownerBranches.set(id, branch);
    if (branch.status === 'blocked') failures.set(id, branch.diagnostics || []);
  }
  const members = [];
  const errors = new Map();
  for (const item of readyReliefMembers(reliefResult)) {
    if (isExcluded(document, item)) continue;
    const key = outputIdentity(item.ref);
    const member = { ...structuredClone(item) };
    members.push(member);
    try {
      member.partId = partForRelief(document, item);
      Object.assign(
        member,
        resolveThicknessMM(
          item.thickness,
          document.manufacturing.layerHeightMM,
        ),
      );
      if (
        item.placement.kind === 'layer' &&
        !document.manufacturing.layerOrder.includes(item.placement.layerId)
      )
        throw Error(`打印层不存在：${item.placement.layerId}`);
    } catch (error) {
      errors.set(key, [diag('invalid-reference', error.message, item.ref)]);
    }
  }
  // A failed source may hide an enabled layer contribution. Such a layer's top
  // is unknown, even though its base and unrelated free placements remain known.
  const uncertainLayers = new Set();
  for (const owner of failures.keys()) {
    const fallback = document.reliefDefinitions?.defaults?.[owner] || {};
    const values = [
      fallback,
      ...Object.values(document.reliefDefinitions?.overrides || {})
        .filter(
          (item) =>
            item.target.ownerNodeId === owner &&
            !item.suppressed &&
            !isExcluded(document, { ref: item.target }),
        )
        .map((item) => ({ ...fallback, ...item.value })),
    ];
    for (const value of values)
      if (
        value.enabled &&
        value.mode === 'add' &&
        value.placement?.kind === 'layer'
      )
        uncertainLayers.add(value.placement.layerId);
  }
  const placed = new Map();
  const active = new Set();
  const layerBases = new Map();
  const layerBase = (id) => {
    if (layerBases.has(id)) return layerBases.get(id);
    const index = document.manufacturing.layerOrder.indexOf(id);
    if (index < 0) throw Error(`打印层不存在：${id}`);
    if (index === 0) {
      layerBases.set(id, 0);
      return 0;
    }
    const previous = document.manufacturing.layerOrder[index - 1];
    const base = layerBase(previous);
    if (uncertainLayers.has(previous) || failures.has(null))
      throw Error(`前序打印层 ${previous} 有未求出的成员`);
    const contributors = members.filter(
      (item) =>
        item.mode === 'add' &&
        item.placement.kind === 'layer' &&
        item.placement.layerId === previous,
    );
    const top = Math.max(base, ...contributors.map((item) => place(item).zTop));
    layerBases.set(id, top);
    return top;
  };
  const place = (item) => {
    const key = outputIdentity(item.ref);
    if (placed.has(key)) return placed.get(key);
    if (errors.has(key)) throw Error(errors.get(key)[0].message);
    if (active.has(key)) throw Error('依附目标存在循环');
    active.add(key);
    try {
      const placement = item.placement;
      let base;
      if (placement.kind === 'free') base = placement.zMM;
      else if (placement.kind === 'layer')
        base = layerBase(placement.layerId) + placement.offsetMM;
      else {
        const target = placement.target;
        const owner = target.kind === 'output' ? target.ownerNodeId : target.id;
        if (failures.has(owner) || failures.has(null))
          throw Error('依附目标的区域或浮雕求值被阻断');
        const candidates = members.filter(
          (other) =>
            outputIdentity(other.ref) !== key &&
            other.partId === item.partId &&
            other.enabled &&
            other.mode === 'add' &&
            (target.kind === 'output'
              ? sameOutputRef(other.ref, target)
              : other.ref.ownerNodeId === target.id),
        );
        if (!candidates.length) throw Error('依附目标缺失、被排除或跨 Part');
        // A node target means its complete top, not the first available member.
        base =
          Math.max(...candidates.map((other) => place(other).zTop)) +
          placement.offsetMM;
      }
      const value = {
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
      };
      placed.set(key, value);
      return value;
    } catch (error) {
      errors.set(key, [diag('placement-blocked', error.message, item.ref)]);
      throw error;
    } finally {
      active.delete(key);
    }
  };
  for (const item of members) {
    try {
      place(item);
    } catch {
      /* Recorded on this output, propagated only to dependents. */
    }
  }
  const owners = new Set([
    ...ownerBranches.keys(),
    ...members.map((item) => item.ref.ownerNodeId),
  ]);
  return aggregateReliefBranches(
    'placed-relief',
    [...owners].map((ownerNodeId) => {
      const own = members.filter(
        (item) => item.ref.ownerNodeId === ownerNodeId,
      );
      const diagnostics = [
        ...(failures.get(ownerNodeId) || []),
        ...own.flatMap((item) => errors.get(outputIdentity(item.ref)) || []),
      ];
      const blocked = failures.has(ownerNodeId) || diagnostics.length > 0;
      const reliefs = own.flatMap((item) =>
        placed.has(outputIdentity(item.ref))
          ? [placed.get(outputIdentity(item.ref))]
          : [],
      );
      const absent = ownerBranches.get(ownerNodeId)?.status === 'absent';
      return {
        ownerNodeId,
        domain: 'placed-relief',
        status: blocked
          ? 'blocked'
          : reliefs.length
            ? 'ready'
            : absent
              ? 'absent'
              : 'empty',
        ...(!blocked &&
          !absent && {
            value: {
              reliefs,
              provenance: reliefs.map((item) => ({
                ref: item.ref,
                sources: item.ref.lineage,
              })),
            },
          }),
        diagnostics,
        dependencies:
          ownerBranches.get(ownerNodeId)?.dependencies ||
          reliefResult.dependencies ||
          [],
      };
    }),
  );
}
