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

async function checkIgnoreRules(root) {
  const files = [
    'Root.md',
    'keep.md',
    'UPPER.MD',
    '#literal.md',
    '!literal.md',
    'space name.md',
    'trailing .md',
    'Folder/drop.md',
    'Folder/keep.md',
    'Folder/deep/note.flow',
    'Other/drop.md',
    'Other/note.json',
  ];
  for (const file of files) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), '');
  }
  await fs.writeFile(path.join(root, 'Folder', '.taglineignore'), '*.flow\n');
  const cases = [
    ['', files],
    [
      '# comment\r\n*.MD\r\n!keep.md\r\n',
      ['Folder/deep/note.flow', 'Folder/keep.md', 'Other/note.json', 'keep.md'],
    ],
    ['/drop.md\n/Root.md\n', files.filter((file) => file !== 'Root.md')],
    ['folder/\n!Folder/keep.md\n', files.filter((file) => !file.startsWith('Folder/'))],
    [
      'Folder/**\n!Folder/keep.md\n',
      files.filter((file) => !file.startsWith('Folder/') || file === 'Folder/keep.md'),
    ],
    ['**/drop.md\n', files.filter((file) => !file.endsWith('/drop.md'))],
    [
      '\\#literal.md\n\\!literal.md\nspace\\ name.md\ntrailing\\ .md\n',
      files.filter(
        (file) => !['#literal.md', '!literal.md', 'space name.md', 'trailing .md'].includes(file)
      ),
    ],
    ['[z-a].md\nOther/*.json\n', files.filter((file) => file !== 'Other/note.json')],
  ];
  for (const [rules, expected] of cases) {
    await fs.writeFile(path.join(root, '.taglineignore'), rules);
    const sorted = [...expected].sort();
    assert.deepEqual(flatten(await listVault(root)), sorted, `JavaScript rules: ${rules}`);
    assert.deepEqual(listNotePaths(root), sorted, `Rust rules: ${rules}`);
  }
  await fs.rm(path.join(root, '.taglineignore'));
  assert.deepEqual(listNotePaths(root), files.sort());
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
    assert.deepEqual(expected, [
      'Nested/Mixed.CaNvAs',
      'Nested/flow.json',
      'argument.md',
      ...(hasSymlink ? ['linked.MD'] : []),
      '😀.md',
      '\uE000.md',
    ]);
    assert.deepEqual(listNotePaths(root), expected);
    if (process.platform !== 'win32') {
      const invalidPath = Buffer.concat([
        Buffer.from(`${root}${path.sep}bad`),
        Buffer.from([0xff]),
        Buffer.from('.md'),
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
    const ignoreRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-rust-ignore-'));
    try {
      await checkIgnoreRules(ignoreRoot);
    } finally {
      await fs.rm(ignoreRoot, { recursive: true, force: true });
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
