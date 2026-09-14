// Runs the parity suite against a real workbook that is never committed:
//   npm run verify:workbook -- C:\path\to\TC_P6_Budget_SCurve.xlsx
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error('Usage: npm run verify:workbook -- <path to TC_P6_Budget_SCurve.xlsx>');
  process.exit(2);
}
const r = spawnSync('npx', ['vitest', 'run', 'tests/workbook-parity.test.ts'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, TC_WORKBOOK: resolve(file) },
});
process.exit(r.status ?? 1);
