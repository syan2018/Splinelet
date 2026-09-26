import { evaluatePlanar } from '../construction/document-evaluation.mjs';
import { validateDocument } from '../document/schema.mjs';

const customEvaluation = (options) =>
  options.registry ||
  options.resolveSketch ||
  options.resolveScalar ||
  options.resolveDatum ||
  options.resolveRelation;

/**
 * One current entry per built-in operator. Construction owns cache keys and
 * generations, while this adapter limits reuse to the built-in resolver set.
 */
export function createPlanarStageCache() {
  const cache = new Map();
  return {
    evaluate(document, options = {}) {
      // Cache hits must not bypass schema/pose validation.
      validateDocument(document);
      if (customEvaluation(options)) {
        cache.clear();
        return evaluatePlanar(document, options);
      }
      return evaluatePlanar(document, {
        ...options,
        cache,
      });
    },
  };
}
