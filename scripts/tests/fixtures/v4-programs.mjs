import { createDocument } from '../../../src/lib/document/schema.mjs';

export function repeatedRingDocument() {
  let sequence = 0;
  const document = createDocument({ idFactory: () => `fixture-${++sequence}` });
  document.nodes.shape = {
    id: 'shape',
    name: '重复纹样',
    kind: 'shape',
    parentId: null,
    order: 0,
    pose: { translationMM: [0, 0], rotationRad: 0 },
    visible: true,
    locked: false,
    programId: 'program',
  };
  const sketch = {
    id: 'sketch',
    ownerNodeId: 'shape',
    vertices: {},
    edges: {},
    paths: {},
  };
  for (const [id, radius] of [
    ['outer', 10],
    ['inner', 5],
  ]) {
    for (const [suffix, position] of [
      ['a', [radius, 0]],
      ['b', [radius / Math.sqrt(2), radius / Math.sqrt(2)]],
    ])
      sketch.vertices[`${id}-${String(suffix)}`] = {
        id: `${id}-${String(suffix)}`,
        position: { kind: 'free', value: position },
      };
    sketch.edges[`${id}-edge`] = {
      id: `${id}-edge`,
      startVertexId: `${id}-a`,
      endVertexId: `${id}-b`,
      startHandle: { kind: 'free', vector: [0, 0] },
      endHandle: { kind: 'free', vector: [0, 0] },
    };
    sketch.paths[`${id}-path`] = {
      id: `${id}-path`,
      name: id,
      edges: [{ edgeId: `${id}-edge`, reversed: false }],
      visible: true,
    };
  }
  document.sketches.sketch = sketch;
  const port = (id, domain = 'curves') => ({
    kind: 'port',
    ownerNodeId: 'shape',
    operatorId: id,
    port: domain,
    domain,
  });
  const input = (id) => ({
    ...port(id),
    space: 'local-result',
    transform: [1, 0, 0, 1, 0, 0],
  });
  const operator = (id, type, from, params) => ({
    id,
    type,
    name: id,
    enabled: true,
    inputs: from
      ? { input: [input(from)] }
      : {
          paths: [
            {
              kind: 'sketch',
              sketchId: 'sketch',
              pathIds: ['outer-path', 'inner-path'],
            },
          ],
        },
    params,
  });
  const endpoint = (edgeId, end, mirror, index) => ({
    edgeEnd: { kind: 'edge-end', sketchId: 'sketch', edgeId, end },
    instances: [{ operatorId: 'mirror', index: mirror }],
    selector: { operatorId: 'array', index, wrap: true },
  });
  const connections = ['outer-edge', 'inner-edge'].flatMap((edgeId) => [
    {
      a: endpoint(edgeId, 'end', 0, 'each'),
      b: endpoint(edgeId, 'end', 1, 'each'),
    },
    {
      a: endpoint(edgeId, 'start', 1, 'each'),
      b: endpoint(edgeId, 'start', 0, 'next'),
    },
  ]);
  document.programs.program = {
    id: 'program',
    ownerNodeId: 'shape',
    operators: {
      source: operator('source', 'source', null, {}),
      mirror: operator('mirror', 'curve-mirror', 'source', {
        center: [0, 0],
        angleRad: Math.PI / 4,
      }),
      array: operator('array', 'curve-array', 'mirror', {
        center: [0, 0],
        angleRad: Math.PI / 2,
        count: 4,
      }),
      join: operator('join', 'join', 'array', { connections }),
      fill: operator('fill', 'fill', 'join', { rule: 'even-odd' }),
    },
    outputs: { curves: port('join'), regions: port('fill', 'regions') },
  };
  return document;
}
