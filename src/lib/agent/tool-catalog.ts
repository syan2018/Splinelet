import type { ToolCatalog } from '../tool-schema';

const revision = { expectedRevision: { type: 'integer' as const } };
const identity = {
  epoch: { type: 'string' as const },
  revision: { type: 'integer' as const },
};
export const v4AgentTools: ToolCatalog = {
  'capabilities.get': {
    description:
      'Discover API 5 actions, stable-reference authoring commands, evaluation domains and export formats.',
    properties: {},
    readOnly: true,
  },
  'document.get': {
    description:
      'Read the authoritative V4 document, epoch and revision. Use this observed revision for subsequent writes.',
    properties: {},
    readOnly: true,
  },
  'selection.get': {
    description:
      'Read the original workspace selection as stable node/path/output references, including scene Groups.',
    properties: {},
    readOnly: true,
  },
  'authoring.run': {
    description:
      'Execute one canonical authoring command as one undo transaction. Uses millimetres, explicit local references and the observed expectedRevision. Discover command kinds via capabilities.get.',
    properties: { ...revision, action: { type: 'object' } },
    required: ['expectedRevision', 'action'],
  },
  'evaluation.request': {
    description:
      'Evaluate the exact current epoch/revision. Blocked aggregate stages retain current independent branches for preview, but never permit incomplete export.',
    properties: {
      ...identity,
      domains: { type: 'array', items: { type: 'string' } },
    },
    required: ['epoch', 'revision', 'domains'],
    readOnly: true,
  },
  'export.run': {
    description:
      'Export a complete committed stage at the given epoch/revision; returns a typed-byte artifact. Rejects incomplete bodies and active previews.',
    properties: {
      ...identity,
      format: { type: 'string' },
      stage: { type: 'string' },
      options: { type: 'object' },
    },
    required: ['epoch', 'revision', 'format', 'stage'],
    readOnly: true,
  },
  'preview.begin': {
    description: 'Begin a canonical edit preview at the observed revision.',
    properties: revision,
    required: ['expectedRevision'],
  },
  'preview.update': {
    description:
      'Apply an authoring action to the current preview without committing history.',
    properties: {
      ...revision,
      previewId: { type: 'string' },
      action: { type: 'object' },
    },
    required: ['expectedRevision', 'previewId', 'action'],
  },
  'preview.commit': {
    description: 'Commit the canonical preview as one undo transaction.',
    properties: { ...revision, previewId: { type: 'string' } },
    required: ['expectedRevision', 'previewId'],
  },
  'preview.cancel': {
    description:
      'Cancel the canonical preview, preserving the committed document.',
    properties: { ...revision, previewId: { type: 'string' } },
    required: ['expectedRevision', 'previewId'],
  },
  'legacy.read': {
    description:
      'Read a compatibility projection addressed by stable references. Does not accept legacy index writes.',
    properties: identity,
    required: ['epoch', 'revision'],
    readOnly: true,
  },
  undo: {
    description: 'Undo one committed transaction at the observed revision.',
    properties: revision,
    required: ['expectedRevision'],
  },
  redo: {
    description: 'Redo one transaction at the observed revision.',
    properties: revision,
    required: ['expectedRevision'],
  },
};
