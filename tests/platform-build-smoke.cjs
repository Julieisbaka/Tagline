const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tagline-platform-build-'));
const targets = ['win32', 'darwin', 'linux'];
const copy = Object.fromEntries(
  targets.map((target) => [target, require(`../src/platform/${target}.json`)])
);

try {
  for (const target of targets) {
    const output = path.join(temp, target);
    const result = spawnSync(
      process.execPath,
      [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', output],
      {
        cwd: root,
        env: { ...process.env, TAGLINE_TARGET_PLATFORM: target },
        encoding: 'utf8',
      }
    );
    assert.equal(result.status, 0, `${target}: ${result.stderr}`);
    const assets = path.join(output, 'assets');
    const bundle = fs
      .readdirSync(assets)
      .filter((file) => file.endsWith('.js'))
      .map((file) => fs.readFileSync(path.join(assets, file), 'utf8'))
      .join('\n');
    for (const other of targets) {
      for (const locale of ['en', 'es', 'fr']) {
        for (const field of [
          'flowAssociation',
          'updates',
          'installInstructions',
          'applyCssShortcut',
          'manualUninstall',
          'manualUninstallKeep',
          'manualUninstallRemove',
        ]) {
          const text = copy[other][locale][field];
          if (!text) {
            continue;
          }
          assert.equal(
            bundle.includes(text),
            text === copy[target][locale][field],
            `${target}: ${other} ${locale} ${field}`
          );
        }
      }
    }
  }
  console.log('Platform renderer builds include only their target instructions.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
