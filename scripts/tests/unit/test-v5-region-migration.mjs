import assert from 'node:assert/strict';
import { createDocument } from '../../../src/lib/document/schema.mjs';
import { createEditorSession } from '../../../src/lib/editing/dispatcher.mjs';
import { createAuthoringCommand } from '../../../src/lib/editing/commands/authoring.mjs';
import {
  evaluateProgram,
  evaluatePlanar,
} from '../../../src/lib/construction/document-evaluation.mjs';
import { migrateRegionDefinitions } from '../../../src/lib/document/import/region-definitions.mjs';
import {
  encodeDocument,
  decodeDocument,
} from '../../../src/lib/document/codec.mjs';
import { readGeometry } from '../../../src/lib/region-engine.mjs';
import { validateDurableRegionReferences } from '../../../src/lib/document/region-reference-validation.mjs';

let serial = 0;
const idFactory = () => `migration-${++serial}`;
const legacy = createEditorSession(createDocument({ version: 4, idFactory }), {
  idFactory,
});
const run = (editor, request) =>
  editor.dispatch(createAuthoringCommand(request), {
    expectedRevision: editor.state.revision,
  });
run(legacy, {
  kind: 'draw-path',
  points: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
  closed: true,
});
const owner = Object.keys(legacy.state.document.nodes)[0];
const regions = (editor) =>
  evaluateProgram(editor.state.document, owner).regions.value.regions;
run(legacy, { kind: 'create-swatch', name: 'red', color: '#ff0000' });
const swatchId = Object.keys(legacy.state.document.appearances.swatches)[0];
run(legacy, { kind: 'paint-region', target: regions(legacy)[0].ref, swatchId });
run(legacy, {
  kind: 'set-thickness',
  target: regions(legacy)[0].ref,
  thickness: { kind: 'mm', value: 1.5 },
});
const known = new Set(Object.keys(legacy.state.document.sketches));
run(legacy, {
  kind: 'start-path',
  role: 'divider',
  targets: [regions(legacy)[0].ref],
  ownerNodeId: owner,
  point: [-1, 5],
});
const divider = Object.values(legacy.state.document.sketches).find(
  (sketch) => !known.has(sketch.id),
);
const dividerPathId = Object.keys(divider.paths)[0];
for (const [a, b] of [
  [
    [-1, 5],
    [5, 5],
  ],
  [
    [5, 5],
    [11, 5],
  ],
])
  run(legacy, {
    kind: 'extend-path',
    sketchId: divider.id,
    pathId: dividerPathId,
    cubic: [a, a, b, b],
  });
run(legacy, {
  kind: 'finish-path',
  sketchId: divider.id,
  pathId: dividerPathId,
});
assert.equal(regions(legacy).length, 2);
const original = structuredClone(legacy.state.document);
const converted = migrateRegionDefinitions(original, { idFactory });
assert.deepEqual(original, legacy.state.document);
assert.equal(converted.document.version, 5);
assert.ok(converted.report.regions >= 3);
validateDurableRegionReferences(converted.document);
assert.deepEqual(
  decodeDocument(encodeDocument(converted.document)).document,
  converted.document,
);
const editor = createEditorSession(converted.document, { idFactory });
for (const region of regions(editor)) {
  assert.equal(
    regions(legacy).filter(
      (old) =>
        readGeometry(old.geometry)
          .symDifference(readGeometry(region.geometry))
          .getArea() < 1e-8,
    ).length,
    1,
  );
  assert.equal(
    Object.values(editor.state.document.appearances.overrides).find(
      (item) => item.target.key === region.ref.key,
    ).value.swatchId,
    swatchId,
  );
}
const before = regions(editor);
const cutter = Object.values(editor.state.document.sketches).find(
  (sketch) => Object.values(sketch.paths)[0].edges.length === 2,
);
run(editor, {
  kind: 'reverse-path',
  sketchId: cutter.id,
  pathId: Object.keys(cutter.paths)[0],
});
for (const region of regions(editor)) {
  const old = before.find((item) => item.ref.key === region.ref.key);
  assert.ok(old);
  assert.equal(
    readGeometry(old.geometry)
      .symDifference(readGeometry(region.geometry))
      .getArea(),
    0,
  );
}
const cache = new Map();
evaluatePlanar(converted.document, { cache });
const warm = evaluatePlanar(editor.state.document, { cache });
assert.deepEqual(
  warm.published,
  evaluatePlanar(editor.state.document).published,
);
assert.deepEqual(
  editor.state.document,
  decodeDocument(encodeDocument(editor.state.document)).document,
);
const invalid = structuredClone(editor.state.document);
Object.values(invalid.appearances.overrides)[0].target.key = 'cell:old';
assert.throws(() => encodeDocument(invalid), /未声明|不一致/);
const cyclic = structuredClone(editor.state.document);
const definition = Object.values(cyclic.regionDefinitions)[0];
definition.selector = {
  kind: 'result',
  role: 'offset',
  parent: {
    kind: 'output',
    ...definition.context,
    key: definition.id,
    lineage: [],
  },
};
assert.throws(() => encodeDocument(cyclic), /循环/);
console.log(
  'PASS V4 migration verifies a bijection, preserves assignments, saves only definitions and evaluates independently of history',
);
