async (page) => {
  const check = (v, m) => {
    if (!v) throw Error(m);
  };
  const call = async (action, args = {}) => {
    const v = await page.evaluate(
      ({ action, args }) => window.traceStudio.call(action, args),
      { action, args },
    );
    return v;
  };
  await page.getByRole('button', { name: '另存为', exact: true }).waitFor();
  await page.evaluate(async () => {
    window.testSaveHandle = await (
      await navigator.storage.getDirectory()
    ).getFileHandle('stable-save-test.json', { create: true });
    window.pickerCount = 0;
    window.showSaveFilePicker = async () => {
      window.pickerCount++;
      return window.testSaveHandle;
    };
  });
  await page.getByRole('button', { name: '保存工程', exact: true }).click();
  await page
    .locator('.project-name i')
    .filter({ hasText: '已保存到 stable-save-test.json' })
    .waitFor();
  let disk = await page.evaluate(async () =>
    JSON.parse(await (await window.testSaveHandle.getFile()).text()),
  );
  const count = disk.paths.length;
  const created = await call('create_path', {
    name: 'Storage autosave check',
    mode: 'manual',
    points: [
      { x: 30, y: 310 },
      { x: 150, y: 360 },
    ],
  });
  await page
    .getByRole('button', {
      name: 'Storage autosave check 开放 · 1 段',
      exact: true,
    })
    .waitFor();
  await page
    .locator('.project-name i')
    .filter({ hasText: '已保存到 stable-save-test.json' })
    .waitFor();
  disk = await page.evaluate(async () =>
    JSON.parse(await (await window.testSaveHandle.getFile()).text()),
  );
  check(
    disk.paths.length === count + 1 &&
      disk.paths.some((p) => p.id === created.id),
    'automatic write must update original file',
  );
  await page.keyboard.press('Control+s');
  await page
    .locator('.project-name i')
    .filter({ hasText: '已保存到 stable-save-test.json' })
    .waitFor();
  check(
    (await page.evaluate(() => window.pickerCount)) === 1,
    'Ctrl S must not open another save picker',
  );
  const snapshot = JSON.stringify((await call('get_project')).paths);
  await page.reload();
  await page
    .locator('.project-name i')
    .filter({ hasText: '点击保存重新连接' })
    .waitFor();
  check(
    JSON.stringify((await call('get_project')).paths) === snapshot,
    'reload restores latest project',
  );
  check(
    (await call('state')).storage.fileName === 'stable-save-test.json',
    'file association survives reload',
  );
  await page.keyboard.press('Control+s');
  await page
    .locator('.project-name i')
    .filter({ hasText: '已保存到 stable-save-test.json' })
    .waitFor();
  await page.evaluate(async () => {
    window.showSaveFilePicker = async () => {
      const h = await (
        await navigator.storage.getDirectory()
      ).getFileHandle('stable-copy.json', { create: true });
      return h;
    };
  });
  await page.getByRole('button', { name: '另存为', exact: true }).click();
  await page
    .locator('.project-name i')
    .filter({ hasText: '已保存到 stable-copy.json' })
    .waitFor();
  check(
    (await call('state')).storage.fileName === 'stable-copy.json',
    'Save As switches binding',
  );
  const p = await call('get_project');
  await call('load_project', { project: { ...p, paths: [] } });
  await page
    .locator('.project-name i')
    .filter({ hasText: '已保存到此浏览器' })
    .waitFor();
  check(
    (await call('state')).storage.fileName === null,
    'import detaches old file',
  );
  const unchanged = await page.evaluate(async () =>
    JSON.parse(
      await (
        await (await navigator.storage.getDirectory()).getFileHandle(
          'stable-copy.json',
        )
      )
        .getFile()
        .then((f) => f.text()),
    ),
  );
  check(
    unchanged.paths.length === count + 1,
    'import must not overwrite previous file',
  );
  console.log(
    'PASS: file creation, autosave same file, Ctrl+S without picker, refresh recovery, handle persistence, Save As, import detachment. File handles use actual browser-private filesystem; OS picker is substituted only in this isolated test.',
  );
}
