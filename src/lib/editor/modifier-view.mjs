import { worldMatrix, transformPoint } from '../scene/transforms.mjs';
import { effectiveNodeState } from '../scene/hierarchy.mjs';
import { resolveScalar } from '../geometry/parameters.mjs';

const names = {
  'curve-mirror': 'curve_mirror',
  'curve-array': 'curve_array',
  'region-array': 'radial_array',
  offset: 'offset',
  boolean: 'boolean',
};

/** Read the values used by the established modifier controls. Driven values are
 * explicit, never replaced with zero or detached into editable literals.
 */
export function projectModifierControls(document, ownerNodeId, operatorId) {
  const node = document.nodes[ownerNodeId];
  const operator = document.programs[node?.programId]?.operators[operatorId];
  if (node?.kind !== 'shape' || !operator) throw Error('修改器不属于指定部件');
  const values = { name: operator.name, enabled: operator.enabled };
  const editableFields = ['name', 'enabled'];
  const drivenFields = [];
  const diagnostics = [];
  const numeric = (field, value, convert = (number) => number) => {
    const result = resolveScalar(document, value);
    if (result.status === 'ready') values[field] = convert(result.value);
    else
      diagnostics.push(
        ...result.diagnostics.map((item) => ({ ...item, field })),
      );
    if (value === undefined || Number.isFinite(value))
      editableFields.push(field);
    else if (value?.kind === 'parameter' || value?.kind === 'expression')
      drivenFields.push(field);
  };
  const params = operator.params;
  if (operator.type === 'join') {
    values.connections = structuredClone(params.connections);
    editableFields.push('connections');
  }
  if (operator.type === 'fill') {
    values.rule = params.rule;
    editableFields.push('rule');
  }
  if (['curve-mirror', 'curve-array', 'region-array'].includes(operator.type)) {
    const matrix = worldMatrix(document, ownerNodeId);
    const rotation =
      operator.type === 'curve-mirror' ? Math.atan2(matrix[1], matrix[0]) : 0;
    numeric(
      'angleDeg',
      params.angleRad,
      (angle) => ((angle + rotation) * 180) / Math.PI,
    );
    if (Array.isArray(params.center) && params.center.length === 2) {
      const resolved = params.center.map((value) =>
        resolveScalar(document, value),
      );
      if (resolved.every((item) => item.status === 'ready')) {
        const [x, y] = transformPoint(
          matrix,
          resolved.map((item) => item.value),
        );
        values.centerMM = { x, y };
      } else
        diagnostics.push(
          ...resolved.flatMap((item) =>
            item.diagnostics.map((diagnostic) => ({
              ...diagnostic,
              field: 'centerMM',
            })),
          ),
        );
      if (params.center.every(Number.isFinite)) editableFields.push('centerMM');
      else drivenFields.push('centerMM');
    } else {
      diagnostics.push({ field: 'centerMM', message: '中心坐标定义无效' });
      if (params.center === undefined) editableFields.push('centerMM');
    }
    if (operator.type !== 'curve-mirror') numeric('count', params.count);
  } else if (operator.type === 'offset')
    numeric('distanceMM', params.distanceMM);
  else if (operator.type === 'boolean') {
    values.operation = params.operation;
    editableFields.push('operation');
  }
  const locked = effectiveNodeState(document, ownerNodeId).locked;
  if (values.centerMM) Object.freeze(values.centerMM);
  return Object.freeze({
    operatorId,
    ownerNodeId,
    type: names[operator.type] || operator.type,
    values: Object.freeze(values),
    editableFields: Object.freeze(locked ? [] : editableFields),
    drivenFields: Object.freeze(drivenFields),
    diagnostics: Object.freeze(diagnostics.map((item) => Object.freeze(item))),
    locked,
  });
}
