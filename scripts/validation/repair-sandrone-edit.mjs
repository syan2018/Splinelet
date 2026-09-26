import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import {
  decodeDocument,
  encodeDocument,
} from '../../src/lib/document/codec.mjs';
import { migrateRegionDefinitions } from '../../src/lib/document/import/region-definitions.mjs';
import { mergeBasisSpans } from '../../src/lib/geometry/path-basis.mjs';
import { evaluateDocument } from '../../src/lib/evaluation/evaluate-document.mjs';
import { stableIdentityValue as key } from '../../src/lib/construction/output-identity.mjs';

// Explicit recovery from a known-good baseline and a source-only, single-node
// deletion. This is an offline authoring operation, never an evaluation fallback.
const { values } = parseArgs({
  options: {
    baseline: { type: 'string' },
    edited: { type: 'string' },
    output: { type: 'string' },
  },
});
assert.ok(
  values.baseline && values.edited && values.output,
  '--baseline --edited --output are required',
);
const paths = Object.fromEntries(
  Object.entries(values).map(([name, path]) => [name, resolve(path)]),
);
assert.ok(
  ![paths.baseline, paths.edited].includes(paths.output),
  '必须保存到新副本',
);
assert.ok(!existsSync(paths.output), '输出文件已存在，拒绝覆盖');
const baselineBytes = readFileSync(paths.baseline),
  editedBytes = readFileSync(paths.edited);
const baseline = decodeDocument(baselineBytes),
  edited = decodeDocument(editedBytes);
assert.equal(baseline.document.version, 4);
assert.equal(edited.document.version, 4);
const withoutSketches = ({ sketches: _sketches, ...document }) => document;
assert.equal(
  key(withoutSketches(baseline.document)),
  key(withoutSketches(edited.document)),
  '恢复仅允许来源变化，构造和属性必须与基准相同',
);
const changed = Object.keys(baseline.document.sketches).filter(
  (id) =>
    key(baseline.document.sketches[id]) !== key(edited.document.sketches[id]),
);
assert.equal(changed.length, 1, '恢复要求恰有一个改变的 Sketch');
const sketchId = changed[0],
  oldSketch = baseline.document.sketches[sketchId],
  editedSketch = edited.document.sketches[sketchId];
const changedPaths = Object.keys(oldSketch.paths).filter(
  (id) => key(oldSketch.paths[id]) !== key(editedSketch.paths[id]),
);
assert.equal(changedPaths.length, 1, '恢复要求恰有一个改变的 Path');
const pathId = changedPaths[0],
  oldPath = oldSketch.paths[pathId],
  editedPath = editedSketch.paths[pathId];
const oldIds = new Set(oldPath.edges.map((use) => use.edgeId)),
  newIds = new Set(editedPath.edges.map((use) => use.edgeId));
const removed = oldPath.edges.filter((use) => !newIds.has(use.edgeId));
const added = editedPath.edges.filter((use) => !oldIds.has(use.edgeId));
assert.equal(removed.length, 2);
assert.equal(added.length, 1);
const index = oldPath.edges.indexOf(removed[0]);
assert.equal(
  oldPath.edges[(index + 1) % oldPath.edges.length],
  removed[1],
  '只能合并相邻边',
);
const ends = (sketch, use) => {
  const edge = sketch.edges[use.edgeId];
  return use.reversed
    ? [edge.endVertexId, edge.startVertexId]
    : [edge.startVertexId, edge.endVertexId];
};
const left = ends(oldSketch, removed[0]),
  right = ends(oldSketch, removed[1]);
assert.equal(left[1], right[0]);
assert.deepEqual(
  ends(editedSketch, added[0]),
  [left[0], right[1]],
  '新边必须连接被删除节点两侧的原端点',
);
assert.ok(!editedSketch.vertices[left[1]], '被删除节点仍存在');
const converted = migrateRegionDefinitions(baseline.document);
const document = converted.document,
  basisSketch = document.sketches[sketchId];
const next = structuredClone(editedSketch);
for (const path of Object.values(next.paths)) {
  const basisPath = basisSketch.paths[path.id];
  if (basisPath.basisPeriod) path.basisPeriod = basisPath.basisPeriod;
  path.edges = path.edges.map((use) => {
    const existing = basisPath.edges.filter(
      (previous) =>
        previous.edgeId === use.edgeId && previous.reversed === use.reversed,
    );
    if (existing.length === 1)
      return { ...use, basisSpan: existing[0].basisSpan.slice() };
    assert.equal(path.id, pathId);
    assert.equal(use.edgeId, added[0].edgeId);
    return {
      ...use,
      basisSpan: mergeBasisSpans(
        basisPath.edges[index].basisSpan,
        basisPath.edges[(index + 1) % basisPath.edges.length].basisSpan,
        basisPath.basisPeriod,
      ),
    };
  });
}
document.sketches[sketchId] = next;
const snapshot = await evaluateDocument(document);
const unresolved = Object.entries(snapshot.planar.components).filter(
  ([, component]) =>
    Object.values(component.ports).some((stage) =>
      stage.diagnostics.some(
        (item) => item.code === 'region-definition-missing',
      ),
    ),
);
if (unresolved.length)
  writeFileSync(
    `${paths.output}.diagnostic.json`,
    JSON.stringify({ document, components: Object.fromEntries(unresolved) }),
  );
for (const [id, component] of Object.entries(snapshot.planar.components))
  for (const stage of Object.values(component.ports)) {
    assert.notEqual(
      stage.status,
      'blocked',
      `${id}: ${key(stage.diagnostics)}`,
    );
    assert.ok(
      !stage.diagnostics.some((item) => item.severity === 'error'),
      `${id}: ${key(stage.diagnostics.filter((item) => item.severity === 'error'))}`,
    );
  }
for (const name of ['relief', 'placedRelief', 'bodies'])
  assert.equal(
    snapshot[name].status,
    'ready',
    `${name}: ${key(snapshot[name].diagnostics)}`,
  );
for (const body of snapshot.bodies.value.bodies)
  assert.equal(body.report.valid, true);
const output = encodeDocument(document, { assets: edited.assets });
assert.deepEqual(decodeDocument(output).document, document);
writeFileSync(paths.output, output, { flag: 'wx' });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
console.log(
  JSON.stringify(
    {
      paths,
      baselineSha256: hash(baselineBytes),
      editedSha256: hash(editedBytes),
      outputSha256: hash(output),
      recovery: {
        sketchId,
        pathId,
        removedVertexId: left[1],
        removedEdges: removed.map((use) => use.edgeId),
        mergedEdge: added[0].edgeId,
      },
      migration: converted.report,
      regions: snapshot.regions.reduce(
        (sum, stage) => sum + stage.value.regions.length,
        0,
      ),
      bodies: snapshot.bodies.value.bodies.map((body) => body.report),
    },
    null,
    2,
  ),
);
