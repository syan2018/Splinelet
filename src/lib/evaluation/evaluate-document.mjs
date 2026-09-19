import { evaluatePlanar } from '../construction/document-evaluation.mjs';
import { resolveRelief } from '../relief/resolve.mjs';
import { resolveManufacturing } from '../manufacturing/placement.mjs';
import { worldMatrix } from '../scene/transforms.mjs';
import { buildBodies } from '../solid/bodies.mjs';

const absent = (domain) => ({
  domain,
  status: 'absent',
  diagnostics: [],
  dependencies: [],
});
const wants = (requested, ...domains) =>
  domains.some((domain) => requested.has(domain));
const published = (planar, domain) =>
  Object.values(planar.published).filter((result) => result.domain === domain);

/** Pure V4 domain assembly. It only passes immutable stage DTOs between services. */
export async function evaluateDocument(document, options = {}) {
  const requested = new Set(
    options.requestedDomains || [
      'curves',
      'regions',
      'relief',
      'placed-relief',
      'bodies',
    ],
  );
  const needRegions = wants(
    requested,
    'regions',
    'relief',
    'placed-relief',
    'bodies',
  );
  const planar = evaluatePlanar(document, {
    registry: options.registry,
    requestedDomains: [
      ...(wants(requested, 'curves') ? ['curves'] : []),
      ...(needRegions ? ['regions'] : []),
    ],
    resolveSketch: options.resolveSketch,
    resolveScalar: options.resolveScalar,
    resolveDatum: options.resolveDatum,
    resolveRelation: options.resolveRelation,
  });
  const curves = wants(requested, 'curves') ? published(planar, 'curves') : [];
  const regions = needRegions ? published(planar, 'regions') : [];
  const relief = wants(requested, 'relief', 'placed-relief', 'bodies')
    ? resolveRelief(document, regions)
    : absent('relief');
  const placedRelief = wants(requested, 'placed-relief', 'bodies')
    ? resolveManufacturing(
        document,
        relief,
        options.worldMatrices || ((id) => worldMatrix(document, id)),
      )
    : absent('placed-relief');
  const bodies = requested.has('bodies')
    ? await buildBodies(placedRelief, options.solidOptions)
    : absent('bodies');
  return Object.freeze({
    curves,
    regions,
    relief,
    placedRelief,
    bodies,
    planar,
  });
}
