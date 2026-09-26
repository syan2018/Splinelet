import assert from 'node:assert/strict';
import { openProject } from '../../../src/lib/persistence/open-project.mjs';
import {
  createV4PersistenceSession,
  DRAFT_KEY,
} from '../../../src/lib/persistence/v4-session.mjs';
import { createDocument } from '../../../src/lib/document/schema.mjs';

const deferred = () => {
  let resolve;
  return {
    promise: new Promise((next) => {
      resolve = next;
    }),
    resolve,
  };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));
const document = (id) =>
  createDocument({
    version: 4,
    id,
    idFactory: () => `${id}-default-part`,
  });
const openedV4 = openProject(
  { bytes: new Uint8Array([1]), target: 'v4.spl' },
  {
    decodeV4: () => ({
      document: document('v4'),
      assets: { image: new Uint8Array([2]) },
    }),
  },
);
assert.equal(openedV4.kind, 'migrated');
assert.equal(openedV4.document.version, 5);
assert.equal(openedV4.dirty, true);
assert.equal(openedV4.target, null);
const openedLegacy = openProject(
  { bytes: new Uint8Array([0]), legacy: { version: 3 }, target: 'old.spl' },
  {
    decodeV4: () => {
      throw Error('not v4');
    },
    importLegacy: () => ({
      document: document('legacy'),
      assets: { image: new Uint8Array([3]) },
      idMap: {},
      report: { warnings: [] },
    }),
  },
);
assert.equal(openedLegacy.kind, 'migrated');
assert.equal(openedLegacy.document.version, 5);
assert.equal(openedLegacy.dirty, true);
assert.equal(openedLegacy.report.warnings.length, 0);

const writes = [];
const writeGates = [];
const draftWrites = [];
const readGate = deferred();
let ids = 0;
const session = createV4PersistenceSession({
  encodeV4: (doc, { assets }) =>
    new TextEncoder().encode(`${doc.id}:${assets.image?.[0] || 0}`),
  writeFile: (target, bytes) => {
    writes.push({ target, bytes: new Uint8Array(bytes) });
    const gate = deferred();
    writeGates.push(gate);
    return gate.promise;
  },
  drafts: {
    write: async (key, value) => draftWrites.push({ key, value }),
    read: () => readGate.promise,
  },
  idFactory: () => `epoch-${++ids}`,
});
let state = session.open(openedLegacy);
assert.equal(state.target, null);
assert.equal(state.legacySource, true);
assert.equal(state.dirty, true);
assert.throws(
  () => session.save({ expectedEpoch: state.epoch, expectedRevision: 0 }),
  /首次保存/,
);
const oldSave = session.save({
  expectedEpoch: state.epoch,
  expectedRevision: 0,
  saveAsTarget: 'converted.spl',
});
await flush();
assert.equal(writes[0].target, 'converted.spl');
state = session.open({
  kind: 'v4',
  document: document('new'),
  assets: {},
  target: 'new.spl',
});
writeGates[0].resolve();
await oldSave;
assert.equal(
  session.state.target,
  'new.spl',
  'late old write cannot bind a newly opened file',
);
assert.equal(session.state.dirty, false);

const mutableTarget = { path: 'replaced.spl' };
state = session.open({
  kind: 'v4',
  epoch: 'replaced-editor',
  revision: 7,
  document: document('replaced'),
  assets: {},
  target: mutableTarget,
});
assert.equal(state.revision, 7);
assert.equal(state.dirty, false);
assert.notStrictEqual(state.target, mutableTarget);
mutableTarget.path = 'changed-after-open.spl';
assert.equal(session.state.target.path, 'replaced.spl');
assert.equal(
  session.update({
    epoch: state.epoch,
    revision: state.revision,
    previewId: null,
    document: document('replaced'),
  }).dirty,
  false,
  'opening at the replacement revision and receiving the same editor state stays clean',
);
assert.equal(
  session.update({
    epoch: state.epoch,
    revision: state.revision,
    previewId: null,
    document: document('replaced'),
  }).dirty,
  false,
  'a no-op update or preview cancellation state stays clean',
);
state = session.update({
  epoch: state.epoch,
  revision: state.revision + 1,
  previewId: null,
  document: document('replaced-edit'),
});
assert.equal(state.dirty, true, 'a committed edit dirties the session');
assert.throws(
  () =>
    session.update({
      epoch: state.epoch,
      revision: state.revision - 1,
      previewId: null,
      document: document('replaced'),
    }),
  /过期/,
);
assert.throws(
  () =>
    session.update({
      epoch: state.epoch,
      revision: state.revision,
      previewId: null,
      document: document('identity-violation'),
    }),
  /identity/,
);
const beforeBadOpen = session.state;
assert.throws(
  () =>
    session.open({
      kind: 'v4',
      epoch: '',
      document: document('bad'),
      assets: {},
    }),
  /epoch/,
);
assert.deepEqual(
  session.state,
  beforeBadOpen,
  'invalid open leaves the current file intact',
);
assert.throws(() =>
  session.open({
    kind: 'v4',
    document: document('clone-failure'),
    assets: { unsupported: () => {} },
  }),
);
assert.deepEqual(
  session.state,
  beforeBadOpen,
  'clone failures leave the current file intact',
);
state = session.open({
  kind: 'legacy',
  document: document('legacy-unbound'),
  assets: {},
  target: 'legacy.spl',
  dirty: false,
});
assert.equal(state.target, null);
assert.equal(
  state.dirty,
  true,
  'legacy projects remain dirty even when dirty is false',
);

state = session.open({
  kind: 'v4',
  document: document('new'),
  assets: {},
  target: 'new.spl',
});
state = session.update({
  epoch: state.epoch,
  revision: 1,
  previewId: null,
  document: document('new-edit'),
});
await session.autosave({ expectedEpoch: state.epoch, expectedRevision: 1 });
assert.equal(
  draftWrites[0].key,
  DRAFT_KEY,
  'V4 autosave uses an isolated namespace',
);
assert.equal(
  writes.length,
  1,
  'autosave never writes or downloads a bound file',
);
await assert.rejects(
  session.autosave({
    expectedEpoch: state.epoch,
    expectedRevision: 1,
    previewId: 'preview-1',
  }),
  /preview/,
);
const first = session.save({ expectedEpoch: state.epoch, expectedRevision: 1 });
state = session.update({
  epoch: state.epoch,
  revision: 2,
  previewId: null,
  document: document('newer-edit'),
});
const second = session.save({
  expectedEpoch: state.epoch,
  expectedRevision: 2,
});
await flush();
assert.equal(writes.length, 2);
writeGates[1].resolve();
await first;
await flush();
assert.equal(
  writes.length,
  3,
  'file writes are serialized with their captured target',
);
writeGates[2].resolve();
await second;
assert.equal(session.state.dirty, false);
assert.deepEqual(
  [...writes[2].bytes],
  [...new TextEncoder().encode('newer-edit:0')],
);

const restoring = session.restore({ expectedEpoch: session.state.epoch });
session.open({
  kind: 'v4',
  document: document('replacement'),
  assets: {},
  target: 'replacement.spl',
});
readGate.resolve({ document: document('draft'), assets: {} });
await assert.rejects(restoring, /过期/);
assert.equal(session.state.document.id, 'replacement');
console.log(
  'PASS: V4 persistence isolates drafts, captures file targets, and rejects stale save/recovery races.',
);
