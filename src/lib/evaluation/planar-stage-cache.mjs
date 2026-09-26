import { evaluatePlanar } from '../construction/document-evaluation.mjs';
import { validateDocument } from '../document/schema.mjs';

const customEvaluation = (options) =>
  options.registry ||
  options.dependencyValues ||
  options.resolveSketch ||
  options.resolveScalar ||
  options.resolveDatum ||
  options.resolveRelation;

/**
 * One current entry per built-in operator, plus the last complete planar DTO.
 * Construction owns operator keys/generations. This adapter skips unchanged
 * planar assembly for downstream edits and only reuses built-in resolvers.
 */
export function createPlanarStageCache() {
  const cache = new Map();
  let lastKey = null;
  let lastResult = null;
  return {
    evaluate(document, options = {}) {
      // Cache hits must not bypass schema/pose validation.
      validateDocument(document);
      if (customEvaluation(options)) {
        cache.clear();
        lastKey = null;
        lastResult = null;
        return evaluatePlanar(document, options);
      }
      // These three author tables only feed downstream domains. A thickness,
      // color or manufacturing edit must not rebuild the unchanged planar DTO
      // (or change the input identity seen by downstream node caches).
      // Retain every other document field and every supported request option
      // in the guard. Never bypass document validation on a complete hit.
      const {
        appearances: _appearances,
        reliefDefinitions: _reliefDefinitions,
        manufacturing: _manufacturing,
        ...planarInputs
      } = document;
      const key = JSON.stringify([planarInputs, options]);
      if (lastResult && key === lastKey) return lastResult;
      const result = evaluatePlanar(document, {
        ...options,
        cache,
      });
      lastKey = key;
      lastResult = result;
      return result;
    },
  };
}
