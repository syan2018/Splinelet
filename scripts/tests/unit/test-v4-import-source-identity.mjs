import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decodeProject } from '../../../src/lib/project-format.mjs';
import { importLegacy } from '../../../src/lib/document/import/legacy-import.mjs';
import {
  projectSourceView,
  sourcePathId,
} from '../../../src/lib/editor/source-view.mjs';

const files = [new URL('../fixtures/legacy-sandrone.spl', import.meta.url)];
// Unit runs only require the tracked fixture. Explicit extra files remain read-only.
if (process.argv[2]) files.push(process.argv[2]);
const key = (sketchId, id) => JSON.stringify([sketchId, id]);
for (const file of files) {
  const decoded = decodeProject(fs.readFileSync(file));
  const project = decoded.project || decoded;
  const imported = importLegacy(decoded);
  const expectedPaths = new Set();
  const expectedEdges = new Set();
  const orderedIds = [];
  for (const path of project.paths) {
    const ref = imported.idMap[`path:${path.id}`];
    assert.equal(
      ref.kind,
      'path',
      'each original path has exactly one source owner',
    );
    expectedPaths.add(key(ref.sketchId, ref.id));
    orderedIds.push(sourcePathId(ref.sketchId, ref.id));
    for (let index = 0; index < path.curves.length; index++) {
      const edge = imported.idMap[`edge:${path.id}:${index}`];
      assert.equal(edge.kind, 'edge');
      expectedEdges.add(key(edge.sketchId, edge.id));
    }
  }
  const actualPaths = new Set();
  const actualEdges = new Set();
  for (const sketch of Object.values(imported.document.sketches)) {
    const uses = new Map();
    const usedVertices = new Set();
    for (const path of Object.values(sketch.paths)) {
      actualPaths.add(key(sketch.id, path.id));
      if (path.startVertexId) usedVertices.add(path.startVertexId);
      for (const use of path.edges)
        uses.set(use.edgeId, (uses.get(use.edgeId) || 0) + 1);
    }
    for (const edge of Object.values(sketch.edges)) {
      actualEdges.add(key(sketch.id, edge.id));
      assert.equal(
        uses.get(edge.id),
        1,
        'import must not make original edges shared with generated helper paths',
      );
      usedVertices.add(edge.startVertexId);
      usedVertices.add(edge.endVertexId);
    }
    assert.deepEqual(
      new Set(Object.keys(sketch.vertices)),
      usedVertices,
      'no hidden orphan helper vertices',
    );
  }
  assert.deepEqual(
    actualPaths,
    expectedPaths,
    'all raw paths must come from original editable sources',
  );
  assert.deepEqual(
    actualEdges,
    expectedEdges,
    'evaluated connections must not become writable raw edges',
  );
  const projected = projectSourceView(imported.document, project);
  assert.deepEqual(
    projected.paths.map((path) => path.id),
    orderedIds,
  );
  assert.deepEqual(projected.orderedPathIds, orderedIds);
  console.log(
    `PASS imported source identity: ${expectedPaths.size} unique paths, ${expectedEdges.size} original edges, exact source order, no writable derived helpers`,
  );
}
