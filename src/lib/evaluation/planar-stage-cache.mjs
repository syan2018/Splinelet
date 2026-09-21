import {
  defaultConstructionRegistry,
  evaluatePlanar,
} from '../construction/document-evaluation.mjs';
import { validateDocument } from '../document/schema.mjs';
import { worldMatrix } from '../scene/transforms.mjs';

// Deliberately narrower than general incremental evaluation: only built-in,
// construction without datum/relation resolution may ignore unrelated poses.
const poseIndependent = (document) =>
  !Object.keys(document.datums).length &&
  !Object.keys(document.relations).length &&
  Object.values(document.programs).every((program) =>
    Object.values(program.operators).every((operator) =>
      defaultConstructionRegistry.get(operator.type),
    ),
  );

/** One retained local stage, never a history of revisions or geometry results. */
export function createPlanarStageCache() {
  let previous = null;
  return {
    evaluate(document, options = {}) {
      if (
        options.registry ||
        options.resolveSketch ||
        options.resolveScalar ||
        options.resolveDatum ||
        options.resolveRelation
      ) {
        previous = null;
        return evaluatePlanar(document, options);
      }
      // Cache hits must not bypass schema/pose validation.
      validateDocument(document);
      if (!poseIndependent(document)) {
        previous = null;
        return evaluatePlanar(document, options);
      }
      const worldOwners = new Set();
      for (const program of Object.values(document.programs))
        for (const operator of Object.values(program.operators))
          for (const ref of Object.values(operator.inputs).flat())
            if (ref.kind === 'port' && ref.space === 'world-result') {
              worldOwners.add(program.ownerNodeId);
              worldOwners.add(ref.ownerNodeId);
            }
      let worldFrames;
      try {
        worldFrames = [...worldOwners]
          .sort((a, b) => a.localeCompare(b))
          .map((id) => [id, worldMatrix(document, id)]);
      } catch {
        // Invalid references belong to the normal evaluator's diagnostics.
        previous = null;
        return evaluatePlanar(document, options);
      }
      const key = JSON.stringify({
        document: {
          ...document,
          nodes: Object.fromEntries(
            Object.entries(document.nodes).map(([id, node]) => [
              id,
              { ...node, pose: null },
            ]),
          ),
        },
        requestedDomains: options.requestedDomains,
        worldFrames,
      });
      if (previous?.key === key) return previous.planar;
      const planar = evaluatePlanar(document, options);
      previous = { key, planar };
      return planar;
    },
  };
}
