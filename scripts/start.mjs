import process from 'node:process';
import { spawn } from 'node:child_process';

// Cross-platform start script setting NODE_ENV=production (F-17)
process.env.NODE_ENV = 'production';

const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(npxCmd, ['tsx', 'server.ts'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
