module.exports = async (page) => {
  const assert = require('node:assert/strict');
  const { decodeProject } = await import('../../../src/lib/project-format.mjs');
  const call = (action, args = {}) =>
    page.evaluate(({ action, args }) => window.traceStudio.call(action, args), {
      action,
      args,
    });
  const readSaved = async () =>
    decodeProject(
      new Uint8Array(
        await page.evaluate(async () =>
          Array.from(
            new Uint8Array(
              await (await window.testSaveHandle.getFile()).arrayBuffer(),
            ),
          ),
        ),
      ),
    );
  const waitSaved = (text) =>
    page.waitForFunction(
      (text) =>
        [...document.querySelectorAll('.project-name i')].some((element) =>
          element.textContent?.includes(text),
        ),
      text,
    );

  await page.getByRole('button', { name: '保存工程', exact: true }).waitFor();
  const anchors = [
    { x: 20, y: 20 },
    { x: 180, y: 20 },
    { x: 180, y: 120 },
    { x: 20, y: 120 },
    { x: 20, y: 20 },
  ];
  await call('load_project', {
    project: {
      version: 1,
      image: '/reference.png',
      imageName: 'Manual save fixture',
      width: 200,
      height: 160,
      widthMM: 100,
      depthMM: 2,
      paths: [
        {
          id: 'fixture-rectangle',
          name: 'Fixture rectangle',
          color: '#a59883',
          visible: true,
          closed: true,
          quality: 1,
          start: anchors[0],
          anchors,
          nodeModes: anchors.slice(1).map(() => 'corner'),
          curves: anchors
            .slice(1)
            .map((end, index) => [anchors[index], anchors[index], end, end]),
        },
      ],
    },
  });
  await page.waitForFunction(async () => {
    const state = await window.traceStudio.call('state');
    return state.ready && !state.busy;
  });
  await page.locator('.creation-updating').waitFor({ state: 'hidden' });
  await page.evaluate(async () => {
    window.testSaveHandle = await (
      await navigator.storage.getDirectory()
    ).getFileHandle('manual-save-test.spl', { create: true });
    window.showSaveFilePicker = async () => window.testSaveHandle;
  });
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await waitSaved('已保存到 manual-save-test.spl');
  const beforeEdit = await readSaved();

  const created = await call('manage_group', {
    action: 'create',
    name: 'Manual save only',
  });
  await page.waitForTimeout(1100);
  assert.equal(
    (await readSaved()).groups?.length || 0,
    beforeEdit.groups?.length || 0,
    'browser autosave must not write the bound project file',
  );
  await waitSaved('浏览器草稿已保存');
  assert(
    (await call('get_project')).groups.some((group) => group.id === created.id),
    'the browser draft retains the unsaved edit',
  );

  await page.reload();
  await page.waitForFunction(() => window.traceStudio);
  await page.evaluate(async () => {
    // Reopen the test-owned OPFS file; the application independently restores
    // its bound handle from IndexedDB. Do not depend on a public source URL.
    window.testSaveHandle = await (
      await navigator.storage.getDirectory()
    ).getFileHandle('manual-save-test.spl');
  });
  await waitSaved('浏览器草稿已保存');
  assert(
    (await call('get_project')).groups.some((group) => group.id === created.id),
    'reload restores the latest browser draft',
  );
  assert.equal(
    (await readSaved()).groups?.length || 0,
    beforeEdit.groups?.length || 0,
    'restoring a browser draft must not write the bound project file',
  );

  await page.keyboard.press('Control+s');
  await waitSaved('已保存到 manual-save-test.spl');
  assert(
    (await readSaved()).groups.some((group) => group.id === created.id),
    'Ctrl+S writes the latest project to the bound file',
  );
  console.log(
    'PASS: browser drafts survive reload without writing a bound file; Ctrl+S is the only write trigger.',
  );
};
