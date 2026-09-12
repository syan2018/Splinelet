export const creationTools: Record<string, any> = {
  creation_inspect: {
    description:
      'Read unified objects, live cells, modifierStatus (ordered steps with inputOptions[].ref for stable target selection, affected count, areas and errors), modifierBaseCells, divider diagnostics and face closures. Objects include modifiers and nested sources[featureId]. Call again after edits before selecting targets or painting.',
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
      'Run one undoable creation command. paint/height use objectIds or cellKeys; paint accepts swatchId or color (#RRGGBB). roles uses {objectId,pathIds,role}; it computes the proposed regions before applying and returns {applied,regionCount} or {applied:false,issue}, leaving the project unchanged on failure. closure_boundary uses {objectId,featureId,regionId,boundaryRegionId,joinMM?}; choose a live boundaryOptions ID (null restores straight caps), default joinMM 0.15. It validates the clipped face before applying and never moves source nodes. A divider already used as a band edge retains its existing face; existing_boundary diagnostics explain the closure control. Custom colors are created/reused atomically; swatch edits update shared colors globally. delete_swatch uses {id,replacementId?}; a referenced colour requires a different replacement, with all references remapped atomically and geometry/heights unchanged. At least one swatch must remain. Painting or height changes are blocked for objects with failed geometry.',
    // Modifier parameters are documented here as well as in docs/modifiers.md,
    // so an agent can operate the stack from tool discovery alone.
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
          'closure_boundary',
          'modifier_add',
          'modifier_update',
          'modifier_remove',
          'modifier_move',
        ],
      },
      args: {
        type: 'object',
        description:
          'Modifier commands use objectId and optional sourceFeatureId for a nested source stack. modifier_add: type boolean|split|offset, name?, operation difference|union|intersection, input {kind:path|region|object,id,projection?:surface|outline}, targets {kind:all} or {kind:selected,refs:inputOptions[].ref}, or current cellKeys; offset uses distanceMM, split uses joinMM. modifier_update: modifierId and changes {name,enabled,operation,input,targets,distanceMM,joinMM}, or cellKeys. modifier_move: modifierId with direction -1/+1 or beforeId (null moves last). modifier_remove: modifierId. Read modifierStatus errors and refreshed inputOptions after each change. Object inputs reference final evaluated faces; cyclic references fail.',
      },
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
