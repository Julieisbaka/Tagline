const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { listVault, readVaultSnapshot } = require('../electron/vaultFiles.cjs');
const {
  listNotePaths,
  listVault: listRustVault,
  readVaultSnapshot: readRustSnapshot,
} = require('../electron/rustVaultProbe.cjs');

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
    ['Root.md\n!Root.md\n', files],
    ['!Root.md\nRoot.md\n', files.filter((file) => file !== 'Root.md')],
    ['?eep.md\n', files.filter((file) => !file.endsWith('keep.md'))],
    ['[RU]*.md\n', files.filter((file) => !['Root.md', 'UPPER.MD'].includes(file))],
    ['/Folder/*.md\n', files.filter((file) => !['Folder/drop.md', 'Folder/keep.md'].includes(file))],
    ['*.json\n!Other/note.json\n', files],
    ['Folder/**/note.flow\n', files.filter((file) => file !== 'Folder/deep/note.flow')],
    ['*.md   \n', files.filter((file) => !file.toLowerCase().endsWith('.md'))],
    ['Folder\n!Folder\n', files],
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
  ];
  for (const [rules, expected] of cases) {
    await fs.writeFile(path.join(root, '.taglineignore'), rules);
    const sorted = [...expected].sort();
    assert.deepEqual(flatten(await listVault(root)), sorted, `JavaScript rules: ${rules}`);
    assert.deepEqual(listNotePaths(root), sorted, `Rust rules: ${rules}`);
    assert.deepEqual(await listRustVault(root), await listVault(root), `Tree rules: ${rules}`);
    assert.deepEqual(await readRustSnapshot(root), await readVaultSnapshot(root), `Snapshot rules: ${rules}`);
  }
  for (const rules of ['[z-a].md\nOther/*.json\n', 'Other/*.json\n[z-a].md\n']) {
    await fs.writeFile(path.join(root, '.taglineignore'), rules);
    assert.deepEqual(
      flatten(await listVault(root)),
      files.filter((file) => file !== 'Other/note.json').sort(),
      `JavaScript rules: ${rules}`
    );
    const expected = files.filter((file) => file !== 'Other/note.json').sort();
    assert.deepEqual(listNotePaths(root), expected, `Rust rules: ${rules}`);
    assert.deepEqual(await listRustVault(root), await listVault(root), `Tree rules: ${rules}`);
    assert.deepEqual(await readRustSnapshot(root), await readVaultSnapshot(root), `Snapshot rules: ${rules}`);
  }
  await fs.rm(path.join(root, '.taglineignore'));
  assert.deepEqual(listNotePaths(root), files.sort());

  await fs.writeFile(path.join(root, 'é.md'), '');
  await fs.writeFile(path.join(root, '.taglineignore'), '?.md\n');
  if ((await fs.readdir(root)).includes('é.md')) {
    assert.ok(!flatten(await listVault(root)).includes('é.md'));
    assert.ok(listNotePaths(root).includes('é.md'));
    assert.ok(flatten(await listRustVault(root)).includes('é.md'));
  } else {
    console.log('Unicode ignore fixture skipped: filesystem normalized the filename.');
  }
}

async function checkVaultContract(root) {
  await fs.mkdir(path.join(root, 'z folder', 'empty'), { recursive: true });
  await fs.mkdir(path.join(root, 'A folder'));
  await fs.writeFile(path.join(root, 'z folder', 'nested.flow'), 'flow');
  await fs.writeFile(path.join(root, 'B.md'), 'one');
  await fs.writeFile(path.join(root, 'a.md'), Buffer.from([0x61, 0xff]));
  await fs.writeFile(path.join(root, 'ignored.txt'), 'ignored');
  const fixedTime = new Date('2020-01-02T03:04:05.000Z');
  await fs.utimes(path.join(root, 'B.md'), fixedTime, fixedTime);

  const jsTree = await listVault(root);
  assert.deepEqual(await listRustVault(root), jsTree);
  assert.deepEqual(jsTree.map((node) => node.name), [
    ...['A folder', 'z folder'].sort((a, b) => a.localeCompare(b)),
    ...['a.md', 'B.md'].sort((a, b) => a.localeCompare(b)),
  ]);
  assert.deepEqual(jsTree.find((node) => node.name === 'z folder').children[0].children, []);
  assert.equal(jsTree.find((node) => node.name === 'B.md').mtime, (await fs.stat(path.join(root, 'B.md'))).mtimeMs);
  assert.deepEqual(await listRustVault(path.join(root, 'z folder'), 'Moved'),
    await listVault(path.join(root, 'z folder'), 'Moved'));

  async function compareSnapshots() {
    const expected = await readVaultSnapshot(root);
    const actual = await readRustSnapshot(root);
    assert.deepEqual(actual, expected);
    assert.deepEqual(Object.keys(actual.contents), Object.keys(expected.contents));
    return actual;
  }
  let snapshot = await compareSnapshots();
  const concurrentSnapshots = await Promise.all([
    readRustSnapshot(root),
    listRustVault(root),
    readRustSnapshot(root),
  ]);
  assert.deepEqual(concurrentSnapshots, [snapshot, snapshot.tree, snapshot]);
  assert.deepEqual(snapshot.contents, {
    'z folder/nested.flow': 'flow',
    'a.md': 'a\uFFFD',
    'B.md': 'one',
  });
  await fs.writeFile(path.join(root, 'B.md'), 'two');
  await fs.utimes(path.join(root, 'B.md'), fixedTime, fixedTime);
  snapshot = await compareSnapshots();
  assert.equal(snapshot.contents['B.md'], 'one');
  assert.equal((await readRustSnapshot(path.join(root, '.'))).contents['B.md'], 'one');
  await fs.writeFile(path.join(root, 'B.md'), 'longer');
  await fs.utimes(path.join(root, 'B.md'), fixedTime, fixedTime);
  assert.equal((await compareSnapshots()).contents['B.md'], 'longer');
  await fs.writeFile(path.join(root, 'B.md'), 'newest');
  await fs.utimes(path.join(root, 'B.md'), new Date('2021-01-02T03:04:05Z'), new Date('2021-01-02T03:04:05Z'));
  assert.equal((await compareSnapshots()).contents['B.md'], 'newest');

  await fs.writeFile(path.join(root, '.taglineignore'), 'B.md\n');
  assert.equal((await compareSnapshots()).contents['B.md'], undefined);
  await fs.writeFile(path.join(root, 'B.md'), 'fresh!');
  await fs.utimes(path.join(root, 'B.md'), new Date('2021-01-02T03:04:05Z'), new Date('2021-01-02T03:04:05Z'));
  await fs.unlink(path.join(root, '.taglineignore'));
  assert.equal((await compareSnapshots()).contents['B.md'], 'fresh!');
  await fs.unlink(path.join(root, 'B.md'));
  await compareSnapshots();
  await fs.writeFile(path.join(root, 'B.md'), 'again!');
  await fs.utimes(path.join(root, 'B.md'), new Date('2021-01-02T03:04:05Z'), new Date('2021-01-02T03:04:05Z'));
  assert.equal((await compareSnapshots()).contents['B.md'], 'again!');

  for (let i = 0; i < 10; i += 1) {
    const text = `concurrent-${i}`;
    await Promise.all([
      readRustSnapshot(root),
      fs.writeFile(path.join(root, 'B.md'), text),
      readRustSnapshot(root),
    ]);
    await fs.utimes(path.join(root, 'B.md'), new Date(`2022-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
      new Date(`2022-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`));
    assert.equal((await compareSnapshots()).contents['B.md'], text);
  }

  const otherRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-rust-cache-'));
  try {
    await fs.writeFile(path.join(otherRoot, 'B.md'), 'other!');
    await fs.utimes(path.join(otherRoot, 'B.md'), new Date('2021-01-02T03:04:05Z'), new Date('2021-01-02T03:04:05Z'));
    assert.deepEqual(await readRustSnapshot(otherRoot), await readVaultSnapshot(otherRoot));
    assert.equal((await readRustSnapshot(otherRoot)).contents['B.md'], 'other!');
    assert.equal((await compareSnapshots()).contents['B.md'], 'concurrent-9');
  } finally {
    await fs.rm(otherRoot, { recursive: true, force: true });
  }

  for (const dir of [path.join(root, 'missing'), path.join(root, 'a.md')]) {
    const expectedError = await listVault(dir).then(() => null, (error) => error);
    assert.ok(expectedError);
    assert.throws(() => listNotePaths(dir), { code: expectedError.code });
    await assert.rejects(listRustVault(dir), { code: expectedError.code });
    await assert.rejects(readRustSnapshot(dir), { code: expectedError.code });
  }
  if (process.platform !== 'win32') {
    const denied = path.join(root, 'denied');
    await fs.mkdir(denied);
    await fs.chmod(denied, 0);
    try {
      const expectedError = await listVault(denied).then(() => null, (error) => error);
      if (expectedError) {
        assert.equal(expectedError.code, 'EACCES');
        assert.throws(() => listNotePaths(denied), { code: expectedError.code });
        await assert.rejects(listRustVault(denied), { code: expectedError.code });
        await assert.rejects(readRustSnapshot(denied), { code: expectedError.code });
      } else {
        console.log('Permission fixture skipped: process can read mode-000 directories.');
      }
    } finally {
      await fs.chmod(denied, 0o700);
      await fs.rmdir(denied);
    }
  }
  let hasSymlink = true;
  try {
    await fs.symlink('missing.md', path.join(root, 'dangling.md'), 'file');
  } catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      throw error;
    }
    hasSymlink = false;
    console.log('Dangling symlink fixture skipped: symlink creation is not permitted.');
  }
  if (hasSymlink) {
    await assert.rejects(listVault(root), { code: 'ENOENT' });
    await assert.rejects(listRustVault(root), { code: 'ENOENT' });
    await assert.rejects(readRustSnapshot(root), { code: 'ENOENT' });
    await fs.unlink(path.join(root, 'dangling.md'));
    await fs.symlink('a.md', path.join(root, 'linked.md'), 'file');
    assert.deepEqual(await listRustVault(root), await listVault(root));
    assert.deepEqual(await readRustSnapshot(root), await readVaultSnapshot(root));
    await fs.writeFile(path.join(root, 'a.md'), 'updated target');
    const linkedSnapshot = await compareSnapshots();
    assert.equal(linkedSnapshot.contents['linked.md'], 'updated target');
    await fs.unlink(path.join(root, 'linked.md'));
    if (process.platform !== 'win32') {
      await fs.symlink('z folder', path.join(root, 'folder.md'));
      assert.deepEqual(await listRustVault(root), await listVault(root));
      const readError = await readVaultSnapshot(root).then(() => null, (error) => error);
      assert.ok(readError);
      await assert.rejects(readRustSnapshot(root), { code: readError.code });
      await fs.unlink(path.join(root, 'folder.md'));
    }
    await fs.symlink('loop.md', path.join(root, 'loop.md'), 'file');
    const expectedError = await readVaultSnapshot(root).then(() => null, (error) => error);
    assert.ok(expectedError);
    await assert.rejects(readRustSnapshot(root), { code: expectedError.code });
    const loop = path.join(root, 'loop.md');
    const expectedLoopError = await listVault(loop).then(() => null, (error) => error);
    assert.ok(expectedLoopError);
    assert.throws(() => listNotePaths(loop), { code: expectedLoopError.code });
  }
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
    if (process.platform !== 'win32' && process.platform !== 'darwin') {
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
    const contractRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-rust-contract-'));
    try {
      await checkVaultContract(contractRoot);
    } finally {
      await fs.rm(contractRoot, { recursive: true, force: true });
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
