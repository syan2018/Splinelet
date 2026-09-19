import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import {
  regionPathMemberships,
  regionPathUses,
} from '../../../src/lib/editing/region-drawing.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { readGeometry } from '../../../src/lib/region-engine.mjs';
import { curveFilterOperator } from '../../../src/lib/construction/operators/curves/filter.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { projectCreationView } from '../../../src/lib/editor/creation-view.mjs';
import { projectCurvePreviews } from '../../../src/lib/editor/curve-preview.mjs';
import { evaluatePlanar } from '../../../src/lib/construction/document-evaluation.mjs';

let serial = 0;
const idFactory = () => `membership-${++serial}`;
let document = createDocument({ idFactory });
const draw = (points, ownerNodeId) => {
  const result = createAuthoringCommand({
    kind: 'draw-path',
    closed: true,
    points,
    ownerNodeId,
  })(document, { idFactory });
  document = result.document;
  return result.changedRefs.find((ref) => ref.kind === 'path');
};
const outer = draw([
  [0, 0],
  [20, 0],
  [20, 20],
  [0, 20],
]);
const owner = document.sketches[outer.sketchId].ownerNodeId;
const inner = draw(
  [
    [5, 5],
    [15, 5],
    [15, 15],
    [5, 15],
  ],
  owner,
);
const use = regionPathMemberships(document, inner)[0];
const initial = structuredClone(document);
const area = (doc = document) => {
  const result = evaluateProgram(doc, owner).regions;
  assert.equal(result.status, 'ready');
  return result.value.regions.reduce(
    (sum, region) => sum + readGeometry(region.geometry).getArea(),
    0,
  );
};
const toggle = (included, doc = document) =>
  createAuthoringCommand({
    kind: 'set-region-path-membership',
    pathRef: inner,
    operatorId: use.operatorId,
    included,
  })(doc, { idFactory });
assert.equal(area(), 300);
document = toggle(false).document;
assert.deepEqual(initial.sketches, document.sketches);
assert.equal(area(), 400);
assert.deepEqual(regionPathUses(document, inner), []);
assert.equal(regionPathUses(document, outer)[0].role, 'boundary');
const filtered = structuredClone(document);
const program = document.programs[document.nodes[owner].programId];
const filterId = regionPathMemberships(document, inner)[0].filterId;
assert.ok(filterId);
const publishedCurves = evaluateProgram(document, owner).curves;
assert.equal(
  publishedCurves.value.curves.length,
  2,
  'excluded source stays visible and editable',
);
assert.deepEqual(
  toggle(false).document,
  document,
  'repeated toggle is a no-op',
);
document = toggle(true).document;
assert.equal(
  area(),
  300,
  'restored inner contour must be a hole, not a new filled island',
);
assert.deepEqual(document.sketches, initial.sketches);
assert.equal(regionPathUses(document, inner)[0].operatorId, use.operatorId);
assert.deepEqual(
  document.programs[program.id].outputs,
  initial.programs[program.id].outputs,
);
assert.deepEqual(
  evaluateProgram(document, owner).regions.value,
  evaluateProgram(initial, owner).regions.value,
);
const restored = structuredClone(document);
const session = createEditorSession(initial, { idFactory });
session.dispatch(
  createAuthoringCommand({
    kind: 'set-region-path-membership',
    pathRef: inner,
    operatorId: use.operatorId,
    included: false,
  }),
  { expectedRevision: session.state.revision },
);
assert.equal(area(session.state.document), 400);
session.undo({ expectedRevision: session.state.revision });
assert.deepEqual(session.state.document, initial);
session.redo({ expectedRevision: session.state.revision });
assert.equal(area(session.state.document), 400);
assert.deepEqual(projectCreationView(filtered, {}).modifierStatus, []);
assert.deepEqual(projectCurvePreviews(filtered, evaluatePlanar(filtered)), []);
const allExcluded = createAuthoringCommand({
  kind: 'set-region-path-membership',
  pathRef: outer,
  operatorId: use.operatorId,
  included: false,
})(filtered, { idFactory }).document;
assert.equal(evaluateProgram(allExcluded, owner).regions.status, 'empty');
assert.equal(evaluateProgram(allExcluded, owner).curves.value.curves.length, 2);
const sharedFill = structuredClone(initial);
sharedFill.programs[program.id].operators.anotherUse = {
  id: 'anotherUse',
  type: 'boolean',
  name: 'another use',
  enabled: true,
  params: { operation: 'difference', scope: { kind: 'all' } },
  inputs: {
    input: [],
    operand: [
      {
        ...program.outputs.regions,
        space: 'local-result',
        transform: [1, 0, 0, 1, 0, 0],
      },
    ],
  },
};
assert.throws(() => toggle(false, sharedFill), /多个区域用途/);

// A second consumer of the same filter must keep its membership unchanged.
document = structuredClone(filtered);
document.programs[program.id].outputs.curves = {
  kind: 'port',
  ownerNodeId: owner,
  operatorId: filterId,
  domain: 'curves',
  port: 'curves',
};
const sharedBefore = structuredClone(document);
document = toggle(true).document;
assert.equal(area(), 300);
assert.equal(evaluateProgram(document, owner).curves.value.curves.length, 1);
assert.deepEqual(
  document.programs[program.id].operators[filterId],
  sharedBefore.programs[program.id].operators[filterId],
);

const locked = structuredClone(restored);
locked.nodes[owner].locked = true;
assert.throws(() => toggle(false, locked), /锁定/);
const transformed = structuredClone(restored);
transformed.programs[program.id].operators[
  use.operatorId
].inputs.input[0].transform[4] = 1;
assert.throws(() => toggle(false, transformed), /变换/);
assert.throws(
  () =>
    createAuthoringCommand({
      kind: 'set-region-path-membership',
      pathRef: inner,
      operatorId: 'missing',
      included: true,
    })(document, { idFactory }),
  /唯一/,
);
assert.deepEqual(initial.sketches, document.sketches);

const filter = filtered.programs[program.id].operators[filterId];
const copied = curveFilterOperator.copy(filter, {
  idMap: new Map([
    [inner.id, 'copied-path'],
    [inner.sketchId, 'copied-sketch'],
  ]),
});
assert.deepEqual(copied.params.excludedPaths, [
  { kind: 'path', sketchId: 'copied-sketch', id: 'copied-path' },
]);
assert.deepEqual(
  curveFilterOperator.rebase(filter, { transform: [1, 0, 0, 1, 10, 0] }),
  filter,
);
assert.equal(curveFilterOperator.validateParams(filter.params), true);
assert.equal(
  typeof curveFilterOperator.validateParams({ excludedPaths: [inner, inner] }),
  'string',
);
assert.equal(
  typeof curveFilterOperator.validateParams({
    excludedPaths: [{ ...inner, invalid: 1 }],
  }),
  'string',
);
const missing = structuredClone(filter);
missing.params.excludedPaths[0].id = 'missing';
const stage = evaluateProgram(initial, owner).curves;
assert.equal(
  curveFilterOperator.evaluate({
    inputs: { input: [stage] },
    operator: missing,
  }).curves.status,
  'blocked',
);
const failed = {
  domain: 'curves',
  status: 'blocked',
  diagnostics: [{ code: 'failure' }],
  dependencies: ['upstream'],
};
assert.deepEqual(
  curveFilterOperator.evaluate({
    inputs: { input: [failed] },
    operator: filter,
  }).curves,
  failed,
);
console.log(
  'PASS path participation suspends and restores even-odd holes without source edits, output identity changes or shared-consumer mutations',
);
