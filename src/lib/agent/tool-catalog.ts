import type { ToolCatalog } from '../tool-schema';
import {
  V4_AGENT_CORE_ACTIONS,
  V4_AGENT_OPTIONAL_ACTIONS,
} from './contract.mjs';

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

/**
 * Compatibility calls that remain public while clients migrate to API 5.
 * They use their historical coordinates and payloads; writes are explicitly
 * marked so Studio can require and remove expectedRevision before forwarding
 * to the old handler.
 */
export const legacyAgentTools: ToolCatalog = {
  state: {
    description:
      'Read image dimensions, paths, tool, selections, view and workspace state.',
    properties: {},
    readOnly: true,
  },
  detect_candidates: {
    description:
      'Generate numbered image corner candidates and display them on the canvas. Coordinates use original-image pixels.',
    properties: {
      limit: { type: 'number' },
      spacing: { type: 'number' },
      region: { type: 'object' },
    },
  },
  create_path: {
    description:
      'Trace image-pixel points or candidate IDs into cubic source paths. preview=true stages a candidate for review.',
    properties: {
      points: {
        type: 'array',
        items: {
          oneOf: [
            { type: 'string' },
            {
              type: 'object',
              properties: { x: { type: 'number' }, y: { type: 'number' } },
              required: ['x', 'y'],
            },
          ],
        },
      },
      name: { type: 'string' },
      closed: { type: 'boolean' },
      preview: { type: 'boolean' },
      mode: { enum: ['ink', 'edge', 'manual'] },
      tolerance: { type: 'number' },
      corridor: { type: 'number' },
      snap: { type: 'boolean' },
    },
    required: ['points'],
    compatibilityWrite: true,
  },
  resume_path: {
    description: 'Resume an existing open source path from start or end.',
    properties: {
      pathId: { type: 'string' },
      end: { enum: ['start', 'end'] },
    },
    required: ['pathId', 'end'],
    compatibilityWrite: true,
  },
  add_anchor: {
    description: 'Add one original-image-pixel anchor to the active drawing.',
    properties: {
      position: {
        type: 'object',
        properties: { x: { type: 'number' }, y: { type: 'number' } },
        required: ['x', 'y'],
      },
      mode: { enum: ['ink', 'edge', 'manual'] },
      snap: { type: 'boolean' },
    },
    required: ['position'],
    compatibilityWrite: true,
  },
  finish_path: {
    description: 'Finish active drawing and publish a valid pending divider.',
    properties: {},
    compatibilityWrite: true,
  },
  close_path: {
    description: 'Close the active path with one cubic.',
    properties: {
      mode: { enum: ['ink', 'edge', 'manual'] },
      snap: { type: 'boolean' },
    },
    compatibilityWrite: true,
  },
  commit_preview: {
    description: 'Commit the staged compatibility source path.',
    properties: {},
    compatibilityWrite: true,
  },
  discard_preview: {
    description: 'Discard the staged compatibility source path.',
    properties: {},
  },
  refit_path: {
    description: 'Request refitting confirmation for one source path.',
    properties: { id: { type: 'string' } },
    compatibilityWrite: true,
  },
  set_node_mode: {
    description: 'Set a source node to corner, smooth, or symmetric.',
    properties: {
      pathId: { type: 'string' },
      nodeIndex: { type: 'integer' },
      mode: { enum: ['corner', 'smooth', 'symmetric'] },
    },
    required: ['pathId', 'nodeIndex', 'mode'],
    compatibilityWrite: true,
  },
  manage_group: {
    description:
      'Manage path Collections only: create, rename, assign, change visibility, or dissolve them.',
    properties: {
      action: { enum: ['create', 'rename', 'assign', 'visibility', 'delete'] },
      id: { type: 'string' },
      name: { type: 'string' },
      pathIds: { type: 'array', items: { type: 'string' } },
      visible: { type: 'boolean' },
    },
    required: ['action'],
    compatibilityWrite: true,
  },
  move_path: {
    description: 'Move one path into a Collection or before another path.',
    properties: {
      pathId: { type: 'string' },
      groupId: { type: 'string' },
      beforeId: { type: 'string' },
    },
    required: ['pathId'],
    compatibilityWrite: true,
  },
  select_paths: {
    description: 'Select source paths by ID; an empty list clears selection.',
    properties: { pathIds: { type: 'array', items: { type: 'string' } } },
    required: ['pathIds'],
  },
  move_paths: {
    description:
      'Move source paths while preserving their relative tree order.',
    properties: {
      pathIds: { type: 'array', items: { type: 'string' } },
      groupId: { type: 'string' },
      targetId: { type: 'string' },
      after: { type: 'boolean' },
    },
    required: ['pathIds'],
    compatibilityWrite: true,
  },
  merge_paths: {
    description: 'Join two open source splines at selected endpoints.',
    properties: {
      firstId: { type: 'string' },
      firstEnd: { enum: ['start', 'end'] },
      secondId: { type: 'string' },
      secondEnd: { enum: ['start', 'end'] },
    },
    required: ['firstId', 'firstEnd', 'secondId', 'secondEnd'],
    compatibilityWrite: true,
  },
  straighten_span: {
    description: 'Replace one source cubic with a straight cubic.',
    properties: { pathId: { type: 'string' }, curve: { type: 'integer' } },
    required: ['pathId'],
    compatibilityWrite: true,
  },
  select_node: {
    description: 'Select a source anchor by zero-based nodeIndex.',
    properties: { pathId: { type: 'string' }, nodeIndex: { type: 'integer' } },
    required: ['pathId', 'nodeIndex'],
  },
  delete_node: {
    description: 'Delete one source anchor and merge its affected spans.',
    properties: { pathId: { type: 'string' }, nodeIndex: { type: 'integer' } },
    required: ['pathId', 'nodeIndex'],
    compatibilityWrite: true,
  },
  get_project: {
    description: 'Read complete editable legacy source geometry.',
    properties: {},
    readOnly: true,
  },
  inspect_geometry: {
    description:
      'Inspect visible source paths for gaps and sampled self intersections.',
    properties: {},
    readOnly: true,
  },
  set_point: {
    description: 'Edit a cubic control handle in original-image pixels.',
    properties: {
      pathId: { type: 'string' },
      curve: { type: 'integer' },
      point: { enum: [1, 2] },
      position: { type: 'object' },
    },
    required: ['pathId', 'curve', 'point', 'position'],
    compatibilityWrite: true,
  },
  export: {
    description: 'Return SVG, Blender Python, or a complete .spl project copy.',
    properties: { format: { enum: ['svg', 'blender', 'json'] } },
    required: ['format'],
    readOnly: true,
  },
  load_project: {
    description:
      'Load a legacy project object or complete .spl base64 container.',
    properties: {
      project: { type: 'object' },
      base64: { type: 'string' },
      filename: { type: 'string' },
    },
    compatibilityWrite: true,
  },
  set_view: {
    description: 'Set source view coordinates or fit the current paths.',
    properties: {
      x: { type: 'number' },
      y: { type: 'number' },
      scale: { type: 'number' },
      fit: { type: 'boolean' },
    },
  },
  select_path: {
    description: 'Select one source path by ID.',
    properties: { id: { type: 'string' } },
    required: ['id'],
  },
  set_candidates_visible: {
    description: 'Show or hide generated source candidates.',
    properties: { visible: { type: 'boolean' } },
    required: ['visible'],
  },
};

const v4DeclaredActions = new Set(Object.keys(v4AgentTools));
for (const action of [
  ...V4_AGENT_CORE_ACTIONS,
  ...Object.values(V4_AGENT_OPTIONAL_ACTIONS),
])
  if (!v4DeclaredActions.has(action))
    throw Error(`API 5 contract action lacks a tool definition: ${action}`);

/**
 * Sole Studio registration boundary. Callers combine capability-specific tool
 * catalogs here, then use the resulting entries for schema, descriptions,
 * readonly hints and compatibility revision protection.
 */
export function createStudioAgentTools({
  modelTools = {},
  creationTools = {},
  splineTools = {},
}: {
  modelTools?: ToolCatalog;
  creationTools?: ToolCatalog;
  splineTools?: ToolCatalog;
} = {}): ToolCatalog {
  const tools: ToolCatalog = { ...v4AgentTools, ...legacyAgentTools };
  for (const [name, definition] of Object.entries(modelTools))
    tools[name] =
      !definition.readOnly && name !== 'set_workspace'
        ? { ...definition, compatibilityWrite: true }
        : definition;
  return { ...tools, ...creationTools, ...splineTools };
}
