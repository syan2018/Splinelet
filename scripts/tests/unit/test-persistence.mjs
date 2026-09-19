import assert from 'node:assert/strict';
import { FileWriter } from '../../../public/persistence.mjs';
const writer = new FileWriter(),
  events = [];
let stored = 'original';
const handle = {
  async createWritable() {
    let pending;
    events.push('open');
    return {
      async write(v) {
        await new Promise((r) => setTimeout(r, v === 'old' ? 25 : 1));
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
await Promise.all([writer.write(handle, 'old'), writer.write(handle, 'new')]);
assert.equal(stored, 'new');
assert.deepEqual(events, [
  'open',
  'write:old',
  'close',
  'open',
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
