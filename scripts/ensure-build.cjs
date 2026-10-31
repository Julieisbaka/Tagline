// Builds the renderer unless a parent process (such as test:all) already did.
const { spawnSync } = require('node:child_process');

if (process.env.TAGLINE_SKIP_BUILD === '1') process.exit(0);

const vite = require.resolve('vite/bin/vite.js');
const result = spawnSync(process.execPath, [vite, 'build'], { stdio: 'inherit' });
process.exit(result.status ?? 1);
