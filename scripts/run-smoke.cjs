const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const [runtime, testPath] = process.argv.slice(2);

function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: root, env: process.env, stdio: 'inherit' });
  if (result.error) {
    console.error(`Could not start ${executable}: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function main() {
  if (!['node', 'electron'].includes(runtime) || !testPath) {
    console.error('Usage: run-smoke.cjs <node|electron> <test-script>');
    process.exitCode = 2;
    return;
  }

  if (process.env.TAGLINE_TEST_DIST_READY !== '1') {
    const npmCli = process.env.npm_execpath;
    if (!npmCli) {
      console.error('Run smoke suites through npm so the renderer build can use npm_execpath.');
      process.exitCode = 1;
      return;
    }
    const buildStatus = run(process.execPath, [npmCli, 'run', 'build']);
    if (buildStatus !== 0) {
      process.exitCode = buildStatus;
      return;
    }
  }

  const executable = runtime === 'electron' ? require('electron') : process.execPath;
  process.exitCode = run(executable, [path.resolve(root, testPath)]);
}

main();
