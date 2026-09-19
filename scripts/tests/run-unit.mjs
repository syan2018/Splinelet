import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const directory = new URL('./unit/', import.meta.url);
const tests = readdirSync(directory)
  .filter((name) => /^test-.*\.mjs$/.test(name))
  .sort();

for (const test of tests) {
  console.log(`\n=== ${test} ===`);
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL(test, directory))],
    {
      stdio: 'inherit',
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`\nPASS: ${tests.length} hermetic unit tests`);
