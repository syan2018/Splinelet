import type { ToolCatalog, ToolProperty } from './tool-schema';

const point: ToolProperty = {
  type: 'object',
  properties: { x: { type: 'number' }, y: { type: 'number' } },
  required: ['x', 'y'],
  additionalProperties: false,
};
const units: ToolProperty = {
  enum: ['image', 'model'],
  description:
    'Default image: original image pixels, top-left origin, Y down. model: mm, image-centred origin, Y up. Handles may extend outside the image.',
};
export const splineTools: ToolCatalog = {
  spline_inspect: {
    description:
      'Read exact editable Bezier nodes (co, handleLeft, handleRight; absolute coordinates). Closed seam appears once. Returns {units,splines:[{id,name,closed,nodes}]}; omitting pathIds reads all. Does not include the reference image.',
    properties: {
      pathIds: { type: 'array', items: { type: 'string' } },
      units,
    },
    readOnly: true,
  },
  spline_apply: {
    description:
      'Atomically create or edit a batch of exact Bezier splines, one undo entry. No tracing, snapping, fitting or image-ready requirement. No id creates; an existing id updates in place, preserving downstream references and ownership. Return {pathIds} in input order. Each node has co and optional absolute handleLeft/handleRight (default co); all supplied nodes use free handles. To move an anchor while keeping its shape, translate its two handles too. Closed seam appears once. Omit nodes on an existing id to transform its geometry. matrix applies in the chosen units before conversion: x=a*x+c*y+e,y=b*x+d*y+f. Use copied inspected nodes without id to duplicate. objectId assigns new paths to an existing creation object; it cannot transfer existing paths. role applies only to new paths: boundary/hole must be closed; hole requires objectId. Use creation_command roles for dividers. Invalid batches leave the whole project unchanged. Follow with creation_inspect before painting or exporting.',
    properties: {
      units,
      objectId: { type: 'string' },
      splines: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            closed: { type: 'boolean' },
            role: { enum: ['boundary', 'hole', 'guide'] },
            matrix: {
              type: 'array',
              items: { type: 'number' },
              description:
                'Six finite numbers [a,b,c,d,e,f]; nonzero determinant.',
            },
            nodes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  co: point,
                  handleLeft: point,
                  handleRight: point,
                },
                required: ['co'],
                additionalProperties: false,
              },
            },
          },
        },
      },
    },
    required: ['splines'],
    compatibilityWrite: true,
  },
};
