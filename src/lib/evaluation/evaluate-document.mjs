import { evaluatePlanar } from '../construction/document-evaluation.mjs';
import { evaluatePostPlan } from './post-evaluation-plan.mjs';
import { evaluateExportViews } from '../export/views.mjs';
import { createOutputQueries } from '../relief/output-queries.mjs';

const wants = (requested, ...domains) =>
  domains.some((domain) => requested.has(domain));
const published = (planar, domain) =>
  Object.entries(planar.published)
    .filter(([, result]) => result.domain === domain)
    .map(([key, result]) => ({
      ...result,
      ownerNodeId: key.slice(0, -(domain.length + 1)),
    }));

/** Pure V4 domain assembly. It only passes immutable stage DTOs between services. */
export async function evaluateDocument(document, options = {}) {
  const requested = new Set(
    options.requestedDomains || [
      'curves',
      'regions',
      'appearance',
      'relief',
      'placed-relief',
      'cleanup',
      'bodies',
    ],
  );
  const needRegions = wants(
    requested,
    'regions',
    'appearance',
    'relief',
    'placed-relief',
    'cleanup',
    'bodies',
  );
  const planar = (options.planarStageCache?.evaluate || evaluatePlanar)(
    document,
    {
      registry: options.registry,
      requestedDomains: [
        ...(wants(requested, 'curves') ? ['curves'] : []),
        ...(needRegions ? ['regions'] : []),
      ],
      resolveSketch: options.resolveSketch,
      resolveScalar: options.resolveScalar,
      resolveDatum: options.resolveDatum,
      resolveRelation: options.resolveRelation,
    },
  );
  const curves = wants(requested, 'curves') ? published(planar, 'curves') : [];
  const regions = needRegions ? published(planar, 'regions') : [];
  const queries = createOutputQueries(document);
  const post = await evaluatePostPlan(document, planar, {
    requestedDomains: [...requested],
    postStageCache: options.postStageCache,
    solidOptions: options.solidOptions,
    worldMatrices: options.worldMatrices,
    queries,
  });
  return Object.freeze({
    ...evaluateExportViews(document, {
      source: requested.has('curves'),
      regions,
      queries,
    }),
    curves,
    regions,
    appearance: post.appearance,
    relief: post.relief,
    placedRelief: post.placedRelief,
    cleanup: post.cleanup,
    bodies: post.bodies,
    postPlan: post,
    planar,
  });
}
