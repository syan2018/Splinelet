import assert from 'node:assert/strict';
import {
  resolvePropertyContributions,
  resolvePropertyPage,
  selectionPropertyTarget,
} from '../../../src/lib/editor/property-contributions.mjs';
import { selectCurvePreviews } from '../../../src/lib/editor/curve-preview-selection.mjs';

const rows = [
  { id: 'a', kind: 'shape' },
  { id: 'b', kind: 'shape' },
  { id: 'g', kind: 'group' },
];
const target = (kind, ids, owners = ids) =>
  selectionPropertyTarget({ kind, ids }, rows, owners);
assert.equal(target('object', []).kind, 'none');
assert.equal(target('object', ['gone']).kind, 'none');
assert.equal(target('object', ['a']).kind, 'shape');
assert.equal(target('object', ['g']).kind, 'group');
assert.equal(target('object', ['g']).ownerCount, 0);
assert.equal(target('object', ['g', 'a']).kind, 'mixed');
assert.equal(target('object', ['g', 'a']).ownerCount, 1);
assert.equal(target('path', ['path'], ['a']).kind, 'path');
assert.equal(target('cell', ['region'], ['a']).kind, 'region');

// A new domain can contribute a page without modifying the navigation host.
const pages = [
  { id: 'shape', order: 10, supports: (t) => t.kind === 'shape' },
  { id: 'ink', order: 30, supports: (t) => t.kind === 'path' },
  {
    id: 'custom',
    order: 20,
    supports: (t) => t.kind === 'shape' && t.count === 1,
  },
];
const snapshot = pages.slice();
const single = resolvePropertyContributions(pages, target('object', ['a']));
assert.deepEqual(
  single.map((p) => p.id),
  ['shape', 'custom'],
);
assert.deepEqual(pages, snapshot, 'resolving must not reorder registration');
const multiple = resolvePropertyContributions(
  pages,
  target('object', ['a', 'b']),
);
assert.deepEqual(
  multiple.map((p) => p.id),
  ['shape'],
);
assert.equal(resolvePropertyPage('custom', single, ['project']), 'custom');
assert.equal(resolvePropertyPage('custom', multiple, ['project']), 'shape');
assert.equal(resolvePropertyPage('custom', [], ['project']), 'tool');
assert.equal(resolvePropertyPage('project', single, ['project']), 'project');
assert.equal(resolvePropertyPage('tool', single, ['project']), 'tool');
assert.throws(
  () =>
    resolvePropertyContributions([...pages, pages[0]], target('object', ['a'])),
  /ID/,
);

const view = (objectId, stageId, count, extra = {}) => ({
  objectId,
  stageId,
  name: stageId,
  curves: Array(count).fill([]),
  junctions: [{ point: { x: 0, y: 0 }, degree: 1 }],
  ...extra,
});
const all = [
  view('a', 'mirror', 2),
  view('a', 'final', 8),
  view('b', 'final', 0, { diagnostic: '未发布曲线输出' }),
  view('b', 'fill-input:b', 12, { defaultPreview: true }),
];
const before = structuredClone(all);
const complete = selectCurvePreviews(all, undefined, false, 'mirror');
assert.deepEqual(
  complete.map((p) => p.curves.length),
  [8, 12],
);
assert.ok(complete.every((p) => !p.junctions.length));
const selected = selectCurvePreviews(all, 'a', true, 'mirror');
assert.deepEqual(
  selected.map((p) => p.curves.length),
  [2, 12],
);
assert.equal(selected[0].junctions.length, 1);
assert.equal(selected[1].junctions.length, 0);
assert.deepEqual(
  selectCurvePreviews(all, 'a', false, 'mirror').map((p) => p.objectId),
  ['b'],
);
assert.deepEqual(
  selectCurvePreviews(all, undefined, false, 'mirror'),
  complete,
  'deselection restores all complete results even after disabling or browsing an intermediate stage',
);
assert.deepEqual(all, before);
console.log(
  'PASS contribution registration/selection/fallback and selected-only curve stages with complete deselection',
);
