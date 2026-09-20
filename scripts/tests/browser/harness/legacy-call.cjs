// Existing GUI journeys observe a revision before each compatibility API call.
// Protocol tests use traceStudio.call directly so missing/stale revisions are
// still tested. Explicit expectedRevision arguments are never replaced.
exports.legacyCaller =
  (page) =>
  async (action, args = {}) => {
    await page.waitForFunction(() => window.traceStudio);
    return page.evaluate(
      async ({ action, args }) => {
        const observed = await window.traceStudio.call('document.get');
        return window.traceStudio.call(action, {
          expectedRevision: observed.revision,
          ...args,
        });
      },
      { action, args },
    );
  };
