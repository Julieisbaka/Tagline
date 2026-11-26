const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { listVault } = require('../electron/vaultFiles.cjs');
const { listNotePaths } = require('../electron/rustVaultProbe.cjs');

function flatten(nodes, paths = []) {
  for (const node of nodes) {
    if (node.type === 'folder') {
      flatten(node.children, paths);
    } else {
      paths.push(node.path);
    }
  }
  return paths.sort();
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-rust-vault-'));
  try {
    await Promise.all([
      fs.mkdir(path.join(root, 'Nested'), { recursive: true }),
      fs.mkdir(path.join(root, '.hidden')),
    ]);
    await Promise.all([
      fs.writeFile(path.join(root, 'argument.md'), 'one'),
      fs.writeFile(path.join(root, 'ignored.txt'), 'two'),
      fs.writeFile(path.join(root, 'Nested', 'flow.json'), '{}'),
      fs.writeFile(path.join(root, 'Nested', 'Mixed.CaNvAs'), '{}'),
      fs.writeFile(path.join(root, '😀.md'), ''),
      fs.writeFile(path.join(root, '\uE000.md'), ''),
      fs.writeFile(path.join(root, '.hidden', 'secret.md'), 'three'),
    ]);
    let hasSymlink = true;
    try {
      await fs.symlink('argument.md', path.join(root, 'linked.MD'), 'file');
    } catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
        throw error;
      }
      hasSymlink = false;
      console.log('Symlink fixture skipped: symlink creation is not permitted.');
    }
    const expected = flatten(await listVault(root));
    assert.deepEqual(
      expected,
      [
        'Nested/Mixed.CaNvAs',
        'Nested/flow.json',
        'argument.md',
        ...(hasSymlink ? ['linked.MD'] : []),
        '😀.md',
        '\uE000.md',
      ]
    );
    assert.deepEqual(listNotePaths(root), expected);
    if (process.platform !== 'win32') {
      const invalidPath = Buffer.concat([
        Buffer.from(`${root}${path.sep}bad`), Buffer.from([0xff]), Buffer.from('.md'),
      ]);
      await fs.writeFile(invalidPath, '');
      const decodedPath = 'bad\uFFFD.md';
      assert.deepEqual(listNotePaths(root), [...expected, decodedPath].sort());
      await assert.rejects(listVault(root), { code: 'ENOENT' });
      await fs.writeFile(path.join(root, decodedPath), '');
      const withInvalidName = [...expected, decodedPath, decodedPath].sort();
      assert.deepEqual(flatten(await listVault(root)), withInvalidName);
      assert.deepEqual(listNotePaths(root), withInvalidName);
      await fs.unlink(invalidPath);
      await fs.unlink(path.join(root, decodedPath));
    }
    if (hasSymlink) {
      await fs.symlink('missing-target.md', path.join(root, 'missing.md'), 'file');
      assert.deepEqual(listNotePaths(root), [...expected, 'missing.md'].sort());
      await assert.rejects(listVault(root), { code: 'ENOENT' });
    }
    console.log(`Rust probe matched JavaScript for ${expected.length} vault files.`);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
