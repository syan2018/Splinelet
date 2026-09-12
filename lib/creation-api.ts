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
      'Run one undoable creation command. paint/height use objectIds or cellKeys; paint accepts swatchId or color (#RRGGBB). roles uses {objectId,pathIds,role}; it computes the proposed regions before applying and returns {applied,regionCount} or {applied:false,issue}, leaving the project unchanged on failure. Custom colors are created/reused atomically; swatch edits update shared colors globally. delete_swatch uses {id,replacementId?}; a referenced colour requires a different replacement, with all references remapped atomically and geometry/heights unchanged. At least one swatch must remain. Painting or height changes are blocked for objects with failed geometry.',
    properties: {
      action: {
        enum: [
          'paint',
          'height',
          'swatch',
          'delete_swatch',
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
