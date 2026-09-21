// Supply a Playwright Browser and a valid project fixture; uses a fresh context.
module.exports = async (browser, url, project) => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    let pending;
    const requested = new Promise((resolve) => {
      page.route('**/sandrone-example.spl', (route) => {
        pending = route;
        resolve();
      });
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await requested;
    await page.waitForFunction(() => window.traceStudio);
    await page.evaluate(async (project) => {
      const observed = await window.traceStudio.call('document.get');
      return window.traceStudio.call('load_project', {
        expectedRevision: observed.revision,
        project,
      });
    }, project);
    const imported = await page.evaluate(() =>
      window.traceStudio.call('get_project'),
    );
    await pending.continue();
    await page.waitForFunction(
      () =>
        !document.querySelector('footer')?.textContent.includes('正在恢复工程'),
    );
    const actual = await page.evaluate(() =>
      window.traceStudio.call('get_project'),
    );
    require('node:assert/strict').deepEqual(
      actual,
      imported,
      'late startup response must not overwrite imported work',
    );
    return { ok: true, sourcePaths: actual.paths.length };
  } finally {
    await context.close();
  }
};
