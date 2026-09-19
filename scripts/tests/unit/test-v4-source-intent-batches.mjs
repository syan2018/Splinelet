import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { projectSourceView } from '../../../src/lib/editor/source-view.mjs';
import { createSourceIntent } from '../../../src/lib/editor/source-intents.mjs';

let sequence = 0;
const idFactory = () => `source-batch-${++sequence}`;
const editor = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
const dispatch = (command) =>
  editor.dispatch(command, { expectedRevision: editor.state.revision });
dispatch(
  createAuthoringCommand({
    kind: 'draw-path',
    closed: true,
    points: [
      [0, 0],
      [12, 0],
      [12, 8],
      [0, 8],
    ],
  }),
);
const nodeId = Object.keys(editor.state.document.nodes)[0];
dispatch((document) => {
  document.nodes[nodeId].pose = {
    translationMM: [7, -3],
    rotationRad: Math.PI / 6,
  };
  const sketch = Object.values(document.sketches)[0];
  const path = Object.values(sketch.paths)[0];
  sketch.paths['source-batch-alias'] = {
    id: 'source-batch-alias',
    name: '共享首段',
    edges: [structuredClone(path.edges[0])],
    visible: true,
  };
  return { document, changedRefs: [] };
});

const frame = { width: 960, height: 640, widthMM: 120 };
const view = () => ({
  ...editor.state,
  source: projectSourceView(editor.state.document, frame),
});
const mainPath = (displayed) =>
  displayed.source.paths.find((path) => path.curves.length === 4);
const aliasPath = (displayed) =>
  displayed.source.paths.find((path) => path.id.includes('source-batch-alias'));
const movedPoint = (point, dx, dy) => ({ x: point.x + dx, y: point.y + dy });

const captured = view();
const main = mainPath(captured);
const alias = aliasPath(captured);
assert.equal(main.identity.anchorIds[0], alias.identity.anchorIds[0]);
const baseline = structuredClone(editor.state.document);
const gesture = editor.beginPreview({ expectedRevision: captured.revision });
for (const [dx, dy] of [
  [8, -5],
  [24, 13],
])
  editor.updatePreview(
    createSourceIntent(
      {
        kind: 'move-anchors',
        items: [
          {
            identityId: main.identity.anchorIds[0],
            pixelPoint: movedPoint(main.anchors[0], dx, dy),
          },
          {
            identityId: alias.identity.anchorIds[0],
            pixelPoint: movedPoint(main.anchors[0], dx, dy),
          },
          {
            identityId: main.identity.anchorIds[2],
            pixelPoint: movedPoint(main.anchors[2], -dx, dy),
          },
        ],
      },
      captured,
    ),
    { expectedRevision: captured.revision, previewId: gesture.previewId },
  );
assert.deepEqual(
  editor.state.document,
  baseline,
  'batch preview samples never mutate the committed document',
);
editor.commitPreview({
  expectedRevision: captured.revision,
  previewId: gesture.previewId,
});
const after = view();
let afterMain = mainPath(after);
assert.deepEqual(afterMain.anchors[0], movedPoint(main.anchors[0], 24, 13));
assert.deepEqual(afterMain.anchors[2], movedPoint(main.anchors[2], -24, 13));
assert.equal(
  editor.state.lastChange.changedRefs.length,
  2,
  'the shared vertex is edited and reported once',
);
assert.equal(
  new Set(editor.state.lastChange.changedRefs.map(JSON.stringify)).size,
  2,
);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(
  editor.state.document,
  baseline,
  'one undo restores every vertex in the batch preview',
);

let current = view();
const currentMain = mainPath(current);
assert.throws(
  () =>
    createSourceIntent(
      {
        kind: 'move-anchors',
        items: [
          {
            identityId: currentMain.identity.anchorIds[0],
            pixelPoint: movedPoint(currentMain.anchors[0], 1, 0),
          },
          {
            identityId: currentMain.identity.anchorIds[0],
            pixelPoint: movedPoint(currentMain.anchors[0], 2, 0),
          },
        ],
      },
      current,
    ),
  /冲突位置/,
);
assert.throws(
  () =>
    createSourceIntent(
      {
        kind: 'move-anchors',
        items: [
          {
            identityId: currentMain.identity.anchorIds[0],
            pixelPoint: currentMain.anchors[0],
          },
          { identityId: 'stale-anchor', pixelPoint: currentMain.anchors[1] },
        ],
      },
      current,
    ),
  /身份已失效/,
);
assert.deepEqual(editor.state.document, baseline);

const modesBefore = structuredClone(editor.state.document);
const modeRevision = editor.state.revision;
dispatch(
  createSourceIntent(
    {
      kind: 'set-handle-modes',
      mode: 'smooth',
      items: [
        {
          pathId: currentMain.id,
          identityId: currentMain.identity.anchorIds[1],
        },
        {
          pathId: currentMain.id,
          identityId: currentMain.identity.anchorIds[2],
        },
        {
          pathId: currentMain.id,
          identityId: currentMain.identity.anchorIds[1],
        },
      ],
    },
    current,
  ),
);
assert.equal(editor.state.revision, modeRevision + 1);
const rawMainRef = current.source.identities.byId[currentMain.identity.pathId];
const rawSketch = editor.state.document.sketches[rawMainRef.sketchId];
const rawPath = rawSketch.paths[rawMainRef.id];
const firstModeVertex =
  current.source.identities.byId[currentMain.identity.anchorIds[1]].id;
const secondModeVertex =
  current.source.identities.byId[currentMain.identity.anchorIds[2]].id;
assert.deepEqual(rawPath.handleModes, {
  [firstModeVertex]: 'smooth',
  [secondModeVertex]: 'smooth',
});
assert.equal(
  new Set(editor.state.lastChange.changedRefs.map(JSON.stringify)).size,
  editor.state.lastChange.changedRefs.length,
  'batch mode changes aggregate unique changed refs',
);
editor.undo({ expectedRevision: editor.state.revision });
assert.deepEqual(editor.state.document, modesBefore);

current = view();
const atomicMain = mainPath(current);
const atomicAlias = aliasPath(current);
const atomicBefore = structuredClone(editor.state.document);
assert.throws(
  () =>
    dispatch(
      createSourceIntent(
        {
          kind: 'set-handle-modes',
          mode: 'symmetric',
          items: [
            {
              pathId: atomicMain.id,
              identityId: atomicMain.identity.anchorIds[2],
            },
            {
              pathId: atomicAlias.id,
              identityId: atomicAlias.identity.anchorIds[0],
            },
          ],
        },
        current,
      ),
    ),
  /两侧都有曲线/,
);
assert.deepEqual(
  editor.state.document,
  atomicBefore,
  'a later invalid mode target rolls back the whole batch',
);

const relationView = view();
const relationMain = mainPath(relationView);
const freeIdentity = relationMain.identity.anchorIds[2];
const relationIdentity = relationMain.identity.anchorIds[1];
const freeRef = relationView.source.identities.byId[freeIdentity];
const relationRef = relationView.source.identities.byId[relationIdentity];
dispatch((document) => {
  const sketch = document.sketches[relationRef.sketchId];
  const relationId = 'source-batch-relation';
  sketch.vertices[relationRef.id].position = {
    kind: 'relation',
    relationId,
  };
  document.relations[relationId] = {
    id: relationId,
    kind: 'coincident',
    target: relationRef,
    source: freeRef,
    offset: [0, 0],
    frame: { space: 'owner-local', transform: [1, 0, 0, 1, 0, 0] },
  };
  return { document, changedRefs: [relationRef] };
});
current = view();
afterMain = mainPath(current);
const relationBefore = structuredClone(editor.state.document);
assert.throws(
  () =>
    dispatch(
      createSourceIntent(
        {
          kind: 'move-anchors',
          items: [
            {
              identityId: freeIdentity,
              pixelPoint: movedPoint(afterMain.anchors[2], 9, 4),
            },
            {
              identityId: relationIdentity,
              pixelPoint: movedPoint(afterMain.anchors[1], -7, 3),
            },
          ],
        },
        current,
      ),
    ),
  /Relation/,
);
assert.deepEqual(
  editor.state.document,
  relationBefore,
  'a relation-driven vertex rolls back earlier valid batch items',
);

dispatch(
  createAuthoringCommand({ kind: 'set-node', nodeId, value: { locked: true } }),
);
current = view();
afterMain = mainPath(current);
const lockedBefore = structuredClone(editor.state.document);
assert.throws(
  () =>
    dispatch(
      createSourceIntent(
        {
          kind: 'move-anchors',
          items: [
            {
              identityId: afterMain.identity.anchorIds[0],
              pixelPoint: movedPoint(afterMain.anchors[0], 3, 3),
            },
          ],
        },
        current,
      ),
    ),
  /锁定/,
);
assert.deepEqual(editor.state.document, lockedBefore);

console.log(
  'PASS batched source intents deduplicate shared vertices, preserve preview baselines, aggregate one undo, and roll back stale, invalid, relation, or locked targets',
);
