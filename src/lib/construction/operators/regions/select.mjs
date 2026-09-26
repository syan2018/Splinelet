import { readGeometry } from '../../../region-engine.mjs';
import { outputIdentity } from '../../output-identity.mjs';
import { resolveRegionDefinitions } from '../../region-definitions.mjs';
import { unionSelectedRegions } from './declarative.mjs';
import { transformPoint } from '../../../scene/transforms.mjs';

/** Author-declared points in the input frame. No nearest cell, previous result,
 * area ranking or tolerance search participates in this predicate. */
export const regionSelectOperator = {
  type: 'region-select',
  inputPorts: { input: { domain: 'regions', min: 1, max: 1 } },
  outputPorts: { regions: { domain: 'regions' } },
  validateParams(params) {
    if (
      Object.keys(params).some(
        (key) => !['anchors', 'merge', 'coverage'].includes(key),
      ) ||
      params.merge !== 'union' ||
      params.coverage !== 'one-per-anchor' ||
      !Array.isArray(params.anchors) ||
      !params.anchors.length ||
      params.anchors.some(
        (point) =>
          !Array.isArray(point) ||
          point.length !== 2 ||
          point.some((n) => !Number.isFinite(n)),
      )
    )
      return '区域选择需要明确的局部坐标锚点、one-per-anchor 条件与 union 合并策略';
    return true;
  },
  dependencies: () => ['settings:geometry'],
  copy: (operator) => structuredClone(operator),
  rebase(operator, { transform }) {
    const next = structuredClone(operator);
    next.params.anchors = next.params.anchors.map((point) =>
      transformPoint(transform, point),
    );
    return next;
  },
  evaluate({ document, ownerNodeId, operator, inputs }) {
    const input = inputs.input[0];
    const dependencies = input.dependencies || [];
    const regions = input.value?.regions || [];
    const geometries = regions.map((region) => readGeometry(region.geometry));
    const chosen = new Map();
    const diagnostics = [];
    for (const [index, anchor] of operator.params.anchors.entries()) {
      const point = readGeometry({ type: 'Point', coordinates: anchor });
      const matches = regions.filter((_, i) => geometries[i].contains(point));
      if (matches.length !== 1)
        diagnostics.push({
          code: matches.length
            ? 'selection-anchor-ambiguous'
            : 'selection-anchor-missing',
          severity: 'error',
          operatorId: operator.id,
          anchorIndex: index,
          message: `选择锚点 ${index + 1} 必须位于一个输入区域内部，当前命中 ${matches.length} 个；请调整锚点或输入`,
        });
      else chosen.set(outputIdentity(matches[0].ref), matches[0]);
    }
    if (diagnostics.length)
      return {
        regions: {
          domain: 'regions',
          status: 'blocked',
          dependencies,
          diagnostics,
        },
      };
    const candidate = unionSelectedRegions(
      [...chosen.values()],
      document.geometrySettings,
    );
    const stage = resolveRegionDefinitions(
      document,
      ownerNodeId,
      operator.id,
      candidate ? [candidate] : [],
      { dependencies },
    );
    // Evaluation-local claims let an explicit disjoint collector detect two
    // property groups selecting the same cell after a topology change.
    for (const region of stage.value.regions)
      region.selectionClaims = [...chosen.keys()];
    return { regions: stage };
  },
};
