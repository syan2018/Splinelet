export const creationTools: Record<string, any> = {
  creation_inspect: {
    description:
      'Read unified objects, region candidates, divider endpoint diagnostics, applied connections and legacy face closures (with source and feature IDs). Call again after source edits before painting.',
    properties: {},
    readOnly: true,
  },
  creation_focus: {
    description: 'Focus a semantic creation object in the unified tree.',
    properties: { objectId: { type: 'string' } },
    required: ['objectId'],
  },
  creation_select: {
    description:
      'Select current candidate keys for local colour or height editing. Empty list clears local selection.',
    properties: { cellKeys: { type: 'array', items: { type: 'string' } } },
    required: ['cellKeys'],
  },
  creation_command: {
    description:
      'Run one undoable creation command: paint, height, swatch, object, new_object, move_paths, roles, reorder. args uses objectIds or cellKeys for painting/height; paint accepts swatchId or color (#RRGGBB) to change only the selection. Custom colors are created/reused atomically; swatch edits update shared colors globally. Geometry candidates must be current.',
    properties: {
      action: {
        enum: [
          'paint',
          'height',
          'swatch',
          'object',
          'new_object',
          'move_paths',
          'roles',
          'reorder',
          'continue_partition',
          'combine_objects',
          'join',
          'connection',
          'remove_connection',
        ],
      },
      args: { type: 'object' },
      revision: {
        type: 'integer',
        description:
          'Required for paint and height; use the revision returned by creation_inspect.',
      },
    },
    required: ['action', 'args'],
  },
  creation_view: {
    description:
      'Open unified flat or 3D view without changing project geometry.',
    properties: { view: { enum: ['flat', '3d'] } },
    required: ['view'],
  },
  creation_export: {
    description:
      'Return coloured SVG, checked STL or Blender Python from the same work. check returns actual manifold report. Does not download.',
    properties: { format: { enum: ['svg', 'stl', 'blender', 'check'] } },
    required: ['format'],
  },
};
