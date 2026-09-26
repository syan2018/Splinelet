#!/usr/bin/env node
const assert = require('node:assert/strict');
const { mkdir, writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');

const samePort = (left, right) =>
  left?.kind === right?.kind &&
  left?.ownerNodeId === right?.ownerNodeId &&
  left?.operatorId === right?.operatorId &&
  left?.port === right?.port &&
  left?.domain === right?.domain;

async function test(page, outputDirectory) {
  const evidence = () =>
    page.evaluate(() => window.modifierChainRecovery.evidence());
  const documentState = () =>
    page.evaluate(() => window.modifierChainRecovery.document());
  const evaluate = () =>
    page.evaluate(() => window.modifierChainRecovery.evaluate());
  const waitFor = (predicate, arg, timeout = 20_000) =>
    page.waitForFunction(predicate, arg, { timeout });

  await page.locator('.studio.creation-studio').waitFor({ timeout: 60_000 });
  await page.locator('.source-path-layer').first().waitFor();
  const initial = await evaluate();
  assert.equal(
    initial.status,
    'ready',
    'mirror must first publish a usable result',
  );
  assert.ok(
    initial.lastSuccessfulRevision !== null,
    'fixture must retain a successful revision for its read-only snapshot',
  );

  const selected = await page.evaluate(async () => {
    const state = window.modifierChainRecovery.evidence();
    await window.traceStudio.call('select_paths', {
      pathIds: [state.ownerPathId],
    });
    return state;
  });
  assert.ok(selected.ownerPathId, 'owner must have one projected source path');
  await page.getByLabel('选择操作', { exact: true }).click();
  await page.getByRole('button', { name: '选择整个部件', exact: true }).click();
  await page
    .getByRole('button', { name: '当前部件构造与修改器', exact: true })
    .click();
  const mirrorCard = page.locator(`[data-modifier-id="${selected.mirrorId}"]`);
  await mirrorCard.waitFor();
  await mirrorCard
    .getByRole('button', { name: '参数 曲线镜像', exact: true })
    .click();
  await mirrorCard
    .getByRole('spinbutton', { name: '镜像轴角度', exact: true })
    .waitFor();

  const broken = await page.evaluate(() =>
    window.modifierChainRecovery.breakInput(),
  );
  const brokenDocument = await documentState();
  assert.equal(broken.input.operatorId, 'removed-producer');

  await evaluate();
  await waitFor(
    () => window.modifierChainRecovery.evidence().status === 'blocked',
    undefined,
  );
  const blocked = await evidence();
  assert.equal(blocked.freshness, 'stale');
  assert.ok(
    blocked.lastSuccessfulRevision !== null,
    'broken chain must keep a prior result only as a stale snapshot',
  );
  assert(
    blocked.inputView.inputs[0].diagnostics.some(
      (item) => item.code === 'invalid-port-owner',
    ),
    'the broken producer must be diagnosed at the input port',
  );

  const recovery = mirrorCard.getByText('输入关联与结果快照', { exact: true });
  await recovery.click();
  await page.getByText('原输入已不可用').waitFor();
  const staleSnapshot = mirrorCard.locator(
    'figure:has(svg[aria-label*="上次成功，仅供参考"])',
  );
  await staleSnapshot.waitFor();
  await staleSnapshot.scrollIntoViewIfNeeded();
  await staleSnapshot.screenshot({
    path: resolve(
      outputDirectory,
      'modifier-chain-recovery-stale-snapshot.png',
    ),
  });
  await page.screenshot({
    path: resolve(outputDirectory, 'modifier-chain-recovery-broken.png'),
    fullPage: true,
  });

  const originalOptionIndex = blocked.inputView.inputs[0].options.findIndex(
    (option) => samePort(option.reference, blocked.originalInput),
  );
  assert.ok(
    originalOptionIndex >= 0,
    'the original source port must be selectable',
  );
  const replacement = mirrorCard.getByLabel('替代输入 input 1', {
    exact: true,
  });
  await replacement.selectOption(String(originalOptionIndex));
  const replacementControls = replacement.locator('xpath=..');
  await replacementControls.scrollIntoViewIfNeeded();
  const preview = mirrorCard.getByRole('button', {
    name: '预览替换',
    exact: true,
  });
  assert.equal(
    await preview.isEnabled(),
    true,
    'selected source must enable preview',
  );
  await replacementControls.screenshot({
    path: resolve(outputDirectory, 'modifier-chain-recovery-broken-detail.png'),
  });
  await page.screenshot({
    path: resolve(outputDirectory, 'modifier-chain-recovery-broken-choice.png'),
    fullPage: true,
  });
  await preview.click();
  await mirrorCard
    .getByRole('button', { name: '确认替换输入', exact: true })
    .waitFor();
  await mirrorCard.getByRole('button', { name: '取消', exact: true }).click();
  assert.deepEqual(
    await documentState(),
    brokenDocument,
    'cancelling a replacement preview cannot mutate the broken authority document',
  );

  await replacement.selectOption(String(originalOptionIndex));
  await mirrorCard
    .getByRole('button', { name: '预览替换', exact: true })
    .click();
  await mirrorCard
    .getByRole('button', { name: '确认替换输入', exact: true })
    .click();
  await waitFor(
    (revision) => window.modifierChainRecovery.evidence().revision > revision,
    broken.revision,
  );
  const recovered = await evaluate();
  assert.equal(
    recovered.status,
    'ready',
    'confirmed explicit rebind must recover the chain',
  );
  assert.deepEqual(recovered.input, recovered.originalInput);

  const undo = await page.evaluate(() => window.modifierChainRecovery.undo());
  assert.equal(undo.input.operatorId, 'removed-producer');
  const afterUndo = await documentState();
  assert.deepEqual(
    afterUndo.programs[selected.ownerProgramId].operators[selected.mirrorId]
      .inputs.input[0],
    brokenDocument.programs[selected.ownerProgramId].operators[
      selected.mirrorId
    ].inputs.input[0],
    'one undo must restore the broken graph for an intentional next repair',
  );

  // Return to the original mirror graph before exercising a separate Fill
  // RegionDefinition failure in the same isolated Studio session.
  const original = await page.evaluate(() =>
    window.modifierChainRecovery.undo(),
  );
  assert.deepEqual(original.input, original.originalInput);
  await evaluate();
  const selectionBroken = await page.evaluate(() =>
    window.modifierChainRecovery.breakSelection(),
  );
  await evaluate();
  await waitFor(
    () =>
      window.modifierChainRecovery
        .evidence()
        .selectionView.definitions.some(
          (definition) => definition.status === 'missing',
        ),
    undefined,
  );
  const missingSelection = await evidence();
  const selection = missingSelection.selectionView.definitions.find(
    (definition) => definition.status === 'missing',
  );
  assert.ok(selection, 'broken boundary path must expose a missing selection');
  assert.ok(
    selection.candidates.some((candidate) => !candidate.occupiedByDefinitionId),
    'current Fill stage retains an unbound candidate for explicit selection',
  );
  const selectionBrokenDocument = await documentState();
  const selectionAttributes = structuredClone(
    Object.values(selectionBrokenDocument.appearances.overrides).filter(
      (override) => override.target?.key === selection.definitionId,
    ),
  );

  const fillCard = page.locator(
    `[data-modifier-id="${missingSelection.fillId}"]`,
  );
  await fillCard.waitFor();
  await fillCard.getByRole('button', { name: /^参数 / }).click();
  await fillCard.getByText('输入关联与结果快照', { exact: true }).click();
  await fillCard.getByText(/^局部区域选择 ·/).click();
  const choice = fillCard.getByLabel('重指定局部选择 1', { exact: true });
  await choice.waitFor();
  await choice.selectOption('0');
  await fillCard.screenshot({
    path: resolve(
      outputDirectory,
      'modifier-chain-recovery-selection-missing.png',
    ),
  });
  await fillCard
    .getByRole('button', { name: '预览重新选择', exact: true })
    .click();
  await fillCard
    .getByRole('button', { name: '取消重新选择', exact: true })
    .click();
  assert.deepEqual(
    await documentState(),
    selectionBrokenDocument,
    'cancelling selection preview leaves authority unchanged',
  );
  await choice.selectOption('0');
  await fillCard
    .getByRole('button', { name: '预览重新选择', exact: true })
    .click();
  await fillCard
    .getByRole('button', { name: '确认重新选择', exact: true })
    .click();
  await evaluate();
  const reboundSelection = await evidence();
  assert.equal(
    reboundSelection.selectionView.definitions.find(
      (definition) => definition.definitionId === selection.definitionId,
    ).status,
    'resolved',
  );
  const reboundDocument = await documentState();
  assert.equal(
    reboundDocument.regionDefinitions[selection.definitionId].id,
    selection.definitionId,
    'confirmation retains the stable definition ID',
  );
  assert.deepEqual(
    Object.values(reboundDocument.appearances.overrides).filter(
      (override) => override.target?.key === selection.definitionId,
    ),
    selectionAttributes,
    'confirmation retains the selection appearance attributes',
  );
  await page.evaluate(() => window.modifierChainRecovery.undo());
  await evaluate();
  assert.equal(
    (await evidence()).selectionView.definitions.find(
      (definition) => definition.definitionId === selection.definitionId,
    ).status,
    'missing',
    'undo restores the missing selection',
  );

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    resolve(outputDirectory, 'modifier-chain-recovery.json'),
    JSON.stringify(
      {
        initial,
        broken,
        blocked,
        recovered,
        undo,
        selectionBroken,
        reboundSelection,
      },
      null,
      2,
    ),
  );
}

module.exports = test;

if (require.main === module) {
  const harness = require('../harness/browser-runner.cjs');
  harness.studioCases.push({
    name: 'modifier-chain-recovery',
    module: 'studio/test-modifier-chain-recovery.cjs',
    adapter: 'studio-fixture',
    fixture: {
      kind: 'file',
      path: 'scripts/tests/fixtures/modifier-chain-recovery.mjs',
    },
  });
  const options = harness.parseArguments([
    '--suite',
    'studio',
    '--case',
    'modifier-chain-recovery',
    ...process.argv.slice(2),
  ]);
  harness
    .run(options)
    .then(({ outputDirectory }) => console.log(`Evidence: ${outputDirectory}`))
    .catch((error) => {
      console.error(
        error instanceof Error ? error.stack || error.message : error,
      );
      process.exitCode = 1;
    });
}
