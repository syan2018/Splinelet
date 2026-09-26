const assert = require('node:assert/strict');
const { writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');

async function setup(context) {
  await context.addInitScript(() => {
    const entries = [];
    new PerformanceObserver((list) => {
      entries.push(
        ...list.getEntries().map((entry) => ({
          startTime: entry.startTime,
          duration: entry.duration,
          name: entry.name,
        })),
      );
    }).observe({ type: 'longtask', buffered: true });
    window.v5SandroneLongTasks = {
      reset: () => entries.splice(0),
      read: () => structuredClone(entries),
    };
  });
}

const summarizeProfile = (profile) => {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const totals = new Map();
  for (let index = 0; index < (profile.samples || []).length; index++) {
    const id = profile.samples[index];
    const delta = profile.timeDeltas?.[index] || 0;
    totals.set(id, (totals.get(id) || 0) + delta);
  }
  return [...totals]
    .map(([id, microseconds]) => {
      const frame = nodes.get(id)?.callFrame || {};
      return {
        functionName: frame.functionName || '(anonymous)',
        url: frame.url || '',
        line: (frame.lineNumber || 0) + 1,
        milliseconds: microseconds / 1000,
      };
    })
    .sort((left, right) => right.milliseconds - left.milliseconds)
    .slice(0, 25);
};

async function test(page, output) {
  const evidence = () => page.evaluate(() => window.v5SandroneEvidence());
  const resetLongTasks = () =>
    page.evaluate(() => window.v5SandroneLongTasks.reset());
  const longTasks = () =>
    page.evaluate(() => window.v5SandroneLongTasks.read());
  const pointOnPath = (locator) =>
    locator.evaluate((path) => {
      const point = path.getPointAtLength(path.getTotalLength() * 0.42);
      const matrix = path.getScreenCTM();
      if (!matrix) throw new Error('path has no screen transform');
      const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      return { x: screen.x, y: screen.y };
    });

  await page.locator('.studio.creation-studio').waitFor({ timeout: 90_000 });
  await page.locator('.source-path-layer').first().waitFor({ timeout: 90_000 });
  const initial = await evidence();
  assert.equal(initial.version, 5);
  const path = page
    .locator(`[data-source-id="${initial.sourcePath.id}"] path[aria-label]`)
    .first();
  await page.getByRole('button', { name: '节点 (A)', exact: true }).click();
  const hit = await pointOnPath(path);
  await page.mouse.click(hit.x, hit.y);
  const node = page.locator('[data-node-index="1"] rect').first();
  await node.waitFor();
  const box = await node.boundingBox();
  assert.ok(box);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await resetLongTasks();
  await cdp.send('Profiler.start');
  const releaseStartedAt = await page.evaluate(() => performance.now());
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 6, box.y + box.height / 2);
  await page.mouse.up();
  // No runtime.evaluate/evidence call here: this measures the real committed UI path.
  await page.waitForTimeout(1_000);
  const afterFirst = await evidence();
  const nextStartedAt = await page.evaluate(() => performance.now());
  await page.mouse.move(box.x + box.width / 2 + 6, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.up();
  const nextFinishedAt = await page.evaluate(() => performance.now());
  await page.waitForTimeout(1_000);
  const { profile } = await cdp.send('Profiler.stop');
  const report = {
    initial,
    afterFirst,
    releaseStartedAt,
    nextStartedAt,
    nextFinishedAt,
    nextGestureDispatchMS: nextFinishedAt - nextStartedAt,
    longTasks: await longTasks(),
    topExclusiveFrames: summarizeProfile(profile),
    profileDurationMS: (profile.endTime - profile.startTime) / 1000,
    note: 'No explicit creation/runtime evaluation occurs between first pointerup and the second gesture dispatch.',
  };
  await Promise.all([
    writeFile(
      resolve(output, 'v5-sandrone-cpu-profile.json'),
      JSON.stringify(profile) + '\n',
    ),
    writeFile(
      resolve(output, 'v5-sandrone-cpu-summary.json'),
      JSON.stringify(report, null, 2) + '\n',
    ),
    page.screenshot({
      path: resolve(output, 'v5-sandrone-cpu-profile.png'),
      fullPage: true,
    }),
  ]);
}

module.exports = test;
module.exports.setup = setup;

if (require.main === module) {
  const harness = require('../harness/browser-runner.cjs');
  harness.studioCases.push({
    name: 'v5-sandrone-cpu-profile',
    module: 'studio/test-v5-repaired-cpu-profile.cjs',
    adapter: 'studio-fixture',
    fixture: {
      kind: 'file',
      path: 'scripts/tests/fixtures/v5-sandrone-walkthrough.mjs',
    },
  });
  const options = harness.parseArguments([
    '--suite',
    'studio',
    '--case',
    'v5-sandrone-cpu-profile',
    '--timeout',
    '120000',
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
