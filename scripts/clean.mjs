import fs from 'node:fs';

// Cross-platform cleanup script (F-17)
try {
  fs.rmSync('dist', { recursive: true, force: true });
  console.log('✓ Cleaned dist directory');
} catch (e) {
  console.error('Error cleaning dist:', e);
}

try {
  fs.rmSync('server.js', { force: true });
} catch {}
