import { globSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

// Cross-platform test discovery (F-17)
const testFiles = globSync('src/**/*.test.ts');

if (testFiles.length === 0) {
  console.log('No test files found in src/**/*.test.ts');
  process.exit(0);
}

console.log(`Discovered ${testFiles.length} test files:`);
for (const f of testFiles) {
  console.log(`  - ${f}`);
}

const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(npxCmd, ['tsx', '--test', ...testFiles], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

process.exit(result.status ?? (result.error ? 1 : 0));
