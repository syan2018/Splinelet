import type { ToolCatalog, ToolProperty } from './tool-schema';

const id: ToolProperty = { type: 'string' },
  ids: ToolProperty = { type: 'array', items: id },
  number: ToolProperty = { type: 'number' };
export const modelTools: ToolCatalog = {
  set_workspace: {
    description:
      'Switch between editable Bezier sources, derived 2D faces, and 3D relief. Does not modify geometry.',
    properties: { mode: { enum: ['trace', 'faces', 'relief'] } },
    required: ['mode'],
  },
  inspect_model: {
    description:
      'Read the model definitions and recomputed regions, including GeoJSON in millimeters, areas, holes, source errors, and interior selection points.',
    properties: {},
    readOnly: true,
  },
  preview_region: {
    description:
      'Preview a source path face, open-curve split, union/difference/intersection, paired-curve face or widened stroke. Returns numbered candidates and proposed endpoint connectors for visual review. Does not alter Bezier nodes or save faces. Spatial coordinates in the result are millimeters, centered on the image with Y upwards.',
    properties: {
      kind: {
        enum: [
          'path',
          'split',
          'union',
          'difference',
          'intersection',
          'between',
          'stroke',
        ],
      },
      pathId: id,
      pathIds: ids,
      baseId: id,
      a: id,
      b: id,
      joinMM: number,
      widthMM: number,
      close: { type: 'boolean' },
      repair: { type: 'boolean' },
    },
    required: ['kind'],
  },
  commit_region_preview: {
    description:
      'Create faces from zero-based candidate indices after visual review. One undo operation; split faces retain a source reference and interior point. Requires a current preview.',
    properties: {
      indices: { type: 'array', items: { type: 'integer', minimum: 0 } },
      name: id,
    },
    required: ['indices'],
  },
  discard_region_preview: {
    description:
      'Cancel the current face preview without changing the project.',
    properties: {},
  },
  select_regions: {
    description: 'Select existing face IDs; empty array clears face selection.',
    properties: { regionIds: ids },
    required: ['regionIds'],
  },
  create_relief: {
    description:
      'Add extrusion/cut features to selected face IDs. Dimensions are mm. Add features grow upwards from zMM; cuts grow downwards; through cuts span the current part. attachId references the top of another enabled additive feature in the same part.',
    properties: {
      regionIds: ids,
      partId: id,
      mode: { enum: ['add', 'cut', 'through'] },
      zMM: number,
      heightMM: number,
      heightLayers: {
        type: 'integer',
        minimum: 1,
        description:
          'Use integer slice counts when creation.printStack is enabled; stack membership controls Z.',
      },
      attachId: id,
    },
    required: ['regionIds'],
  },
  set_relief: {
    description:
      'Update an existing relief feature. Changes propagate through top-face attachments and can be undone.',
    properties: {
      id,
      changes: {
        type: 'object',
        properties: {
          name: id,
          regionId: id,
          partId: id,
          mode: { enum: ['add', 'cut', 'through'] },
          zMM: number,
          heightMM: number,
          heightLayers: { type: 'integer', minimum: 1 },
          attachId: id,
          enabled: { type: 'boolean' },
          color: id,
        },
        additionalProperties: false,
      },
    },
    required: ['id', 'changes'],
  },
  set_model_options: {
    description:
      'Set source-curve sampling precision in mm and optional manufacturing cleanup radius. Only derived geometry changes.',
    properties: {
      toleranceMM: { type: 'number', minimum: 0.001, maximum: 0.2 },
      manufacturingMM: { type: 'number', minimum: 0, maximum: 0.2 },
    },
  },
  create_part: {
    description:
      'Create an independent printable part. Features in different parts are not unioned or cut together.',
    properties: { name: id },
  },
  select_part: {
    description: 'Select the part to preview and export.',
    properties: { id },
    required: ['id'],
  },
  delete_model_object: {
    description:
      'Delete faces or features. If downstream objects depend on them, opens a confirmation dialog and does not delete until the user confirms. One undo operation.',
    properties: { kind: { enum: ['region', 'feature'] }, ids },
    required: ['kind', 'ids'],
  },
  validate_part: {
    description:
      'Compute a part and check oriented watertight edges, degeneracies, connected components, dimensions and volume. Does not test printer-specific wall thickness.',
    properties: { partId: id },
    readOnly: true,
  },
  get_relief_mesh: {
    description:
      'Return the computed part mesh as flat positions (mm) and triangle indices, plus the geometry validation report.',
    properties: { partId: id },
    readOnly: true,
  },
  export_model: {
    description:
      'Return 3MF as base64 ZIP with separate material solids, derived face SVG, Blender Python with source curves, or legacy STL mesh data. 3MF preserves millimeter dimensions and placement; 3mf (alias 3mf-generic) is printer-independent without machine settings; 3mf-bambu explicitly requires model.slicerTemplate from a saved Bambu project. Physical AMS mapping is chosen in the slicer. No download is triggered.',
    properties: {
      format: {
        enum: ['3mf', '3mf-generic', '3mf-bambu', 'svg', 'blender', 'stl'],
      },
    },
    required: ['format'],
    readOnly: true,
  },
};
