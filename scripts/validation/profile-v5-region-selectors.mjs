import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { decodeDocument } from '../../src/lib/document/codec.mjs';
import { migrateRegionDefinitions } from '../../src/lib/document/import/region-definitions.mjs';
import { evaluatePlanar } from '../../src/lib/construction/document-evaluation.mjs';

class CountingCache extends Map {
  reads = 0;
  writes = 0;

  get(key) {
    this.reads++;
    return super.get(key);
  }

  set(key, value) {
    this.writes++;
    return super.set(key, value);
  }

  sample() {
    const result = {
      reads: this.reads,
      writes: this.writes,
      entries: this.size,
    };
    this.reads = 0;
    this.writes = 0;
    return result;
  }
}

const elapsed = (run) => {
  const started = performance.now();
  const value = run();
  return {
    milliseconds: Number((performance.now() - started).toFixed(1)),
    value,
  };
};
const idFactory = (() => {
  let index = 0;
  return () => `profile-v5-${++index}`;
})();
const { values } = parseArgs({ options: { input: { type: 'string' } } });
const input = values.input || 'public/sandrone-example.spl';
const source = decodeDocument(readFileSync(input)).document;
const migrated =
  source.version === 4
    ? elapsed(() => migrateRegionDefinitions(source, { idFactory }))
    : { milliseconds: 0, value: { document: source } };
const document = migrated.value.document;
const cache = new CountingCache();
const cold = elapsed(() => evaluatePlanar(document, { cache }));
const coldCache = cache.sample();
const warm = elapsed(() => evaluatePlanar(document, { cache }));
const warmCache = cache.sample();
const warmReuse = evaluatePlanar(document, { cache });
for (const id of Object.keys(warm.value.components)) {
  assert.strictEqual(
    warmReuse.components[id],
    warm.value.components[id],
    `built-in cache entry ${id} must be structurally shared`,
  );
  assert(Object.isFrozen(warm.value.components[id]));
}
assert.equal(
  Object.isFrozen(source),
  false,
  'evaluation must not freeze user data',
);
assert.equal(
  Object.isFrozen(source.sketches),
  false,
  'evaluation must not freeze user-owned nested data',
);
cache.sample(); // exclude the immutability probe from edit cache counters
const edited = structuredClone(document);
const vertex = Object.values(edited.sketches)
  .flatMap((sketch) => Object.values(sketch.vertices))
  .find((item) => item.position.kind === 'free');
if (!vertex) throw Error('sample 缺少可编辑自由 Vertex');
vertex.position.value[0] += 0.001;
const editedEvaluation = elapsed(() => evaluatePlanar(edited, { cache }));
const editedCache = cache.sample();
// Restore the initial cache before the sample's high-complexity hair path edit.
evaluatePlanar(document, { cache });
cache.sample();
const hairEdited = structuredClone(document);
const hairSketch = hairEdited.sketches['sketch:dd42fa88fb810d6c09de'];
const hairVertex = hairSketch?.vertices['vertex:437fca5a9edfbf982a86'];
const hairEdge = hairSketch?.edges['6b160274-46be-40f0-afd7-1169e58eaf60'];
if (!hairVertex || !hairEdge?.startHandle?.vector)
  throw Error('sample 缺少头发 Path 43c 的目标 Vertex/Handle');
hairVertex.position.value[0] += 0.001;
hairEdge.startHandle.vector[0] += 0.001;
const hairEvaluation = elapsed(() => evaluatePlanar(hairEdited, { cache }));
const hairCache = cache.sample();
assert.deepEqual(
  warm.value,
  cold.value,
  'a warm cache result must equal its initial cold evaluation',
);
assert.deepEqual(
  editedEvaluation.value,
  evaluatePlanar(edited),
  'a locally invalidated cache result must equal a fresh evaluation',
);
assert.deepEqual(
  hairEvaluation.value,
  evaluatePlanar(hairEdited),
  'the hair vertex/handle cache result must equal a fresh evaluation',
);
const summary = (planar) => ({
  components: Object.keys(planar.components).length,
  readyRegions: Object.values(planar.components).reduce(
    (count, component) =>
      count + (component.ports.regions?.status === 'ready' ? 1 : 0),
    0,
  ),
  errors: Object.values(planar.components).reduce(
    (count, component) =>
      count +
      Object.values(component.ports).filter((port) =>
        port.diagnostics?.some((item) => item.severity === 'error'),
      ).length,
    0,
  ),
});
console.log(
  JSON.stringify(
    {
      source: `${input} (${source.version === 4 ? 'in-memory V4→V5 migration' : 'native V5'})`,
      migrationMilliseconds: migrated.milliseconds,
      cold: {
        milliseconds: cold.milliseconds,
        cache: coldCache,
        ...summary(cold.value),
      },
      warm: {
        milliseconds: warm.milliseconds,
        cache: warmCache,
        ...summary(warm.value),
      },
      sourcePointEdit: {
        milliseconds: editedEvaluation.milliseconds,
        cache: editedCache,
        ...summary(editedEvaluation.value),
      },
      hairVertexAndHandleEdit: {
        pathId: 'path:43c8857140e76e8b732d',
        vertexId: hairVertex.id,
        edgeId: hairEdge.id,
        operationCount: 2,
        milliseconds: hairEvaluation.milliseconds,
        cache: hairCache,
        ...summary(hairEvaluation.value),
      },
      cacheEquivalentToCold: true,
    },
    null,
    2,
  ),
);
