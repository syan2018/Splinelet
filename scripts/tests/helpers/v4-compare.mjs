import 'jsts/org/locationtech/jts/monkey.js';
import DiscreteHausdorffDistance from 'jsts/org/locationtech/jts/algorithm/distance/DiscreteHausdorffDistance.js';
import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';

const reader = new GeoJSONReader();

// These are intentionally compatibility gates, rather than an accuracy budget
// invented for V4.  See the frozen rationale in fixtures/v4-baseline/manifest.
export const v4ComparisonThresholds = Object.freeze({
  worldCubicMM: 1e-9,
  planarAreaMM2: 0,
  planarBoundaryMM: 0,
  physicalMM: 1e-6,
  volumeAbsoluteMM3: 0.001,
  volumeRelative: 1e-5,
});

const scalarFields = ['thicknessMM', 'zMM'];
const exactOutputFields = [
  'color',
  'mode',
  'heightLayers',
  'layerId',
  'partId',
  'materialId',
  'enabled',
];
const exactBodyFields = ['valid', 'components', 'partId', 'materialId'];
const snapshotArrays = ['worldCubics', 'planar', 'outputs', 'bodies', 'states'];

const same = (a, b) => Object.is(a, b);
const number = (value, path) => {
  if (!Number.isFinite(value)) throw Error(`${path} must be a finite number`);
  return value;
};
const mapBy = (records = [], key, path) => {
  const result = new Map();
  for (const record of records) {
    if (!record || typeof record !== 'object' || !record[key])
      throw Error(`${path} record is missing ${key}`);
    if (result.has(record[key]))
      throw Error(`${path} duplicates ${record[key]}`);
    result.set(record[key], record);
  }
  return result;
};
const point = (value, path) => {
  const x = Array.isArray(value) ? value[0] : value?.x;
  const y = Array.isArray(value) ? value[1] : value?.y;
  return [number(x, `${path}.x`), number(y, `${path}.y`)];
};
const push = (differences, path, expected, actual, extra = {}) =>
  differences.push({ path, expected, actual, ...extra });
const compareRecordSets = (
  expected,
  actual,
  key,
  path,
  differences,
  compare,
) => {
  const before = mapBy(expected, key, `${path}.expected`);
  const after = mapBy(actual, key, `${path}.actual`);
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    if (!before.has(id) || !after.has(id)) {
      push(
        differences,
        `${path}.${id}`,
        Boolean(before.get(id)),
        Boolean(after.get(id)),
      );
      continue;
    }
    compare(before.get(id), after.get(id), `${path}.${id}`);
  }
};
const compareScalar = (differences, path, expected, actual, tolerance) => {
  if (expected === undefined && actual === undefined) return;
  if (expected === undefined || actual === undefined) {
    push(differences, path, expected, actual);
    return;
  }
  const delta = Math.abs(
    number(expected, `${path}.expected`) - number(actual, `${path}.actual`),
  );
  if (delta > tolerance)
    push(differences, path, expected, actual, { delta, tolerance });
};
const geometryMetrics = (expected, actual, path) => {
  if (!expected.geometry || !actual.geometry) return null;
  try {
    const before = reader.read(expected.geometry);
    const after = reader.read(actual.geometry);
    return {
      areaDifferenceMM2: before.symDifference(after).getArea(),
      boundaryDistanceMM: DiscreteHausdorffDistance.distance(
        before.getBoundary(),
        after.getBoundary(),
        0.25,
      ),
    };
  } catch (error) {
    throw Error(`${path}.geometry cannot be compared: ${error.message}`);
  }
};
const required = (record, field, path) => {
  if (record[field] === undefined)
    throw Error(`${path}.${field} is required in a V4 comparison snapshot`);
  return record[field];
};
const integer = (value, path) => {
  if (!Number.isInteger(value) || value < 0)
    throw Error(`${path} must be a non-negative integer`);
  return value;
};
const validateSnapshot = (snapshot, label) => {
  if (!snapshot || typeof snapshot !== 'object')
    throw Error(`${label} must be a V4 comparison snapshot`);
  for (const field of snapshotArrays)
    if (!Array.isArray(snapshot[field]))
      throw Error(`${label}.${field} must be an array`);

  for (const record of snapshot.worldCubics) {
    const id = required(record, 'id', `${label}.worldCubics`);
    if (typeof id !== 'string' || !id)
      throw Error(`${label}.worldCubics.id must be a string`);
    if (
      !Array.isArray(required(record, 'curves', `${label}.worldCubics.${id}`))
    )
      throw Error(`${label}.worldCubics.${id}.curves must be an array`);
  }
  for (const record of snapshot.planar) {
    const id = required(record, 'id', `${label}.planar`);
    if (typeof id !== 'string' || !id)
      throw Error(`${label}.planar.id must be a string`);
    number(
      required(record, 'areaMM2', `${label}.planar.${id}`),
      `${label}.planar.${id}.areaMM2`,
    );
    integer(
      required(record, 'holes', `${label}.planar.${id}`),
      `${label}.planar.${id}.holes`,
    );
    integer(
      required(record, 'components', `${label}.planar.${id}`),
      `${label}.planar.${id}.components`,
    );
    const geometry = required(record, 'geometry', `${label}.planar.${id}`);
    if (!geometry || typeof geometry !== 'object')
      throw Error(`${label}.planar.${id}.geometry must be GeoJSON`);
  }
  for (const record of snapshot.outputs) {
    const id = required(record, 'id', `${label}.outputs`);
    if (typeof id !== 'string' || !id)
      throw Error(`${label}.outputs.id must be a string`);
    for (const field of scalarFields)
      number(
        required(record, field, `${label}.outputs.${id}`),
        `${label}.outputs.${id}.${field}`,
      );
    for (const field of exactOutputFields)
      required(record, field, `${label}.outputs.${id}`);
    if (
      ['color', 'mode', 'layerId', 'partId', 'materialId'].some(
        (field) => typeof record[field] !== 'string',
      )
    )
      throw Error(
        `${label}.outputs.${id} has an invalid identity or style field`,
      );
    integer(record.heightLayers, `${label}.outputs.${id}.heightLayers`);
    if (typeof record.enabled !== 'boolean')
      throw Error(`${label}.outputs.${id}.enabled must be boolean`);
  }
  for (const record of snapshot.bodies) {
    const id = required(record, 'id', `${label}.bodies`);
    if (typeof id !== 'string' || !id)
      throw Error(`${label}.bodies.id must be a string`);
    for (const field of [
      'partId',
      'materialId',
      'valid',
      'components',
      'volumeMM3',
    ])
      required(record, field, `${label}.bodies.${id}`);
    if (
      typeof record.partId !== 'string' ||
      typeof record.materialId !== 'string'
    )
      throw Error(`${label}.bodies.${id} must identify its part and material`);
    if (typeof record.valid !== 'boolean')
      throw Error(`${label}.bodies.${id}.valid must be boolean`);
    integer(record.components, `${label}.bodies.${id}.components`);
    number(record.volumeMM3, `${label}.bodies.${id}.volumeMM3`);
  }
  for (const record of snapshot.states) {
    const id = required(record, 'id', `${label}.states`);
    if (typeof id !== 'string' || !id)
      throw Error(`${label}.states.id must be a string`);
    if (typeof required(record, 'state', `${label}.states.${id}`) !== 'string')
      throw Error(`${label}.states.${id}.state must be a string`);
    const reasonCode = required(record, 'reasonCode', `${label}.states.${id}`);
    if (reasonCode !== null && typeof reasonCode !== 'string')
      throw Error(`${label}.states.${id}.reasonCode must be null or a string`);
    const outputIds = required(record, 'outputIds', `${label}.states.${id}`);
    if (!Array.isArray(outputIds))
      throw Error(`${label}.states.${id}.outputIds must be an array`);
    if (outputIds.some((outputId) => typeof outputId !== 'string' || !outputId))
      throw Error(`${label}.states.${id}.outputIds must contain strings`);
  }
};

/**
 * Compares already-evaluated migration snapshots.  This helper never fills,
 * extrudes, or derives output data: callers supply the old and candidate
 * results.  GeoJSON is used only to measure two supplied planar outputs with
 * the same JSTS kernel that the existing region engine uses.
 */
export function compareV4Snapshots(expected, actual, options = {}) {
  validateSnapshot(expected, 'expected');
  validateSnapshot(actual, 'actual');
  const thresholds = { ...v4ComparisonThresholds, ...options.thresholds };
  for (const [name, value] of Object.entries(thresholds))
    number(value, `thresholds.${name}`);
  const differences = [];

  compareRecordSets(
    expected.worldCubics,
    actual.worldCubics,
    'id',
    'worldCubics',
    differences,
    (before, after, path) => {
      if (!Array.isArray(before.curves) || !Array.isArray(after.curves))
        throw Error(`${path}.curves must be arrays`);
      if (before.curves.length !== after.curves.length) {
        push(
          differences,
          `${path}.curves.length`,
          before.curves.length,
          after.curves.length,
        );
        return;
      }
      before.curves.forEach((curve, curveIndex) => {
        const candidate = after.curves[curveIndex];
        if (
          !Array.isArray(curve) ||
          curve.length !== 4 ||
          !Array.isArray(candidate) ||
          candidate.length !== 4
        )
          throw Error(
            `${path}.curves[${curveIndex}] must contain four cubic control points`,
          );
        curve.forEach((control, controlIndex) => {
          const [beforeX, beforeY] = point(
            control,
            `${path}.curves[${curveIndex}][${controlIndex}]`,
          );
          const [afterX, afterY] = point(
            candidate[controlIndex],
            `${path}.curves[${curveIndex}][${controlIndex}]`,
          );
          compareScalar(
            differences,
            `${path}.curves[${curveIndex}][${controlIndex}].x`,
            beforeX,
            afterX,
            thresholds.worldCubicMM,
          );
          compareScalar(
            differences,
            `${path}.curves[${curveIndex}][${controlIndex}].y`,
            beforeY,
            afterY,
            thresholds.worldCubicMM,
          );
        });
      });
    },
  );

  compareRecordSets(
    expected.planar,
    actual.planar,
    'id',
    'planar',
    differences,
    (before, after, path) => {
      compareScalar(
        differences,
        `${path}.areaMM2`,
        before.areaMM2,
        after.areaMM2,
        thresholds.planarAreaMM2,
      );
      for (const field of ['holes', 'components'])
        if (!same(before[field], after[field]))
          push(differences, `${path}.${field}`, before[field], after[field]);
      if (Boolean(before.geometry) !== Boolean(after.geometry)) {
        push(
          differences,
          `${path}.geometry`,
          Boolean(before.geometry),
          Boolean(after.geometry),
        );
        return;
      }
      const metrics = geometryMetrics(before, after, path);
      if (metrics) {
        if (metrics.areaDifferenceMM2 > thresholds.planarAreaMM2)
          push(
            differences,
            `${path}.geometry.areaDifferenceMM2`,
            0,
            metrics.areaDifferenceMM2,
            {
              tolerance: thresholds.planarAreaMM2,
            },
          );
        if (metrics.boundaryDistanceMM > thresholds.planarBoundaryMM)
          push(
            differences,
            `${path}.geometry.boundaryDistanceMM`,
            0,
            metrics.boundaryDistanceMM,
            {
              tolerance: thresholds.planarBoundaryMM,
            },
          );
      }
    },
  );

  compareRecordSets(
    expected.outputs,
    actual.outputs,
    'id',
    'outputs',
    differences,
    (before, after, path) => {
      for (const field of scalarFields)
        compareScalar(
          differences,
          `${path}.${field}`,
          before[field],
          after[field],
          thresholds.physicalMM,
        );
      for (const field of exactOutputFields)
        if (!same(before[field], after[field]))
          push(differences, `${path}.${field}`, before[field], after[field]);
    },
  );

  compareRecordSets(
    expected.bodies,
    actual.bodies,
    'id',
    'bodies',
    differences,
    (before, after, path) => {
      for (const field of exactBodyFields)
        if (field !== 'partId' && !same(before[field], after[field]))
          push(differences, `${path}.${field}`, before[field], after[field]);
      const expectedVolume = number(
        before.volumeMM3,
        `${path}.volumeMM3.expected`,
      );
      const actualVolume = number(after.volumeMM3, `${path}.volumeMM3.actual`);
      const tolerance = Math.max(
        thresholds.volumeAbsoluteMM3,
        Math.abs(expectedVolume) * thresholds.volumeRelative,
      );
      if (Math.abs(expectedVolume - actualVolume) > tolerance)
        push(differences, `${path}.volumeMM3`, expectedVolume, actualVolume, {
          delta: Math.abs(expectedVolume - actualVolume),
          tolerance,
        });
    },
  );

  compareRecordSets(
    expected.states,
    actual.states,
    'id',
    'states',
    differences,
    (before, after, path) => {
      for (const field of ['state', 'reasonCode', 'outputIds']) {
        const expectedValue = Array.isArray(before[field])
          ? JSON.stringify(before[field])
          : before[field];
        const actualValue = Array.isArray(after[field])
          ? JSON.stringify(after[field])
          : after[field];
        if (!same(expectedValue, actualValue))
          push(differences, `${path}.${field}`, before[field], after[field]);
      }
    },
  );

  return differences;
}

export function assertV4SnapshotsEqual(expected, actual, options) {
  const differences = compareV4Snapshots(expected, actual, options);
  if (differences.length) {
    const error = Error(
      `V4 migration snapshot differs:\n${JSON.stringify(differences, null, 2)}`,
    );
    error.differences = differences;
    throw error;
  }
}
