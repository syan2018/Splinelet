import assert from 'node:assert/strict';
import { FileWriter } from '../../../src/lib/persistence/workspace.mjs';
const deferred = () => {
  let resolve;
  return { promise: new Promise((done) => (resolve = done)), resolve };
};
const writer = new FileWriter();
const events = [];
const permits = { old: deferred(), new: deferred() };
const started = { old: deferred(), new: deferred() };
let stored = 'original';
const handle = {
  async createWritable() {
    let pending;
    events.push('open');
    return {
      async write(v) {
        events.push('write:start:' + v);
        if (started[v]) {
          started[v].resolve();
          await permits[v].promise;
        }
        pending = v;
        events.push('write:' + v);
      },
      async close() {
        stored = pending;
        events.push('close');
      },
      async abort() {
        events.push('abort');
      },
    };
  },
};
const old = writer.write(handle, 'old');
await started.old.promise;
const newer = writer.write(handle, 'new');
await Promise.resolve();
assert.deepEqual(events, ['open', 'write:start:old']);
permits.old.resolve();
await old;
await started.new.promise;
permits.new.resolve();
await newer;
assert.equal(stored, 'new');
assert.deepEqual(events, [
  'open',
  'write:start:old',
  'write:old',
  'close',
  'open',
  'write:start:new',
  'write:new',
  'close',
]);
const bad = {
  async createWritable() {
    return {
      async write() {
        throw Error('disk full');
      },
      async close() {
        throw Error('should not close');
      },
      async abort() {
        events.push('aborted');
      },
    };
  },
};
await assert.rejects(writer.write(bad, 'broken'), /disk full/);
assert.equal(stored, 'new');
assert.ok(events.includes('aborted'));
await writer.write(handle, 'retry');
assert.equal(stored, 'retry');
console.log(
  'PASS: ordered writes, no partial commit after failure, abort on failure, retry after rejected write.',
);
