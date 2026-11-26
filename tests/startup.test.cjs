const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { listVault, readVaultSnapshot } = require('../electron/vaultFiles.cjs');
const { temporaryDirectory } = require('./helpers/temporary.cjs');

test('outline recognizes imported setext headings before the visual editor rewrites Markdown', async () => {
  const { outline } = await import('../src/lib/vault/vault.js');
  const source =
    '---\ntitle: Imported\n---\n\nPocket\n======\n\nHat\n---\n\n### Block\n\n#### Tag\n';
  assert.deepEqual(outline(source), [
    { level: 1, text: 'Pocket', line: 4 },
    { level: 2, text: 'Hat', line: 7 },
    { level: 3, text: 'Block', line: 10 },
    { level: 4, text: 'Tag', line: 12 },
  ]);
  assert.deepEqual(outline(source.replaceAll('\n', '\r\n')), outline(source));
  assert.deepEqual(outline('First line\nsecond line\n===\n\n---\n\n   ## Indented ##\n'), [
    { level: 1, text: 'First line\nsecond line', line: 0 },
    { level: 2, text: 'Indented', line: 6 },
  ]);
  assert.deepEqual(
    outline(
      '~~~md\nFalse heading\n===\n# Not a heading\n~~~\n\n````\n# Also code\n```\n````\n\n    # Indented code\n\nActual\n---\n'
    ),
    [{ level: 2, text: 'Actual', line: 13 }]
  );
});

const fixture = (t) => temporaryDirectory(t, 'tagline-vault-files-');

test('platform: vault snapshots preserve document types, sorting, paths, timestamps and hidden-file rules', async (t) => {
  const dir = await fixture(t);
  for (const folder of ['Z folder', 'Empty', '.hidden']) {
    await fs.mkdir(path.join(dir, folder));
  }
  const documents = {
    'b.md': '# Beta',
    'A.CANVAS': '{"nodes":[],"edges":[]}',
    'Z folder/Flow.flow': '{"sheets":[]}',
    'Z folder/a.md': 'Nested',
  };
  for (const [name, text] of Object.entries({
    ...documents,
    '.secret.md': 'Hidden',
    '.hidden/Note.md': 'Hidden',
    'ignore.txt': 'Not a note',
  })) {
    await fs.writeFile(path.join(dir, name), text);
  }
  const snapshot = await readVaultSnapshot(dir);
  assert.deepEqual(snapshot.contents, documents);
  assert.deepEqual(snapshot.tree, await listVault(dir));
  assert.deepEqual(
    snapshot.tree.map((node) => node.name),
    ['Empty', 'Z folder', 'A.CANVAS', 'b.md']
  );
  assert.deepEqual(
    snapshot.tree[1].children.map((node) => node.path),
    ['Z folder/a.md', 'Z folder/Flow.flow']
  );
  assert.deepEqual(Object.keys(snapshot.contents), [
    'Z folder/a.md',
    'Z folder/Flow.flow',
    'A.CANVAS',
    'b.md',
  ]);
  assert.equal(snapshot.tree[2].mtime, (await fs.stat(path.join(dir, 'A.CANVAS'))).mtimeMs);
  assert.equal((await listVault(path.join(dir, 'Z folder'), 'Moved'))[0].path, 'Moved/a.md');
});

test('platform: snapshot scans once, reads each file once, and bounds parallel filesystem operations', async (t) => {
  const dir = await fixture(t);
  await fs.mkdir(path.join(dir, 'Folder'));
  for (let i = 0; i < 65; i++) {
    await fs.writeFile(path.join(dir, 'Folder', `${i}.md`), `Note ${i}`);
  }
  let directories = 0,
    reads = 0,
    opens = 0,
    active = 0,
    peak = 0;
  for (const name of ['readdir', 'readFile', 'open']) {
    const original = fs[name];
    t.mock.method(fs, name, async (...args) => {
      if (name === 'readdir') {
        directories++;
      }
      if (name === 'readFile') {
        reads++;
      }
      if (name === 'open') {
        opens++;
      }
      peak = Math.max(peak, ++active);
      try {
        return await original(...args);
      } finally {
        active--;
      }
    });
  }
  assert.equal(Object.keys((await readVaultSnapshot(dir)).contents).length, 65);
  assert.equal(directories, 2);
  assert.equal(reads, 65);
  assert.equal(opens, 65);
  assert.ok(peak > 1 && peak <= 16, `Expected 2–16 concurrent operations, got ${peak}`);
  await readVaultSnapshot(dir);
  assert.equal(reads, 65, 'Unchanged note contents are reused from the snapshot cache');
  await listVault(dir);
  assert.equal(reads, 65, 'Listing files never reads their content');
});

test('snapshot content cache invalidates on mtime or size changes', async (t) => {
  const dir = await fixture(t);
  const file = path.join(dir, 'Note.md');
  await fs.writeFile(file, 'initial');
  await readVaultSnapshot(dir);
  const originalReadFile = fs.readFile;
  let reads = 0;
  t.mock.method(fs, 'readFile', async (target, ...args) => {
    reads++;
    return originalReadFile(target, ...args);
  });

  await readVaultSnapshot(dir);
  assert.equal(reads, 0);

  await fs.writeFile(file, 'changed');
  const changedMtime = new Date(Date.now() + 5000);
  await fs.utimes(file, changedMtime, changedMtime);
  assert.equal((await readVaultSnapshot(dir)).contents['Note.md'], 'changed');
  assert.equal(reads, 1);

  const mtime = (await fs.stat(file)).mtime;
  await fs.writeFile(file, 'different size, same mtime');
  await fs.utimes(file, mtime, mtime);
  assert.equal((await readVaultSnapshot(dir)).contents['Note.md'], 'different size, same mtime');
  assert.equal(reads, 2);
});

test('vault lists JSON files and includes their contents in snapshots', async (t) => {
  const dir = await fixture(t);
  const content = JSON.stringify({ id: 123, name: 'Tournament' });
  await fs.writeFile(path.join(dir, 'Tournament.JSON'), content);
  const snapshot = await readVaultSnapshot(dir);
  assert.deepEqual(
    snapshot.tree.map(({ path: file }) => file),
    ['Tournament.JSON']
  );
  assert.equal(snapshot.contents['Tournament.JSON'], content);
});

test('platform: vault snapshots exclude symlinks and do not reuse cached contents for them', async (t) => {
  const dir = await fixture(t);
  const outside = await fixture(t);
  const secret = path.join(outside, 'secret.md');
  await fs.writeFile(secret, 'outside secret content');
  await fs.writeFile(path.join(dir, 'safe.md'), 'inside content');
  await fs.writeFile(path.join(dir, 'replaced.md'), 'old content');
  await readVaultSnapshot(dir);
  await fs.unlink(path.join(dir, 'replaced.md'));
  try {
    await fs.symlink(secret, path.join(dir, 'replaced.md'));
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip('creating symlinks needs elevated Windows privileges');
      return;
    }
    throw error;
  }
  for (const ext of ['md', 'flow', 'canvas', 'json']) {
    await fs.symlink(secret, path.join(dir, `link.${ext}`));
  }
  await fs.symlink(path.join(outside, 'missing.md'), path.join(dir, 'broken.md'));
  await fs.symlink(outside, path.join(dir, 'linked-folder'), 'dir');

  const snapshot = await readVaultSnapshot(dir);
  assert.deepEqual(snapshot.contents, { 'safe.md': 'inside content' });
  assert.deepEqual(
    snapshot.tree.map((node) => node.path),
    ['safe.md']
  );
  assert.deepEqual(await listVault(dir), snapshot.tree);
  const rootLink = path.join(outside, 'vault-link');
  await fs.symlink(dir, rootLink, 'dir');
  assert.deepEqual(await readVaultSnapshot(rootLink), snapshot);
});

test('platform: vault snapshots skip non-regular files with document extensions', async (t) => {
  if (process.platform === 'win32') {
    t.skip('named pipes are not filesystem entries on Windows');
    return;
  }
  const dir = await fixture(t);
  require('node:child_process').execFileSync('mkfifo', [path.join(dir, 'pipe.md')]);
  await fs.writeFile(path.join(dir, 'safe.md'), 'inside');
  const snapshot = await readVaultSnapshot(dir);
  assert.deepEqual(snapshot.contents, { 'safe.md': 'inside' });
  assert.deepEqual(
    snapshot.tree.map((node) => node.path),
    ['safe.md']
  );
});

test('platform: snapshots reject a directory replaced by an outside symlink while opening a file', async (t) => {
  const dir = await fixture(t);
  const outside = await fixture(t);
  const folder = path.join(dir, 'Folder');
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, 'Note.md'), 'inside');
  await fs.writeFile(path.join(outside, 'Note.md'), 'outside secret content');
  const open = fs.open;
  const readFile = fs.readFile;
  let reads = 0;
  t.mock.method(fs, 'readFile', async (...args) => {
    reads++;
    return readFile(...args);
  });
  t.mock.method(fs, 'open', async (...args) => {
    await fs.rename(folder, path.join(dir, 'moved'));
    try {
      await fs.symlink(outside, folder, 'dir');
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') {
        t.skip('creating symlinks needs elevated Windows privileges');
        throw error;
      }
      throw error;
    }
    return open(...args);
  });
  await assert.rejects(readVaultSnapshot(dir));
  assert.equal(reads, 0);
});

test('platform: vault scans reject a directory replaced during enumeration', async (t) => {
  const dir = await fs.realpath(await fixture(t));
  const folder = path.join(dir, 'Folder');
  const replacement = path.join(dir, '.replacement');
  await fs.mkdir(folder);
  await fs.mkdir(replacement);
  await fs.writeFile(path.join(replacement, 'Note.md'), 'replacement');
  const readdir = fs.readdir;
  t.mock.method(fs, 'readdir', async (target, ...args) => {
    if (target === folder) {
      await fs.rename(folder, path.join(dir, '.original'));
      await fs.rename(replacement, folder);
    }
    return readdir(target, ...args);
  });
  await assert.rejects(listVault(dir), /Vault directory changed during snapshot/);
});

test('platform: snapshots reject a replaced ancestor even when the file identity is unchanged', async (t) => {
  const dir = await fs.realpath(await fixture(t));
  const folder = path.join(dir, 'Folder');
  const replacement = path.join(dir, '.replacement');
  await fs.mkdir(path.join(folder, 'Inner'), { recursive: true });
  await fs.mkdir(replacement);
  const note = path.join(folder, 'Inner', 'Note.md');
  await fs.writeFile(note, 'inside');
  const open = fs.open;
  const readFile = fs.readFile;
  let reads = 0;
  t.mock.method(fs, 'readFile', async (...args) => {
    reads++;
    return readFile(...args);
  });
  t.mock.method(fs, 'open', async (...args) => {
    await fs.rename(folder, path.join(dir, '.original'));
    await fs.rename(path.join(dir, '.original', 'Inner'), path.join(replacement, 'Inner'));
    await fs.rename(replacement, folder);
    return open(...args);
  });
  await assert.rejects(readVaultSnapshot(dir), /Vault directory changed during snapshot/);
  assert.equal(reads, 0);
});

test('platform: snapshot propagates filesystem errors instead of returning a partial vault', async (t) => {
  const dir = await fixture(t);
  await assert.rejects(readVaultSnapshot(path.join(dir, 'missing')), { code: 'ENOENT' });
  await fs.writeFile(path.join(dir, 'Note.md'), 'Note');
  const readFile = fs.readFile;
  t.mock.method(fs, 'readFile', async (...args) => {
    if (typeof args[0] !== 'string') {
      throw new Error('Cannot read note');
    }
    return readFile(...args);
  });
  await assert.rejects(readVaultSnapshot(dir), /Cannot read note/);
});

test('visual fallback checks do not depend on loading the visual editor', async () => {
  const { visualBlocker } = await import('../src/lib/editor/visualHelpers.js');
  assert.equal(visualBlocker('# Markdown\n\n**Evidence**'), null);
  assert.equal(visualBlocker('---\na: b\n---'), null);
  for (const content of [
    '---\na: [\n---',
    '<div>HTML</div>',
    '[^a]: Footnote',
    '![Image](image.png)',
    '$$\na+b',
  ]) {
    assert.equal(typeof visualBlocker(content), 'string');
  }
  assert.equal(visualBlocker('```html\n<div>Example</div>\n```'), null);
});

test('first-run language matches supported OS locales and respects saved choices', async () => {
  const { systemLanguage, initialLanguage } = await import('../src/lib/i18n/localization.js');
  for (const [locales, expected] of [
    [['fr-CA'], 'fr'],
    [['es_MX'], 'es'],
    [['EN-us'], 'en'],
    [['ja-JP', 'fr-FR'], 'fr'],
    [['ja-JP'], 'en'],
    [[], 'en'],
    [[null, 12], 'en'],
  ]) {
    assert.equal(systemLanguage(locales), expected, `OS locales ${JSON.stringify(locales)}`);
  }
  assert.equal(initialLanguage('en', ['es-ES']), 'en', 'explicit English remains English');
  assert.equal(initialLanguage('fr', ['es-ES']), 'fr');
  assert.equal(initialLanguage(undefined, ['es-ES']), 'es');
  assert.equal(initialLanguage('unsupported', ['fr-CA']), 'fr');
});

test('YAML frontmatter supports mappings, preserves exact prefixes and reports invalid metadata', async () => {
  const { readFrontmatter, splitFrontmatter } = await import('../src/lib/markdown/frontmatter.js');
  const prefix =
    '\uFEFF---\r\n# Keep this comment\r\ntitle: Example\r\nnested:\r\n  choices: [one, two]\r\n---\r\n';
  const body = '\r\n#### Card\r\n==Evidence==\r\n';
  const metadata = readFrontmatter(prefix + body);
  assert.equal(metadata.error, '');
  assert.equal(metadata.prefix, prefix);
  assert.equal(metadata.body, body);
  assert.deepEqual(metadata.data, { title: 'Example', nested: { choices: ['one', 'two'] } });
  assert.equal(splitFrontmatter('---\na: 1\n...').body, '');
  assert.equal(readFrontmatter('---\n---').error, '');
  assert.equal(
    splitFrontmatter('# Note\n\n---\n').prefix,
    '',
    'body thematic breaks are not metadata'
  );
  for (const invalid of [
    '---\na: [\n---\n# Note',
    '---\na: 1\na: 2\n---',
    '---\n- list\n---',
    '---\na: 1',
    '---\nvalue: !unknown something\n---',
  ]) {
    assert.ok(readFrontmatter(invalid).error, invalid);
  }
});

test('visual property edits preserve note body and support adding, updating, and removing YAML values', async () => {
  const { deleteFrontmatterProperty, readFrontmatter, setFrontmatterProperty } =
    await import('../src/lib/markdown/frontmatter.js');
  const body = '\r\n# Note\r\nText\r\n';
  const source = '---\r\ntitle: Example\r\n---\r\n' + body;
  const updated = setFrontmatterProperty(source, 'title', 'Updated');
  assert.equal(readFrontmatter(updated).data.title, 'Updated');
  assert.equal(readFrontmatter(updated).body, body);
  assert.ok(updated.includes('\r\ntitle: Updated\r\n'));

  const added = setFrontmatterProperty('# Note\n', 'tags', ['policy', 'debate']);
  assert.deepEqual(readFrontmatter(added).data, { tags: ['policy', 'debate'] });
  assert.equal(readFrontmatter(added).body, '\n# Note\n');

  const removed = deleteFrontmatterProperty(updated, 'title');
  assert.deepEqual(readFrontmatter(removed).data, {});
  assert.equal(readFrontmatter(removed).body, body);
});

test('speech markers preserve other properties and discover only boolean-marked Markdown files', async () => {
  const { markSpeechDocument, readFrontmatter, speechDocumentPaths } =
    await import('../src/lib/markdown/frontmatter.js');
  const body = '\r\n# Speech\r\n\r\nEvidence.\r\n';
  const source =
    '---\r\n# My properties\r\ntitle: "Final"\r\nspeech: false\r\nnested:\r\n  value: 5\r\n---\r\n' +
    body;
  const marked = markSpeechDocument(source);
  assert.ok(marked.includes('# My properties'));
  assert.ok(marked.includes('title: "Final"'));
  assert.equal(readFrontmatter(marked).body, body);
  assert.deepEqual(readFrontmatter(marked).data, {
    title: 'Final',
    speech: true,
    nested: { value: 5 },
  });
  assert.equal(markSpeechDocument(marked), marked, 'existing markers preserve every byte');
  assert.equal(readFrontmatter(markSpeechDocument('# Existing\n')).body, '\n# Existing\n');
  assert.deepEqual(
    speechDocumentPaths({
      'B.md': marked,
      'A.MD': '---\nspeech: true\n---\n# A',
      'String.md': '---\nspeech: "true"\n---',
      'False.md': source,
      'Invalid.md': '---\nspeech: [\n---',
      'Other.canvas': marked,
    }),
    ['A.MD', 'B.md']
  );
  assert.throws(() => markSpeechDocument('---\na: [\n---'), /Invalid YAML/);
});

test('duplicate evidence detection ignores whitespace and frontmatter', async () => {
  const { containsEvidence } = await import('../src/lib/evidence/card.js');
  const doc = '---\nspeech: true\n---\n# Speech\n\n#### Tag\nSome   evidence\ntext.\n';
  assert.equal(containsEvidence(doc, '#### Tag\nSome evidence text.'), true);
  assert.equal(containsEvidence(doc, 'Other card'), false);
  assert.equal(containsEvidence(doc, 'speech: true'), false);
  assert.equal(containsEvidence(doc, '  '), false);
});

test('metadata is excluded from note structure, evidence statistics and spoken text', async () => {
  const { cardStats, getSectionAt, spokenEvidence } = await import('../src/lib/evidence/card.js');
  const { outline, extractTags, extractLinks } = await import('../src/lib/vault/vault.js');
  const { speechStats } = await import('../src/lib/speech/readTime.js');
  const { visualBlocker } = await import('../src/lib/editor/visualHelpers.js');
  const prefix =
    '---\ntitle: "#### Fake #metadata [[Hidden]] ==not evidence=="\nhtml: "<div>metadata</div>"\n---\n';
  const body = '# Case\n\n#### Card\n**Author 24**\n==Real evidence== #body [[Visible]]\n';
  assert.deepEqual(cardStats(prefix + body), cardStats(body));
  assert.deepEqual(speechStats(prefix + body), speechStats(body));
  assert.equal(spokenEvidence(prefix + body), spokenEvidence(body));
  assert.deepEqual(extractTags(prefix + body), ['body']);
  assert.deepEqual(extractLinks(prefix + body), ['Visible']);
  assert.deepEqual(outline(prefix + body), [
    { level: 1, text: 'Case', line: 4 },
    { level: 4, text: 'Card', line: 6 },
  ]);
  assert.equal(getSectionAt(prefix + body, 5), null);
  assert.deepEqual(
    getSectionAt(prefix + body, prefix.length + body.indexOf('Real')),
    getSectionAt(body, body.indexOf('Real'))
  );
  assert.equal(visualBlocker(prefix + body), null);
  assert.equal(visualBlocker(prefix + '<div>Body HTML</div>'), 'embedded HTML');
});

test('release packaging keeps application identity and user data independent of version', () => {
  const { build } = require('../package.json');
  assert.equal(build.appId, 'app.tagline');
  assert.equal(build.productName, 'Tagline');
  assert.equal(build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(build.nsis.perMachine, false);
  assert.equal(build.win.target, 'nsis');
  assert.equal(build.mac.target, 'dmg');
  assert.equal(build.artifactName, 'Tagline-${version}-${os}-${arch}.${ext}');
  assert.ok(!build.publish, 'Publishing is controlled by the manual release workflow');
});

test('platform: installation information uses packaged versions and the current profile without mutating them', () => {
  const { installationInfo } = require('../electron/installation.cjs');
  const app = {
    isPackaged: true,
    getVersion: () => '2.3.4',
    getPath: (name) => `/current/${name}`,
  };
  assert.equal(installationInfo(app).version, '2.3.4');
  assert.equal(installationInfo(app).profile, '/current/userData');
  assert.equal(installationInfo(app).executable, '/current/exe');
  assert.equal(installationInfo(app).arch, process.arch);
  assert.equal(
    installationInfo({ ...app, isPackaged: false }).version,
    require('../package.json').version
  );
});
