import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const catalogUrl = new URL(
  '../../../src/lib/agent/tool-catalog.ts',
  import.meta.url,
).href;
const modelUrl = new URL('../../../src/lib/model-api.ts', import.meta.url).href;
const creationUrl = new URL('../../../src/lib/creation-api.ts', import.meta.url)
  .href;
const splineUrl = new URL('../../../src/lib/spline-api.ts', import.meta.url)
  .href;

const program = `
  import { createStudioAgentTools } from ${JSON.stringify(catalogUrl)};
  import { modelTools } from ${JSON.stringify(modelUrl)};
  import { creationTools } from ${JSON.stringify(creationUrl)};
  import { splineTools } from ${JSON.stringify(splineUrl)};
  const tools = createStudioAgentTools({ modelTools, creationTools, splineTools });
  process.stdout.write(JSON.stringify({
    names: Object.keys(tools).sort(),
    createPath: tools.create_path,
    discardPreview: tools.discard_preview,
    creationCommand: tools.creation_command,
    splineApply: tools.spline_apply,
    modelWrite: tools.commit_region_preview,
    workspace: tools.set_workspace,
    state: tools.state,
    authoring: tools['authoring.run'],
  }));
`;
const result = JSON.parse(
  execFileSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '--eval', program],
    { encoding: 'utf8' },
  ),
);

assert.ok(result.names.includes('capabilities.get'));
assert.ok(result.names.includes('create_path'));
assert.equal(result.createPath.compatibilityWrite, true);
assert.deepEqual(result.createPath.required, ['points']);
assert.equal(result.discardPreview.compatibilityWrite, undefined);
assert.equal(result.creationCommand.compatibilityWrite, true);
assert.equal(result.splineApply.compatibilityWrite, true);
assert.equal(result.modelWrite.compatibilityWrite, true);
assert.equal(result.workspace.compatibilityWrite, undefined);
assert.equal(result.state.readOnly, true);
assert.deepEqual(result.authoring.required, ['expectedRevision', 'action']);

console.log(
  'PASS: public Studio tool catalog drives names, schemas, readonly hints, and compatibility revision guards.',
);
