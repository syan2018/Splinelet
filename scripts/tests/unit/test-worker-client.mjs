import assert from 'node:assert/strict';
import { createWorkerClient } from '../../../src/lib/evaluation/worker-client.mjs';

class WorkerDouble extends EventTarget {
  sent = [];
  terminated = false;
  postMessage(value) {
    if (value.uncloneable) throw Error('cannot clone');
    this.sent.push(value);
  }
  terminate() {
    this.terminated = true;
  }
  reply(data) {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}

const worker = new WorkerDouble();
const client = createWorkerClient(worker);
const first = client.request({ action: 'creation', id: 999 });
const second = client.request({ action: 'preview' });
worker.reply({ id: worker.sent[1].id, result: 'second' });
worker.reply({ id: 999, result: 'unknown response ignored' });
worker.reply({ id: worker.sent[0].id, result: 'first' });
assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
const rejected = client.request({ action: 'bad geometry' });
const rejection = assert.rejects(rejected, /invalid geometry/);
worker.reply({ id: worker.sent.at(-1).id, error: 'invalid geometry' });
await rejection;
await assert.rejects(client.request({ uncloneable: true }), /cannot clone/);
const stillWorks = client.request({ action: 'creation' });
worker.reply({ id: worker.sent.at(-1).id, result: 'ready' });
assert.equal(await stillWorks, 'ready');
const closing = assert.rejects(client.request({}), /workspace disposed/);
client.close(Error('workspace disposed'));
await closing;
assert.equal(worker.terminated, true);
await assert.rejects(client.request({}), /workspace disposed/);
client.close();

for (const eventType of ['error', 'messageerror']) {
  const failedWorker = new WorkerDouble();
  const errors = [];
  const failed = createWorkerClient(failedWorker, {
    onError: (error) => errors.push(error),
  });
  const waiting = assert.rejects(failed.request({}));
  failedWorker.dispatchEvent(new Event(eventType));
  await waiting;
  await assert.rejects(failed.request({}));
  assert.equal(failedWorker.sent.length, 1, 'dead workers receive no new work');
  assert.equal(errors.length, 1);
  assert.equal(failedWorker.terminated, true);
}
console.log('PASS worker request isolation, rejection and lifecycle');
