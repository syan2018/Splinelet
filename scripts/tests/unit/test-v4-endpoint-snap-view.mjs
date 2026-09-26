import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { evaluatePlanar } from '../../../src/lib/construction/document-evaluation.mjs';
import { projectEndpointSnapContext } from '../../../src/lib/editor/endpoint-snap-view.mjs';
import { projectSourceView } from '../../../src/lib/editor/source-view.mjs';

let serial = 0;
const idFactory = () => `endpoint-view-${++serial}`;
const editor = createEditorSession(createDocument({ version: 4, idFactory }), {
  idFactory,
});
const dispatch = (action) =>
  editor.dispatch(createAuthoringCommand(action), {
    expectedRevision: editor.state.revision,
  });
const draw = (points, name) =>
  dispatch({
    kind: 'draw-path',
    points,
    name,
    closed: false,
    ...(Object.keys(editor.state.document.nodes).length
      ? { ownerNodeId: Object.keys(editor.state.document.nodes)[0] }
      : {}),
  });

draw(
  [
    [0, 0],
    [1, 1],
    [3, 2],
  ],
  '母线',
);
draw(
  [
    [6, 4],
    [8, 5],
  ],
  '相接 A',
);
draw(
  [
    [6, 4],
    [9, 5],
  ],
  '相接 B',
);
draw(
  [
    [12, 4],
    [13, 5],
  ],
  '隐藏',
);
const ownerId = Object.keys(editor.state.document.nodes)[0];
editor.dispatch(
  (document) => {
    document.nodes[ownerId].pose = {
      translationMM: [20, 10],
      rotationRad: Math.PI / 2,
    };
    const hidden = Object.values(document.sketches)
      .flatMap((sketch) => Object.values(sketch.paths))
      .find((path) => path.name === '隐藏');
    hidden.visible = false;
    return { document };
  },
  { expectedRevision: editor.state.revision },
);
dispatch({
  kind: 'mirror-curves',
  ownerNodeId: ownerId,
  center: [0, 0],
  angleRad: 0,
});
dispatch({
  kind: 'repeat-curves',
  ownerNodeId: ownerId,
  center: [0, 0],
  angleRad: Math.PI / 2,
  count: 3,
});

const frame = { width: 1000, height: 600, widthMM: 100 };
const view = projectSourceView(editor.state.document, frame);
const mother = view.paths.find((path) => path.name === '母线');
const joined = view.paths.find((path) => path.name === '相接 A');
const hidden = view.paths.find((path) => path.name === '隐藏');
const context = projectEndpointSnapContext(
  editor.state.document,
  view,
  mother.id,
  0,
);
const selfContext = projectEndpointSnapContext(
  editor.state.document,
  view,
  mother.id,
  mother.curves.length,
);

assert.ok(context);
assert.deepEqual(context.origin, mother.start, 'origin stays in source pixels');
assert.ok(Object.isFrozen(context));
assert.ok(Object.isFrozen(context.lines));
assert.ok(Object.isFrozen(context.points));
assert.ok(context.lines.length, 'a real mirror supplies its fixed world axis');
assert.ok(context.lockedId, 'the endpoint on that axis preserves its seam');
assert.ok(
  !selfContext.points.some((target) => target.label.endsWith('· 母线')),
  'the moving source endpoint and all of its derived copies are never targets',
);
assert.ok(
  !context.points.some(
    (target) =>
      Math.abs(target.point.x - hidden.start.x) < 1e-7 &&
      Math.abs(target.point.y - hidden.start.y) < 1e-7,
  ),
  'hidden source paths do not contribute endpoints',
);
assert.ok(
  !context.points.some(
    (target) =>
      Math.abs(target.point.x - joined.start.x) < 1e-7 &&
      Math.abs(target.point.y - joined.start.y) < 1e-7,
  ),
  'coincident source endpoints retain the old branch-prevention rule',
);
assert.equal(
  projectEndpointSnapContext(editor.state.document, view, mother.id, 1),
  null,
  'interior nodes are not endpoint-snap contexts',
);

const blocked = structuredClone(editor.state.document);
const mirror = Object.values(
  blocked.programs[blocked.nodes[ownerId].programId].operators,
).find((operator) => operator.type === 'curve-mirror');
mirror.params = { center: [0, 0] };
assert.deepEqual(
  projectEndpointSnapContext(blocked, view, mother.id, 0).lines,
  [],
  'a blocked published curve branch never leaves stale derived guides',
);

const near = (left, right) =>
  Math.abs(left.x - right.x) < 1e-7 && Math.abs(left.y - right.y) < 1e-7;

// A different source Path can share the same stable Vertex.  It moves with
// this drag too, so it cannot be treated as a stationary endpoint target.
const sharedVertex = structuredClone(editor.state.document);
const motherRef = view.identities.paths[mother.id];
const sharedSketch = sharedVertex.sketches[motherRef.sketchId];
const motherPath = sharedSketch.paths[motherRef.id];
const sharedStart =
  sharedSketch.edges[motherPath.edges[0].edgeId].startVertexId;
sharedSketch.vertices['shared-end'] = {
  id: 'shared-end',
  position: { kind: 'free', value: [4, 4] },
};
sharedSketch.edges['shared-edge'] = {
  id: 'shared-edge',
  startVertexId: sharedStart,
  endVertexId: 'shared-end',
  startHandle: { kind: 'free', vector: [0, 0] },
  endHandle: { kind: 'free', vector: [0, 0] },
};
sharedSketch.paths['shared-path'] = {
  id: 'shared-path',
  name: '共享起点',
  visible: true,
  edges: [{ edgeId: 'shared-edge', reversed: false }],
};
const sharedProgram =
  sharedVertex.programs[sharedVertex.nodes[ownerId].programId];
Object.values(sharedProgram.operators)
  .find((operator) => operator.type === 'source')
  .inputs.paths.find((input) => input.sketchId === sharedSketch.id)
  .pathIds.push('shared-path');
const sharedView = projectSourceView(sharedVertex, frame);
const sharedPath = sharedView.paths.find((path) => path.name === '共享起点');
const sharedContext = projectEndpointSnapContext(
  sharedVertex,
  sharedView,
  mother.id,
  0,
);
assert.ok(
  !sharedContext.points.some((target) => near(target.point, sharedPath.start)),
  'a second Path using the moving source Vertex is excluded by identity',
);

// V4 only expands the current owner.  A second Shape remains a raw source
// target even if its own program is independently evaluable.
const otherOwner = structuredClone(editor.state.document);
otherOwner.nodes['other-shape'] = {
  id: 'other-shape',
  name: '其他部件',
  kind: 'shape',
  parentId: null,
  order: 1,
  pose: { translationMM: [0, 0], rotationRad: 0 },
  visible: true,
  locked: false,
  programId: 'other-program',
};
otherOwner.sketches['other-sketch'] = {
  id: 'other-sketch',
  ownerNodeId: 'other-shape',
  vertices: {
    'other-a': { id: 'other-a', position: { kind: 'free', value: [30, 5] } },
    'other-b': { id: 'other-b', position: { kind: 'free', value: [32, 5] } },
  },
  edges: {
    'other-edge': {
      id: 'other-edge',
      startVertexId: 'other-a',
      endVertexId: 'other-b',
      startHandle: { kind: 'free', vector: [0, 0] },
      endHandle: { kind: 'free', vector: [0, 0] },
    },
  },
  paths: {
    'other-path': {
      id: 'other-path',
      name: '其他源线',
      visible: true,
      edges: [{ edgeId: 'other-edge', reversed: false }],
    },
  },
};
otherOwner.programs['other-program'] = {
  id: 'other-program',
  ownerNodeId: 'other-shape',
  operators: {
    'other-source': {
      id: 'other-source',
      type: 'source',
      name: 'source',
      enabled: true,
      inputs: {
        paths: [
          {
            kind: 'sketch',
            sketchId: 'other-sketch',
            pathIds: ['other-path'],
          },
        ],
      },
      params: {},
    },
    'other-mirror': {
      id: 'other-mirror',
      type: 'curve-mirror',
      name: '其他镜像',
      enabled: true,
      inputs: {
        input: [
          {
            kind: 'port',
            ownerNodeId: 'other-shape',
            operatorId: 'other-source',
            port: 'curves',
            domain: 'curves',
            space: 'local-result',
            transform: [1, 0, 0, 1, 0, 0],
          },
        ],
      },
      params: { center: [0, 0], angleRad: 0 },
    },
  },
  outputs: {
    curves: {
      kind: 'port',
      ownerNodeId: 'other-shape',
      operatorId: 'other-mirror',
      port: 'curves',
      domain: 'curves',
    },
  },
};
const otherView = projectSourceView(otherOwner, frame);
assert.equal(
  evaluatePlanar(otherOwner).published['other-shape:curves'].value.curves
    .length,
  2,
  'the other owner really publishes a mirrored copy',
);
const otherPath = otherView.paths.find((path) => path.name === '其他源线');
const otherContext = projectEndpointSnapContext(
  otherOwner,
  otherView,
  mother.id,
  0,
);
assert.ok(
  otherContext.points.some((target) => near(target.point, otherPath.start)),
  'another owner contributes its raw endpoint without inheriting this owner’s transforms',
);
assert.ok(
  !otherContext.points.some((target) =>
    near(target.point, {
      x: otherPath.start.x,
      y: frame.height - otherPath.start.y,
    }),
  ),
  'another owner’s independently published mirror does not expand the original snap target scope',
);

const joinedDocument = structuredClone(editor.state.document);
const joinedProgram =
  joinedDocument.programs[joinedDocument.nodes[ownerId].programId];
const mirrorOperator = Object.values(joinedProgram.operators).find(
  (operator) => operator.type === 'curve-mirror',
);
const arrayOperator = Object.values(joinedProgram.operators).find(
  (operator) => operator.type === 'curve-array',
);
const joinedA = view.paths.find((path) => path.name === '相接 A');
const joinedB = view.paths.find((path) => path.name === '相接 B');
const joinedEdge = (path) => {
  const edge = view.identities.edges[path.identity.edgeIds[0]];
  return { sketchId: edge.sketchId, edgeId: edge.id };
};
joinedProgram.operators['explicit-join'] = {
  id: 'explicit-join',
  type: 'join',
  name: '显式连接',
  enabled: true,
  inputs: {
    input: [
      {
        kind: 'port',
        ownerNodeId: ownerId,
        operatorId: arrayOperator.id,
        port: 'curves',
        domain: 'curves',
        space: 'local-result',
        transform: [1, 0, 0, 1, 0, 0],
      },
    ],
  },
  params: {
    connections: [
      {
        a: {
          edgeEnd: { kind: 'edge-end', ...joinedEdge(joinedA), end: 'start' },
          instances: [{ operatorId: arrayOperator.id, index: 0 }],
          selector: { operatorId: mirrorOperator.id, index: 0, wrap: false },
        },
        b: {
          edgeEnd: { kind: 'edge-end', ...joinedEdge(joinedB), end: 'start' },
          instances: [{ operatorId: arrayOperator.id, index: 0 }],
          selector: { operatorId: mirrorOperator.id, index: 0, wrap: false },
        },
      },
    ],
  },
};
joinedProgram.outputs.curves = {
  kind: 'port',
  ownerNodeId: ownerId,
  operatorId: 'explicit-join',
  port: 'curves',
  domain: 'curves',
};
assert.equal(
  evaluatePlanar(joinedDocument).published[`${ownerId}:curves`].value.junctions
    .length,
  1,
  'the fixture creates one explicit V4 Join',
);
const joinedContext = projectEndpointSnapContext(
  joinedDocument,
  projectSourceView(joinedDocument, frame),
  mother.id,
  0,
);
assert.ok(
  !joinedContext.points.some((target) => near(target.point, joinedA.start)),
  'an explicit Join raises endpoint degree and prevents snapping to its branch',
);

console.log(
  'PASS V4 endpoint context projects evaluated mirror/array instances, world pose, source visibility, topology degree and immutable pixel DTOs.',
);
