/**
 * Public API 5 contract shared by the Node host and browser registrations.
 * This module intentionally has no React or TypeScript imports so the API can
 * be exercised from the unit-test host without loading the Studio UI.
 */
export const V4_AGENT_API_VERSION = '5.0';

export const V4_AGENT_CORE_ACTIONS = Object.freeze([
  'capabilities.get',
  'document.get',
  'legacy.read',
  'authoring.run',
  'preview.begin',
  'preview.update',
  'preview.commit',
  'preview.cancel',
  'undo',
  'redo',
]);

export const V4_AGENT_OPTIONAL_ACTIONS = Object.freeze({
  selection: 'selection.get',
  evaluation: 'evaluation.request',
  export: 'export.run',
});

/**
 * Returns only actions reachable from the supplied host. Optional actions
 * must never be advertised merely because another host implementation has
 * them.
 */
export function v4AgentActionNames({
  selectionRead = false,
  evaluation = false,
  exportAvailable = false,
} = {}) {
  return [
    ...V4_AGENT_CORE_ACTIONS,
    ...(selectionRead ? [V4_AGENT_OPTIONAL_ACTIONS.selection] : []),
    ...(evaluation ? [V4_AGENT_OPTIONAL_ACTIONS.evaluation] : []),
    ...(exportAvailable ? [V4_AGENT_OPTIONAL_ACTIONS.export] : []),
  ];
}

export function v4AgentCapabilityMetadata({
  documentVersion = 5,
  selectionRead = false,
  evaluationDomains = [],
  evaluationAvailable = evaluationDomains.length > 0,
  exports = [],
  authoringActions = [],
} = {}) {
  const exportAvailable = exports.length > 0;
  return Object.freeze({
    apiVersion: V4_AGENT_API_VERSION,
    documentVersion,
    units: 'mm',
    actions: v4AgentActionNames({
      selectionRead,
      evaluation: evaluationAvailable,
      exportAvailable,
    }),
    authoringActions: [...authoringActions],
    evaluationDomains: [...evaluationDomains],
    exports: [...exports],
    selectionRead,
    previewWrites: true,
    preparedWrites: false,
    legacy: {
      readProjection: true,
      stableRefsOnly: true,
      write: false,
    },
  });
}
