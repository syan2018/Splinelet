import type { ToolCatalog } from './tool-schema';

export const creationTools: ToolCatalog = {
  creation_inspect: {
    description:
      'Read unified objects, creation.printStack (ordered bottom-to-top manufacturing layers), printLevels (resolved slice counts and mm bounds; blocked levels have null bounds), pipelineStatus, surfaceGraphs, surfaceGraphCandidates, live cells, modifierStatus, modifierBaseCells, curvePreviews (exact model-mm cubic controls and junctions for each source/mirror/array/fill-input stage, retained even when fill fails), divider diagnostics and face closures. Cells include printLayerId and heightLayers when printing is enabled. Objects include modifiers and nested sources[featureId]. Waits up to 30 seconds for the latest committed evaluation used by editing/export, including pending React updates. Call again after edits before selecting targets or painting.',
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
    // Print parameters are documented alongside the modifier commands below.
    // Modifier parameters are documented here as well as in docs/modifiers.md,
    // so an agent can operate the stack from tool discovery alone.
    properties: {
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
          'move_paths',
          'roles',
          'reorder',
          'continue_partition',
          'combine_objects',
          'join',
          'connection',
          'remove_connection',
          'closure_boundary',
          'rebuild_surfaces',
          'modifier_truncate',
          'modifier_add',
          'modifier_update',
          'modifier_remove',
          'modifier_move',
        ],
      },
      args: {
        type: 'object',
        description:
          'Print commands: print_enable {layerHeightMM,confirm:true} converts old heights/attachments into one generic stack layer; only confirm after the user accepts this conversion. print_settings {layerHeightMM} keeps integer counts while changing physical dimensions. print_layer_add {name?}; print_layer_rename {layerId,name}; print_layer_move {layerId,direction:1|-1} moves up/down physically; print_layer_remove {layerId} requires an empty layer. print_assign {objectIds,layerId} changes whole-object membership. height uses {objectIds|cellKeys,heightLayers} in printing mode; counts must be integers. All upper levels follow lower maximum printable thickness. rebuild_surfaces uses {objectId,confirm:true}; only invoke after the user accepts the affected output changes. modifier_truncate uses {objectId,modifierId,confirm:true} and removes that step plus downstream steps with their styles. Modifier commands use objectId and optional sourceFeatureId for a nested source stack. modifier_add: type boolean|split|offset|radial_array|curve_mirror|curve_array|fill, name?, operation difference|union|intersection, input {kind:path|region|object,id,projection?:surface|outline}, targets {kind:all} or {kind:selected,refs:inputOptions[].ref}, or current cellKeys; offset uses distanceMM, split uses joinMM. radial_array uses count (integer 1..64, includes original), angleDeg (step -360..360, positive counterclockwise), centerMM {x,y} in image-centered Y-up millimeters; no input operand. Defaults: 4, 90, {x:0,y:0}. Each target surface repeats with holes and its style; overlapping copies union. Source splines remain unchanged. Put holes before the array to repeat them. modifier_update: modifierId and changes {name,enabled,operation,input,targets,distanceMM,joinMM,count,angleDeg,centerMM}, or cellKeys. modifier_move: modifierId with direction -1/+1 or beforeId (null moves last). modifier_remove: modifierId. curve_mirror and curve_array operate on the entire independent object guide-path collection BEFORE fill, never on surfaces; targets must be all. curve_mirror uses angleDeg (axis measured CCW from model +X) and centerMM, defaults 90 and origin. curve_array uses the same count/angleDeg/centerMM as radial_array but transforms exact Bezier curves. fill uses joinMM (default 0.001, range 0..1), welds derived endpoints and uses even-odd closed-loop filling; dangling, branched, crossing or self-intersecting contours fail without adding straight caps. Fill creates surfaces in the same style/height/export pipeline. Inspect pipelines for typed stage order and modifierStatus inputCurveCount/outputCurveCount/closedLoops. Read modifierStatus errors and refreshed inputOptions after each change. Object inputs reference final evaluated faces; cyclic references fail.',
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
