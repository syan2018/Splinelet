import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import { evaluateProgram } from '../../../src/lib/construction/document-evaluation.mjs';
import { definitionRef } from '../../../src/lib/construction/region-definitions.mjs';
import {
  decodeDocument,
  encodeDocument,
} from '../../../src/lib/document/codec.mjs';

let serial = 0;
const idFactory = () => `v5-property-edit-${++serial}`;
const snapshot = (session) => structuredClone(session.state.document);
const dispatch = (session, command) =>
  session.dispatch(command, { expectedRevision: session.state.revision });
const author = (session, action) =>
  dispatch(session, createAuthoringCommand(action));
const stableStage = (document, ownerNodeId) =>
  evaluateProgram(document, ownerNodeId).regions;
const failAtomically = (session, action, message) => {
  const before = snapshot(session);
  const revision = session.state.revision;
  assert.throws(() => author(session, action), message);
  assert.equal(
    session.state.revision,
    revision,
    'failed request keeps revision',
  );
  assert.deepEqual(snapshot(session), before, 'failed request keeps authority');
};

const createSquare = (version = 5) => {
  const session = createEditorSession(createDocument({ version, idFactory }), {
    idFactory,
  });
  author(session, {
    kind: 'draw-path',
    closed: true,
    points: [
      [0, 0],
      [12, 0],
      [12, 12],
      [0, 12],
    ],
  });
  const ownerNodeId = Object.keys(session.state.document.nodes)[0];
  const stage = stableStage(session.state.document, ownerNodeId);
  assert.equal(stage.status, 'ready', JSON.stringify(stage.diagnostics));
  return { session, ownerNodeId, transient: stage.value.regions[0].ref };
};

const breakFillInput = (session, ownerNodeId) =>
  dispatch(session, (document) => {
    const program = document.programs[document.nodes[ownerNodeId].programId];
    const fill = program.operators[program.outputs.regions.operatorId];
    fill.inputs.input[0].operatorId = 'missing-producer';
    return { document, changedRefs: [] };
  });

const propertyBatch = (actions) => (document, context) => {
  let current = document;
  const changedRefs = [];
  for (const action of actions) {
    const result = createAuthoringCommand(action)(current, context);
    current = result.document;
    changedRefs.push(...result.changedRefs);
  }
  return { document: current, changedRefs };
};

const { session, ownerNodeId, transient } = createSquare();
assert.ok(transient.key.startsWith('cell:'), 'fresh V5 result is transient');
author(session, {
  kind: 'create-swatch',
  name: 'initial red',
  color: '#cc2233',
});
const red = Object.keys(session.state.document.appearances.swatches)[0];
author(session, { kind: 'paint-region', target: transient, swatchId: red });
assert.equal(
  Object.keys(session.state.document.regionDefinitions).length,
  1,
  'the first temporary region edit explicitly binds one definition',
);
const [definition] = Object.values(session.state.document.regionDefinitions);
const durable = definitionRef(definition);
const paintRecord = Object.values(
  session.state.document.appearances.overrides,
)[0];
assert.deepEqual(paintRecord.target, durable, 'paint persists the durable ref');
assert.equal(
  paintRecord.target.key.startsWith('cell:'),
  false,
  'the temporary key is never persisted',
);
author(session, {
  kind: 'create-swatch',
  name: 'replacement blue',
  color: '#2255dd',
});
const blue = Object.keys(session.state.document.appearances.swatches).at(-1);

// Call the command directly on an accessor-backed disposable document so the
// dispatcher clone cannot erase the probe. An old currentTarget implementation
// evaluated the Fill source and read this accessor; durable validation must not.
const noEvaluationProbe = structuredClone(session.state.document);
const probeProgram =
  noEvaluationProbe.programs[noEvaluationProbe.nodes[ownerNodeId].programId];
const probeFill =
  probeProgram.operators[probeProgram.outputs.regions.operatorId];
const probeSource =
  probeProgram.operators[probeFill.inputs.input[0].operatorId];
const sourceInputs = probeSource.inputs;
let sourceReads = 0;
Object.defineProperty(probeSource, 'inputs', {
  configurable: true,
  enumerable: true,
  get() {
    sourceReads++;
    return sourceInputs;
  },
});
createAuthoringCommand({
  kind: 'set-relief',
  target: durable,
  value: { enabled: true },
})(noEvaluationProbe, { idFactory });
assert.equal(
  sourceReads,
  0,
  'durable property validation does not read the Fill source or evaluate geometry',
);

const selectorBeforeBreak = structuredClone(definition.selector);
breakFillInput(session, ownerNodeId);
assert.equal(
  stableStage(session.state.document, ownerNodeId).status,
  'blocked',
  'the published geometry is genuinely unavailable',
);

// These all target a definition already validated by its exact durable OutputRef.
// The output remains blocked before and after every edit: success therefore cannot
// be coming from a fallback geometry evaluation or an implicit cell repair.
author(session, {
  kind: 'set-relief',
  target: durable,
  value: { enabled: true, mode: 'cut' },
});
author(session, {
  kind: 'set-thickness',
  target: durable,
  thickness: { kind: 'mm', value: 2.75 },
});
author(session, { kind: 'paint-region', target: durable, swatchId: blue });
assert.equal(
  stableStage(session.state.document, ownerNodeId).status,
  'blocked',
);
assert.deepEqual(
  session.state.document.regionDefinitions[definition.id].selector,
  selectorBeforeBreak,
  'property commands do not rewrite a missing definition into a new face',
);
const paintedDurable = Object.values(
  session.state.document.appearances.overrides,
).find((record) => record.target.key === durable.key);
assert.equal(paintedDurable.value.swatchId, blue);
const reliefDurable = Object.values(
  session.state.document.reliefDefinitions.overrides,
).find((record) => record.target.key === durable.key);
assert.equal(reliefDurable.value.mode, 'cut');
assert.equal(reliefDurable.value.thickness.value, 2.75);

const beforeClear = snapshot(session);
author(session, { kind: 'clear-region-paint', target: durable });
const afterClear = snapshot(session);
assert.equal(
  Object.values(afterClear.appearances.overrides).some(
    (record) => record.target.key === durable.key,
  ),
  false,
);
assert.equal(
  Object.values(afterClear.reliefDefinitions.overrides).find(
    (record) => record.target.key === durable.key,
  ).value.enabled,
  false,
);
assert.equal(stableStage(afterClear, ownerNodeId).status, 'blocked');
session.undo({ expectedRevision: session.state.revision });
assert.deepEqual(
  snapshot(session),
  beforeClear,
  'clear-region-paint undoes once',
);
session.redo({ expectedRevision: session.state.revision });
assert.deepEqual(
  snapshot(session),
  afterClear,
  'clear-region-paint redoes once',
);

failAtomically(
  session,
  {
    kind: 'set-relief',
    target: { ...durable, key: 'unknown-definition' },
    value: { enabled: true },
  },
  /区域已失效|区域定义|区域引用/,
);
failAtomically(
  session,
  {
    kind: 'set-thickness',
    target: { ...durable, operatorId: 'forged-operator' },
    thickness: { kind: 'mm', value: 1 },
  },
  /区域已失效|区域定义|区域引用/,
);
failAtomically(
  session,
  {
    kind: 'set-relief',
    target: durable,
    value: { mode: 'unsupported-mode' },
  },
  /mode|无效/,
);
failAtomically(
  session,
  {
    kind: 'set-thickness',
    target: durable,
    thickness: { kind: 'mm', value: Infinity },
  },
  /无效/,
);
failAtomically(
  session,
  {
    kind: 'paint-region',
    target: durable,
    swatchId: 'unknown-swatch',
  },
  /颜色不存在/,
);

dispatch(session, (document) => {
  document.nodes[ownerNodeId].locked = true;
  return { document, changedRefs: [] };
});
failAtomically(
  session,
  {
    kind: 'set-thickness',
    target: durable,
    thickness: { kind: 'mm', value: 1 },
  },
  /已锁定/,
);
dispatch(session, (document) => {
  document.nodes[ownerNodeId].locked = false;
  return { document, changedRefs: [] };
});

const beforeBatchFailure = snapshot(session);
const batchRevision = session.state.revision;
assert.throws(
  () =>
    dispatch(
      session,
      propertyBatch([
        {
          kind: 'set-relief',
          target: durable,
          value: { enabled: true },
        },
        {
          kind: 'set-thickness',
          target: { ...durable, key: 'unknown-definition' },
          thickness: { kind: 'mm', value: 1 },
        },
      ]),
    ),
  /区域已失效|区域定义|区域引用/,
);
assert.equal(session.state.revision, batchRevision);
assert.deepEqual(snapshot(session), beforeBatchFailure);

const reopened = decodeDocument(
  encodeDocument(session.state.document),
).document;
assert.deepEqual(
  reopened.regionDefinitions[definition.id],
  session.state.document.regionDefinitions[definition.id],
  'reopen keeps the missing definition as authored',
);
assert.equal(
  stableStage(reopened, ownerNodeId).status,
  'blocked',
  'reopen does not manufacture geometry for a missing definition',
);

// A transient V5 cell still requires current geometry and cannot be persisted
// after the same chain break. V4 has no durable definitions and keeps that path.
for (const version of [5, 4]) {
  const fixture = createSquare(version);
  author(fixture.session, {
    kind: 'create-swatch',
    name: `transient-${version}`,
    color: '#44aa66',
  });
  breakFillInput(fixture.session, fixture.ownerNodeId);
  assert.equal(
    stableStage(fixture.session.state.document, fixture.ownerNodeId).status,
    'blocked',
  );
  failAtomically(
    fixture.session,
    {
      kind: 'paint-region',
      target: fixture.transient,
      swatchId: Object.keys(
        fixture.session.state.document.appearances.swatches,
      )[0],
    },
    /区域已失效/,
  );
  assert.equal(
    Object.keys(fixture.session.state.document.appearances.overrides).length,
    0,
  );
  if (version === 5)
    assert.equal(
      Object.keys(fixture.session.state.document.regionDefinitions).length,
      0,
      'a failed transient target cannot create a durable definition',
    );
}

console.log(
  'PASS V5 durable region property edits survive missing geometry without evaluation or rebinding',
);
