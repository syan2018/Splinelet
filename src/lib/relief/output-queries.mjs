import { createOutputRefIndex } from '../construction/output-identity.mjs';

/** Explicitly scoped to one synchronous evaluation/projection of a document.
 * Command drafts must create fresh queries after any edit. Never stored in DTOs. */
export function createOutputQueries(document) {
  const appearance = createOutputRefIndex(
    Object.values(document.appearances?.overrides || {}),
    (item) => item.target,
  );
  const relief = createOutputRefIndex(
    Object.values(document.reliefDefinitions?.overrides || {}),
    (item) => item.target,
  );
  const presentation = createOutputRefIndex(
    Object.values(document.regionPresentations?.overrides || {}),
    (item) => item.target,
  );
  const parts = Object.values(document.manufacturing?.assignments || {});
  const outputs = createOutputRefIndex(
    parts.filter((item) => item.target.kind === 'output'),
    (item) => item.target,
  );
  const nodes = new Map();
  for (const item of parts) {
    if (item.target.kind !== 'node') continue;
    if (!nodes.has(item.target.id)) nodes.set(item.target.id, []);
    nodes.get(item.target.id).push(item);
  }
  const excluded = document.manufacturing?.excluded || [];
  const excludedNodes = new Set(
    excluded.filter((ref) => ref.kind === 'node').map((ref) => ref.id),
  );
  const excludedOutputs = createOutputRefIndex(
    excluded.filter((ref) => ref.kind === 'output'),
  );
  return Object.freeze({
    appearance: (ref) => appearance.get(ref),
    relief: (ref) => relief.get(ref),
    presentation: (ref) => presentation.get(ref),
    parts: (ref) => outputs.get(ref),
    nodeParts: (id) => [...(nodes.get(id) || [])],
    excluded: (ref) =>
      excludedNodes.has(ref.ownerNodeId) || excludedOutputs.has(ref),
  });
}
