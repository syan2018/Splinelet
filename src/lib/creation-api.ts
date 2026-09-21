import type { ToolCatalog } from './tool-schema';

export const creationTools: ToolCatalog = {
  creation_inspect: {
    description:
      'Read the current canonical creation projection: recursive scene tree, Shape objects, exact OutputRef cells, modifierStatus controls/structure, and current derived curve stages. Group nodes own transforms; path collections are separate. Waits for current evaluation. Authored enabled/painted flags remain independent of flatOnly placement failure. No writable legacy modifiers or nested source stacks.',
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
      'Compatibility creation intent using the same V4 dispatcher. expectedRevision must come from document.get; paint/height also require creation_inspect revision. Prefer API 5 authoring.run for new automation. Geometry failures retain diagnostics. Translation/rotation preserve source coordinates; uniform object scaling changes local geometry and spatial operator parameters.',
    // These compatibility intents compile to the same canonical commands.
    // Modifier parameters are documented here as well as in docs/modifiers.md,
    // so an agent can operate the stack from tool discovery alone.
    properties: {
      expectedRevision: { type: 'integer' },
      action: {
        enum: [
          'paint',
          'height',
          'print_enable',
          'print_settings',
          'print_layer_add',
          'print_layer_rename',
          'print_layer_move',
          'print_layer_remove',
          'print_assign',
          'swatch',
          'delete_swatch',
          'object',
          'new_object',
          'scene_transform',
          'scene_group',
          'scene_ungroup',
          'scene_reparent',
          'scene_node',
          'scene_delete',
          'delete_paths',
          'move_paths',
          'roles',
          'reorder',
          'combine_objects',
          'join',
          'connection',
          'modifier_add',
          'modifier_update',
          'modifier_remove',
          'modifier_move',
        ],
      },
      args: {
        type: 'object',
        description:
          'modifier_add supports curve_mirror/curve_array (targets:{kind:all}, centerMM, angleDeg, count), join (explicit connections from modifierAdd.endpoints), and fill (rule:even-odd|non-zero, only when no region output exists). modifier_update edits type-specific parameters including connections/rule; move/remove use the reported structure capabilities. scene_transform {nodeIds,mode:translate|rotate|scale,deltaMM?|angleRad?|factor?,centerMM?} transforms complete groups in one undo step. Rotation/scaling default to the evaluated selection center; scale is a positive uniform factor, keeps relief thickness, and rejects spatial references crossing the selection. scene_group {nodeIds,name?}, scene_ungroup {nodeIds}, scene_reparent {nodeIds,parentId|beforeId}, scene_node {id,changes} operate on scene Nodes, preserving world placement. scene_delete {nodeIds} deletes selected Nodes and descendants; delete_paths {pathIds} deletes source paths using displayed IDs. Both reject locked targets atomically. Legacy manage_group refers only to path Collections.',
      },
      revision: {
        type: 'integer',
        description:
          'Required for paint and height; use the revision returned by creation_inspect.',
      },
    },
    required: ['expectedRevision', 'action', 'args'],
    compatibilityWrite: true,
  },
  creation_view: {
    description:
      'Open unified flat or 3D view without changing project geometry.',
    properties: { view: { enum: ['flat', '3d'] } },
    required: ['view'],
  },
  creation_export: {
    description:
      'Return 3MF (base64 ZIP, mimeType, filename, material/part summaries and mesh report), coloured SVG, or Blender Python. 3MF retains non-overlapping material volumes and placement; 3mf (alias 3mf-generic) is printer-independent without slicer settings. 3mf-bambu explicitly requires model.slicerTemplate from a saved Bambu project and includes extruder assignments, printer/process settings and layer height. Physical AMS mapping is chosen in the slicer. check returns the manifold report. Legacy stl is retained for API compatibility. Does not download.',
    properties: {
      format: {
        enum: [
          '3mf',
          '3mf-generic',
          '3mf-bambu',
          'svg',
          'stl',
          'blender',
          'check',
        ],
      },
    },
    required: ['format'],
  },
};
