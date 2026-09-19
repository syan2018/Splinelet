import assert from 'node:assert/strict';
import { openProject } from '../../../src/lib/persistence/open-project.mjs';
import {
  createV4PersistenceSession,
  DRAFT_KEY,
} from '../../../src/lib/persistence/v4-session.mjs';

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
const document = (id) => ({ version: 4, id });
const openedV4 = openProject(
  { bytes: new Uint8Array([1]), target: 'v4.spl' },
  {
    decodeV4: () => ({
      document: document('v4'),
      assets: { image: new Uint8Array([2]) },
    }),
  },
);
assert.equal(openedV4.kind, 'v4');
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
assert.equal(openedLegacy.kind, 'legacy');
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
