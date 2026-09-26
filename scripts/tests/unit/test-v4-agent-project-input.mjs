import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readAgentProjectInput } from '../../../src/lib/persistence/agent-project-input.mjs';
import { openProject } from '../../../src/lib/persistence/open-project.mjs';
import { decodeProject } from '../../../src/lib/project-format.mjs';
import { encodeDocument } from '../../../src/lib/document/codec.mjs';

const bytes = readFileSync(
  new URL('../fixtures/legacy-sandrone.spl', import.meta.url),
);
const project = decodeProject(bytes);
const original = structuredClone(project);
const legacyInput = readAgentProjectInput({ project });
assert.deepEqual(JSON.parse(legacyInput.bytes), original);
const migrated = openProject(legacyInput);
assert.equal(migrated.kind, 'migrated');
assert.equal(migrated.document.version, 5);
assert.equal(migrated.dirty, true);
assert.ok(migrated.report?.regionMigration);
assert.deepEqual(project, original);
const canonical = encodeDocument(migrated.document, {
  assets: migrated.assets,
});
const input = readAgentProjectInput({
  base64: Buffer.from(canonical).toString('base64'),
  filename: 'copy.spl',
});
assert.equal(input.name, 'copy.spl');
assert.deepEqual(input.bytes, canonical);
const reopened = openProject(input);
assert.equal(reopened.kind, 'v5');
assert.equal(reopened.document.version, 5);
assert.equal(reopened.report, null);
assert.deepEqual(reopened.document, migrated.document);
assert.deepEqual(reopened.assets, migrated.assets);
assert.equal(reopened.target, null);
assert.throws(() =>
  openProject(readAgentProjectInput({ project: migrated.document })),
);
for (const invalid of [
  null,
  [],
  {},
  { project, base64: 'AAAA' },
  { project: null },
  { project, filename: '' },
  { base64: '???=' },
  { base64: 'AAA' },
  { base64: '' },
  { base64: 'AAAA', target: '/user/file.spl' },
])
  assert.throws(() => readAgentProjectInput(invalid));
assert.throws(() => openProject(readAgentProjectInput({ base64: 'AAAA' })));
console.log(
  'PASS API project envelopes migrate legacy V4 authority to V5, preserve assets, and reject ambiguous, invalid and raw V4 inputs',
);
