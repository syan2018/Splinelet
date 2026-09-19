import assert from 'node:assert/strict';
import { FileWriter } from '../../../src/lib/persistence/workspace.mjs';
import { createStudioFileWriter } from '../../../src/lib/platform/studio-file-writer.mjs';

const deferred = () => {
  let resolve;
  return { promise: new Promise((done) => (resolve = done)), resolve };
};

const permissions = (query, request = query) => ({
  calls: [],
  async queryPermission(options) {
    this.calls.push(['query', options]);
    return query;
  },
  async requestPermission(options) {
    this.calls.push(['request', options]);
    return request;
  },
});

const desktopWrites = [];
const writeDesktop = async (path, bytes) => desktopWrites.push({ path, bytes });
const recordedWebWrites = [];
const webWriter = {
  async write(handle, bytes) {
    recordedWebWrites.push({ handle, bytes });
  },
};
const write = createStudioFileWriter({ fileWriter: webWriter, writeDesktop });
const desktopBytes = new Uint8Array([1, 2]);
await write({ kind: 'desktop', path: 'C:/projects/one.spl' }, desktopBytes);
assert.deepEqual(desktopWrites, [
  { path: 'C:/projects/one.spl', bytes: desktopBytes },
]);

const granted = permissions('granted');
const webBytes = new Uint8Array([3, 4]);
await write({ kind: 'web', handle: granted }, webBytes);
assert.deepEqual(granted.calls, [['query', { mode: 'readwrite' }]]);
assert.deepEqual(recordedWebWrites, [{ handle: granted, bytes: webBytes }]);

const denied = permissions('denied', 'denied');
await assert.rejects(
  write({ kind: 'web', handle: denied }, new Uint8Array([5])),
  /permission/i,
);
assert.deepEqual(denied.calls, [
  ['query', { mode: 'readwrite' }],
  ['request', { mode: 'readwrite' }],
]);
assert.equal(recordedWebWrites.length, 1, 'denial must not begin a write');

const prompted = permissions('prompt', 'granted');
await write({ kind: 'web', handle: prompted }, new Uint8Array([6]));
assert.deepEqual(prompted.calls, [
  ['query', { mode: 'readwrite' }],
  ['request', { mode: 'readwrite' }],
]);
assert.equal(recordedWebWrites.length, 2);

await assert.rejects(
  write({ kind: 'desktop', path: 'x.spl' }, new Uint16Array([1])),
  /Uint8Array/,
);
await assert.rejects(write({ kind: 'desktop', path: '' }, webBytes), /path/);
await assert.rejects(write({ kind: 'unknown' }, webBytes), /kind/);
await assert.rejects(write({ kind: 'web', handle: {} }, webBytes), /handle/);

const failingWriter = new FileWriter();
const failureEvents = [];
let fail = true;
const failingHandle = {
  ...permissions('granted'),
  async createWritable() {
    return {
      async write(bytes) {
        failureEvents.push(['write', [...bytes]]);
        if (fail) throw Error('disk full');
      },
      async close() {
        failureEvents.push(['close']);
      },
      async abort() {
        failureEvents.push(['abort']);
      },
    };
  },
};
const writeWithFailure = createStudioFileWriter({ fileWriter: failingWriter });
await assert.rejects(
  writeWithFailure({ kind: 'web', handle: failingHandle }, new Uint8Array([7])),
  /disk full/,
);
assert.deepEqual(failureEvents, [['write', [7]], ['abort']]);
fail = false;
await writeWithFailure(
  { kind: 'web', handle: failingHandle },
  new Uint8Array([8]),
);
assert.deepEqual(failureEvents.slice(-2), [['write', [8]], ['close']]);

const orderedWriter = new FileWriter();
const firstStarted = deferred();
const releaseFirst = deferred();
const orderedEvents = [];
const orderedHandle = {
  ...permissions('granted'),
  async createWritable() {
    return {
      async write(bytes) {
        const value = bytes[0];
        orderedEvents.push(`write:start:${value}`);
        if (value === 9) {
          firstStarted.resolve();
          await releaseFirst.promise;
        }
        orderedEvents.push(`write:end:${value}`);
      },
      async close() {
        orderedEvents.push('close');
      },
      async abort() {
        orderedEvents.push('abort');
      },
    };
  },
};
const writeInOrder = createStudioFileWriter({ fileWriter: orderedWriter });
const first = writeInOrder(
  { kind: 'web', handle: orderedHandle },
  new Uint8Array([9]),
);
await firstStarted.promise;
const second = writeInOrder(
  { kind: 'web', handle: orderedHandle },
  new Uint8Array([10]),
);
await Promise.resolve();
assert.deepEqual(orderedEvents, ['write:start:9']);
releaseFirst.resolve();
await Promise.all([first, second]);
assert.deepEqual(orderedEvents, [
  'write:start:9',
  'write:end:9',
  'close',
  'write:start:10',
  'write:end:10',
  'close',
]);

console.log(
  'PASS: Studio file writer validates bound targets, obtains permission, recovers browser writes, and serializes saves.',
);
