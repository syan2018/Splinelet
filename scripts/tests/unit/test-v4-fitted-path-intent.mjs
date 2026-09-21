import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createPathIntent } from '../../../src/lib/editor/path-intents.mjs';
import { projectSourceView } from '../../../src/lib/editor/source-view.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import {
  encodeDocument,
  decodeDocument,
} from '../../../src/lib/document/codec.mjs';

let serial = 0;
const idFactory = () => `fitted-path-${++serial}`;
const session = createEditorSession(createDocument({ idFactory }), {
  idFactory,
});
const frame = { width: 800, height: 600, widthMM: 160 };
const view = () => ({
  ...session.state,
  source: projectSourceView(session.state.document, frame),
});
const dispatch = (command) =>
  session.dispatch(command, { expectedRevision: session.state.revision });
const cubic = [
  [
    { x: 300, y: 300 },
    { x: 300, y: 250 },
    { x: 400, y: 250 },
    { x: 400, y: 300 },
  ],
  [
    { x: 400, y: 300 },
    { x: 400, y: 350 },
    { x: 300, y: 350 },
    { x: 300, y: 300 },
  ],
];
const baseline = structuredClone(session.state.document);
const request = {
  kind: 'draw-path',
  name: 'two curved spans',
  pixelCubics: cubic,
  closed: true,
};
const planned = createPathIntent(request, view());
assert.deepEqual(
  session.state.document,
  baseline,
  'preparing a candidate does not write geometry',
);
request.pixelCubics[0][1].y = 1;
dispatch(planned);
assert.equal(session.state.revision, 1);
const path = view().source.paths[0];
assert.equal(path.closed, true);
assert.equal(
  path.curves.length,
  2,
  'two curved spans form a valid closed path',
);
assert.equal(
  path.curves[0][1].y,
  250,
  'the prepared candidate owns immutable fitted handles',
);
const completed = structuredClone(session.state.document);
const evaluated = evaluateProgram(completed, Object.keys(completed.nodes)[0]);
assert.equal(evaluated.regions.status, 'ready');
assert.equal(evaluated.regions.value.regions.length, 1);
const reopened = decodeDocument(encodeDocument(completed)).document;
assert.deepEqual(projectSourceView(reopened, frame).paths, view().source.paths);
session.undo({ expectedRevision: session.state.revision });
assert.deepEqual(session.state.document, baseline);
assert.throws(
  () => dispatch(planned),
  /失效/,
  'late acceptance cannot target the undo revision',
);
session.redo({ expectedRevision: session.state.revision });
assert.deepEqual(session.state.document, completed);

const bad = structuredClone(cubic);
bad[1][0].x += 1;
const invalid = createPathIntent(
  { kind: 'draw-path', closed: true, pixelCubics: bad },
  view(),
);
const previous = session.state;
assert.throws(() => dispatch(invalid), /拓扑/);
assert.deepEqual(
  session.state,
  previous,
  'discontinuous fitted spans never partially create a Shape',
);

const open = [
  { x: 200, y: 200 },
  { x: 220, y: 170 },
  { x: 250, y: 180 },
  { x: 270, y: 220 },
];
dispatch(
  createPathIntent(
    { kind: 'draw-path', closed: false, pixelCubics: [open] },
    view(),
  ),
);
assert.deepEqual(view().source.paths.at(-1).curves[0], open);
assert.equal(view().source.paths.at(-1).closed, false);
console.log(
  'PASS fitted source candidates preserve cubics, closed curved topology, immutable plans, stale guards, file roundtrip and one undo',
);
