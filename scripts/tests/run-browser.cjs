#!/usr/bin/env node
async function main() {
  let options;
  try {
    const { parseArguments, run, usage } =
      await import('./browser/harness/browser-runner.cjs');
    options = parseArguments(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      return;
    }
    const { outputDirectory, manifest } = await run(options);
    console.log(
      `PASS: ${manifest.results.length} ${options.suite} browser cases (${options.target})`,
    );
    console.log(`Evidence: ${outputDirectory}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

void main();
