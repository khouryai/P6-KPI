// Builds the single-file version. Separate from the normal build only because it needs
// TC_STANDALONE set, and setting an env var inline is not portable across shells.
import { spawnSync } from 'node:child_process';
const r = spawnSync('npx', ['vite', 'build'], { stdio: 'inherit', shell: true, env: { ...process.env, TC_STANDALONE: '1' } });
process.exit(r.status ?? 1);
