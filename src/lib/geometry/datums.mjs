import { resolveScalar } from './parameters.mjs';
import {
  transformPoint,
  transformVector,
  worldMatrix,
} from '../scene/transforms.mjs';

const unique = (values) => [...new Set(values)];
const diagnostic = (kind, message, ref) => ({
  severity: 'error',
  kind,
  ...(ref && { ref }),
  message,
});
const blocked = (item, dependencies = []) => ({
  status: 'blocked',
  value: null,
  diagnostics: [item],
  dependencies: unique(dependencies),
});
const ready = (value, dependencies) => ({
  status: 'ready',
  value,
  diagnostics: [],
  dependencies: unique(dependencies),
});

const scalarPair = (document, pair) => {
  if (!Array.isArray(pair) || pair.length !== 2)
    return blocked(diagnostic('invalid-datum', 'Datum 坐标必须含两个 Scalar'));
  const left = resolveScalar(document, pair[0]);
  if (left.status !== 'ready') return left;
  const right = resolveScalar(document, pair[1]);
  if (right.status !== 'ready')
    return {
      ...right,
      dependencies: unique([...left.dependencies, ...right.dependencies]),
    };
  return ready(
    [left.value, right.value],
    [...left.dependencies, ...right.dependencies],
  );
};

function localDatum(document, datumId) {
  const datum = document?.datums?.[datumId];
  const dependencies = [`datum:${datumId}`];
  if (!datum)
    return blocked(
      diagnostic('unresolved-reference', `Datum 不存在：${datumId}`, {
        kind: 'datum',
        id: datumId,
      }),
      dependencies,
    );
  if (datum.ownerNodeId !== null && !document?.nodes?.[datum.ownerNodeId])
    return blocked(
      diagnostic(
        'unresolved-reference',
        `Datum owner 不存在：${datum.ownerNodeId}`,
        {
          kind: 'node',
          id: datum.ownerNodeId,
        },
      ),
      dependencies,
    );
  if (datum.kind === 'point') {
    const position = scalarPair(document, datum.position);
    if (position.status !== 'ready')
      return {
        ...position,
        dependencies: unique([...dependencies, ...position.dependencies]),
      };
    return ready(
      {
        kind: 'point',
        ownerNodeId: datum.ownerNodeId,
        position: position.value,
      },
      [...dependencies, ...position.dependencies],
    );
  }
  if (datum.kind !== 'axis')
    return blocked(
      diagnostic('invalid-datum', `未知 Datum 类型：${datum.kind}`),
      dependencies,
    );
  const origin = scalarPair(document, datum.origin);
  if (origin.status !== 'ready')
    return {
      ...origin,
      dependencies: unique([...dependencies, ...origin.dependencies]),
    };
  const angle = resolveScalar(document, datum.angleRad);
  if (angle.status !== 'ready')
    return {
      ...angle,
      dependencies: unique([
        ...dependencies,
        ...origin.dependencies,
        ...angle.dependencies,
      ]),
    };
  return ready(
    {
      kind: 'axis',
      ownerNodeId: datum.ownerNodeId,
      origin: origin.value,
      angleRad: angle.value,
      direction: [Math.cos(angle.value), Math.sin(angle.value)],
    },
    [...dependencies, ...origin.dependencies, ...angle.dependencies],
  );
}

/** Resolves persisted Datum coordinates in their declared owner-local frame. */
export function resolveDatum(document, datumId) {
  return localDatum(document, datumId);
}

/** Resolves a Datum in world space while retaining its declared owner identity. */
export function resolveDatumWorld(document, datumId) {
  const result = localDatum(document, datumId);
  if (result.status !== 'ready' || result.value.ownerNodeId === null)
    return result;
  const ownerNodeId = result.value.ownerNodeId;
  try {
    const matrix = worldMatrix(document, ownerNodeId);
    const value =
      result.value.kind === 'point'
        ? {
            ...result.value,
            position: transformPoint(matrix, result.value.position),
          }
        : {
            ...result.value,
            origin: transformPoint(matrix, result.value.origin),
            direction: transformVector(matrix, result.value.direction),
          };
    return ready(value, [...result.dependencies, `node:${ownerNodeId}:world`]);
  } catch (error) {
    return blocked(
      diagnostic(
        'invalid-frame',
        error instanceof Error ? error.message : 'Datum 世界坐标无法解算',
      ),
      [...result.dependencies, `node:${ownerNodeId}:world`],
    );
  }
}
