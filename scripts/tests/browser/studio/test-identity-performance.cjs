const assert = require('node:assert/strict');
const { writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');

async function setup(context) {
  await context.addInitScript(() => {
    const samples = [],
      requests = [],
      pending = new Map();
    let armed = null,
      active = null;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', ({ data }) => {
          const item = pending.get(data?.requestId);
          if (!item) return;
          pending.delete(data.requestId);
          requests.push({ ...item, end: performance.now(), kind: data.kind });
        });
      }
      postMessage(data, ...args) {
        if (data?.kind === 'evaluate')
          pending.set(data.requestId, {
            start: performance.now(),
            domains: data.domains,
            revision: data.revision,
          });
        return super.postMessage(data, ...args);
      }
    };
    const begin = (event) => {
      if (!armed || (event.type === 'keydown' && event.key !== 'Enter')) return;
      active = {
        label: armed,
        start: performance.now(),
        shown: null,
        finishing: false,
      };
      armed = null;
    };
    document.addEventListener('click', begin, true);
    document.addEventListener('keydown', begin, true);
    new MutationObserver(() => {
      const sample = active;
      if (!sample) return;
      if (document.querySelector('.creation-updating')) {
        sample.shown ??= performance.now();
      } else if (sample.shown !== null && !sample.finishing) {
        sample.finishing = true;
        const hidden = performance.now();
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (active !== sample) return;
            if (document.querySelector('.creation-updating')) {
              sample.finishing = false;
              return;
            }
            const end = performance.now();
            samples.push({
              label: sample.label,
              inputToPaintMs: end - sample.start,
              updatingMs: hidden - sample.shown,
              workers: requests
                .filter((item) => item.start >= sample.start && item.end <= end)
                .map((item) => ({
                  ...item,
                  durationMs: item.end - item.start,
                })),
            });
            active = null;
          }),
        );
      }
    }).observe(document, { childList: true, subtree: true });
    window.identityPerformance = {
      samples,
      arm: (label) => {
        armed = label;
      },
    };
  });
}

module.exports = async (page, output) => {
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('[data-creation-cell]').first().waitFor();
  await page.locator('.creation-updating').waitFor({ state: 'hidden' });
  await page.evaluate(() => {
    window.identityBaseline = JSON.stringify(window.originalStudioDocument());
  });
  await page.locator('[data-tree-object]').first().click();
  const commit = async (label, action) => {
    const count = await page.evaluate((name) => {
      window.identityPerformance.arm(name);
      return window.identityPerformance.samples.length;
    }, label);
    await action();
    await page.waitForFunction(
      (before) => window.identityPerformance.samples.length > before,
      count,
    );
  };
  const undo = async (label) => {
    await commit(label, () =>
      page.getByRole('button', { name: '撤销', exact: true }).click(),
    );
    assert.ok(
      await page.evaluate(
        () =>
          JSON.stringify(window.originalStudioDocument()) ===
          window.identityBaseline,
      ),
      'undo restores the entire document',
    );
  };
  for (let iteration = 0; iteration < 3; iteration++) {
    await page
      .getByRole('button', { name: '当前选区颜色', exact: true })
      .click();
    await page.getByLabel('选区颜色 HEX', { exact: true }).fill('#102030');
    await commit(`color-${iteration}`, () =>
      page.getByRole('button', { name: '应用', exact: true }).click(),
    );
    assert.ok(
      await page.evaluate(() => {
        const document = window.originalStudioDocument();
        return Object.values(document.appearances.swatches).some(
          (item) => item.color === '#102030',
        );
      }),
    );
    await undo(`undo-color-${iteration}`);
    await page
      .getByRole('button', { name: '当前选区浮雕厚度', exact: true })
      .click();
    const thickness = page.getByLabel('厚度打印层数', { exact: true });
    const before = await thickness.inputValue();
    await thickness.fill(String(Number(before) + 1));
    await commit(`thickness-${iteration}`, () => thickness.press('Enter'));
    assert.notEqual(
      await page.evaluate(() =>
        JSON.stringify(window.originalStudioDocument()),
      ),
      await page.evaluate(() => window.identityBaseline),
    );
    await undo(`undo-thickness-${iteration}`);
  }
  assert.deepEqual(errors, []);
  const samples = await page.evaluate(() => window.identityPerformance.samples);
  assert.equal(samples.length, 12);
  assert.ok(
    samples.every((sample) =>
      sample.workers.every((worker) => worker.kind === 'result'),
    ),
  );
  await writeFile(
    resolve(output, 'identity-performance.json'),
    JSON.stringify(samples, null, 2),
  );
  await page.screenshot({ path: resolve(output, 'identity-performance.png') });
  console.log(
    'PASS identity performance: original Sandrone colour/thickness edits and full undo through GUI; timings recorded without machine-dependent thresholds',
  );
};
module.exports.setup = setup;
