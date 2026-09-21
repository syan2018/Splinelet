import assert from 'node:assert/strict';
import { repeatedRingDocument } from '../fixtures/v4-programs.mjs';
import {
  defaultConstructionRegistry,
  evaluatePlanar,
} from '../../../src/lib/construction/document-evaluation.mjs';
import { readGeometry } from '../../../src/lib/region-engine.mjs';
import { transformNodes } from '../../../src/lib/scene/hierarchy.mjs';
import { planNodeRebase } from '../../../src/lib/scene/rebase.mjs';

const document = repeatedRingDocument();
const before = structuredClone(document);
const evaluate = (value) => evaluatePlanar(value);
const result = evaluate(document);
assert.equal(result.published['shape:curves'].status, 'ready');
assert.equal(
  result.published['shape:regions'].status,
  'ready',
  JSON.stringify(result.published['shape:regions'].diagnostics),
);
const region = result.published['shape:regions'].value.regions[0];
const geometry = readGeometry(region.geometry);
assert.equal(geometry.getNumInteriorRing(), 1);
assert.ok(Math.abs(geometry.getArea() - 150 * Math.sqrt(2)) < 1e-6);
assert.equal(
  result.components['operator:source'].ports.curves.value.curves.length,
  2,
);
assert.ok(
  result.components['operator:source'].ports.curves.value.curves.every(
    (curve) => !curve.closed,
  ),
);
assert.equal(result.published['shape:curves'].value.junctions.length, 16);
assert.deepEqual(document, before);
const moved = transformNodes(document, ['shape'], [0, 1, -1, 0, 20, 10]);
assert.deepEqual(
  evaluate(moved).published['shape:regions'].value,
  result.published['shape:regions'].value,
);
const rebased = planNodeRebase(
  document,
  'shape',
  { translationMM: [3, 6], rotationRad: 0.31 },
  {
    rebaseOperator: (operator, context) => {
      const spec = defaultConstructionRegistry.get(operator.type);
      if (!spec?.rebase) throw Error('未知算子不可重表达');
      return spec.rebase(operator, context);
    },
  },
).document;
const rebasedResult = evaluate(rebased);
assert.equal(
  rebasedResult.published['shape:regions'].status,
  'ready',
  JSON.stringify(rebasedResult.published['shape:regions'].diagnostics),
);
assert.ok(
  Math.abs(
    readGeometry(
      rebasedResult.published['shape:regions'].value.regions[0].geometry,
    ).getArea() - geometry.getArea(),
  ) < 1e-6,
);
assert.deepEqual(
  rebasedResult.published['shape:regions'].value.regions[0].ref,
  region.ref,
);
const broken = structuredClone(document);
broken.sketches.sketch.vertices['outer-b'].position.value[0] += 0.1;
const failed = evaluate(broken);
assert.equal(failed.published['shape:curves'].status, 'ready');
assert.equal(failed.published['shape:regions'].status, 'blocked');
assert.equal(failed.published['shape:regions'].value, undefined);
const empty = structuredClone(document);
empty.programs.program.operators.source.inputs.paths[0].pathIds = [];
const emptyResult = evaluate(empty);
assert.equal(emptyResult.published['shape:curves'].status, 'empty');
assert.equal(emptyResult.published['shape:regions'].status, 'empty');
console.log(
  'PASS: real Source → Mirror → Array → Join → Fill preserves open source, hole, pose/rebase and current failure/empty states',
);
