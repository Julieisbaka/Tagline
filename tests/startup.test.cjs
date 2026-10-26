const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { listVault, readVaultSnapshot } = require('../electron/vaultFiles.cjs');

test('outline recognizes imported setext headings before the visual editor rewrites Markdown', async () => {
  const { outline } = await import('../src/lib/vault.js');
  const source = '---\ntitle: Imported\n---\n\nPocket\n======\n\nHat\n---\n\n### Block\n\n#### Tag\n';
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
  assert.deepEqual(outline('~~~md\nFalse heading\n===\n# Not a heading\n~~~\n\n````\n# Also code\n```\n````\n\n    # Indented code\n\nActual\n---\n'), [
    { level: 2, text: 'Actual', line: 13 },
  ]);
});

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-vault-files-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('platform: vault snapshots preserve document types, sorting, paths, timestamps and hidden-file rules', async (t) => {
  const dir = await fixture(t);
  for (const folder of ['Z folder', 'Empty', '.hidden']) await fs.mkdir(path.join(dir, folder));
  const documents = {
    'b.md': '# Beta', 'A.CANVAS': '{"nodes":[],"edges":[]}',
    'Z folder/Flow.flow': '{"sheets":[]}', 'Z folder/a.md': 'Nested'
  };
  for (const [name, text] of Object.entries({
    ...documents, '.secret.md': 'Hidden',
    '.hidden/Note.md': 'Hidden', 'ignore.txt': 'Not a note'
  })) await fs.writeFile(path.join(dir, name), text);
  const snapshot = await readVaultSnapshot(dir);
  assert.deepEqual(snapshot.contents, documents);
  assert.deepEqual(snapshot.tree, await listVault(dir));
  assert.deepEqual(snapshot.tree.map((node) => node.name), ['Empty', 'Z folder', 'A.CANVAS', 'b.md']);
  assert.deepEqual(snapshot.tree[1].children.map((node) => node.path), ['Z folder/a.md', 'Z folder/Flow.flow']);
  assert.deepEqual(Object.keys(snapshot.contents), ['Z folder/a.md', 'Z folder/Flow.flow', 'A.CANVAS', 'b.md']);
  assert.equal(snapshot.tree[2].mtime, (await fs.stat(path.join(dir, 'A.CANVAS'))).mtimeMs);
  assert.equal((await listVault(path.join(dir, 'Z folder'), 'Moved'))[0].path, 'Moved/a.md');
});

test('platform: snapshot scans once, reads each file once, and bounds parallel filesystem operations', async (t) => {
  const dir = await fixture(t);
  await fs.mkdir(path.join(dir, 'Folder'));
  for (let i = 0; i < 65; i++) await fs.writeFile(path.join(dir, 'Folder', `${i}.md`), `Note ${i}`);
  let directories = 0, reads = 0, stats = 0, active = 0, peak = 0;
  for (const name of ['readdir', 'readFile', 'stat']) {
    const original = fs[name];
    t.mock.method(fs, name, async (...args) => {
      if (name === 'readdir') directories++;
      if (name === 'readFile') reads++;
      if (name === 'stat') stats++;
      peak = Math.max(peak, ++active);
      try { return await original(...args); }
      finally { active--; }
    });
  }
  assert.equal(Object.keys((await readVaultSnapshot(dir)).contents).length, 65);
  assert.equal(directories, 2);
  assert.equal(reads, 65);
  assert.equal(stats, 65);
  assert.ok(peak > 1 && peak <= 16, `Expected 2–16 concurrent operations, got ${peak}`);
  await listVault(dir);
  assert.equal(reads, 65, 'Listing files never reads their content');
});

test('platform: snapshot propagates filesystem errors instead of returning a partial vault', async (t) => {
  const dir = await fixture(t);
  await assert.rejects(readVaultSnapshot(path.join(dir, 'missing')), { code: 'ENOENT' });
  await fs.writeFile(path.join(dir, 'Note.md'), 'Note');
  const readFile = fs.readFile;
  t.mock.method(fs, 'readFile', async (file, ...args) => {
    if (file === path.join(dir, 'Note.md')) throw new Error('Cannot read note');
    return readFile(file, ...args);
  });
  await assert.rejects(readVaultSnapshot(dir), /Cannot read note/);
});

test('visual fallback checks do not depend on loading the visual editor', async () => {
  const { visualBlocker } = await import('../src/lib/visualHelpers.js');
  assert.equal(visualBlocker('# Markdown\n\n**Evidence**'), null);
  assert.equal(visualBlocker('---\na: b\n---'), null);
  for (const content of ['---\na: [\n---', '<div>HTML</div>', '[^a]: Footnote', '![Image](image.png)', '$$\na+b'])
    assert.equal(typeof visualBlocker(content), 'string');
  assert.equal(visualBlocker('```html\n<div>Example</div>\n```'), null);
});

test('first-run language matches supported OS locales and respects saved choices', async () => {
  const { systemLanguage, initialLanguage } = await import('../src/lib/localization.js');
  for (const [locales, expected] of [
    [['fr-CA'], 'fr'], [['es_MX'], 'es'], [['EN-us'], 'en'],
    [['ja-JP', 'fr-FR'], 'fr'], [['ja-JP'], 'en'], [[], 'en'], [[null, 12], 'en'],
  ]) assert.equal(systemLanguage(locales), expected);
  assert.equal(initialLanguage('en', ['es-ES']), 'en', 'explicit English remains English');
  assert.equal(initialLanguage('fr', ['es-ES']), 'fr');
  assert.equal(initialLanguage(undefined, ['es-ES']), 'es');
  assert.equal(initialLanguage('unsupported', ['fr-CA']), 'fr');
});

test('YAML frontmatter supports mappings, preserves exact prefixes and reports invalid metadata', async () => {
  const { readFrontmatter, splitFrontmatter } = await import('../src/lib/frontmatter.js');
  const prefix = '\uFEFF---\r\n# Keep this comment\r\ntitle: Example\r\nnested:\r\n  choices: [one, two]\r\n---\r\n';
  const body = '\r\n#### Card\r\n==Evidence==\r\n';
  const metadata = readFrontmatter(prefix + body);
  assert.equal(metadata.error, '');
  assert.equal(metadata.prefix, prefix);
  assert.equal(metadata.body, body);
  assert.deepEqual(metadata.data, { title: 'Example', nested: { choices: ['one', 'two'] } });
  assert.equal(splitFrontmatter('---\na: 1\n...').body, '');
  assert.equal(readFrontmatter('---\n---').error, '');
  assert.equal(splitFrontmatter('# Note\n\n---\n').prefix, '', 'body thematic breaks are not metadata');
  for (const invalid of [
    '---\na: [\n---\n# Note', '---\na: 1\na: 2\n---',
    '---\n- list\n---', '---\na: 1', '---\nvalue: !unknown something\n---',
  ]) assert.ok(readFrontmatter(invalid).error, invalid);
});

test('speech markers preserve other properties and discover only boolean-marked Markdown files', async () => {
  const { markSpeechDocument, readFrontmatter, speechDocumentPaths } = await import('../src/lib/frontmatter.js');
  const body = '\r\n# Speech\r\n\r\nEvidence.\r\n';
  const source = '---\r\n# My properties\r\ntitle: "Final"\r\nspeech: false\r\nnested:\r\n  value: 5\r\n---\r\n' + body;
  const marked = markSpeechDocument(source);
  assert.ok(marked.includes('# My properties'));
  assert.ok(marked.includes('title: "Final"'));
  assert.equal(readFrontmatter(marked).body, body);
  assert.deepEqual(readFrontmatter(marked).data, { title: 'Final', speech: true, nested: { value: 5 } });
  assert.equal(markSpeechDocument(marked), marked, 'existing markers preserve every byte');
  assert.equal(readFrontmatter(markSpeechDocument('# Existing\n')).body, '\n# Existing\n');
  assert.deepEqual(speechDocumentPaths({
    'B.md': marked, 'A.MD': '---\nspeech: true\n---\n# A',
    'String.md': '---\nspeech: "true"\n---', 'False.md': source,
    'Invalid.md': '---\nspeech: [\n---', 'Other.canvas': marked,
  }), ['A.MD', 'B.md']);
  assert.throws(() => markSpeechDocument('---\na: [\n---'), /Invalid YAML/);
});

test('metadata is excluded from note structure, evidence statistics and spoken text', async () => {
  const { cardStats, getSectionAt, spokenEvidence } = await import('../src/lib/card.js');
  const { outline, extractTags, extractLinks } = await import('../src/lib/vault.js');
  const { speechStats } = await import('../src/lib/readTime.js');
  const { visualBlocker } = await import('../src/lib/visualHelpers.js');
  const prefix = '---\ntitle: "#### Fake #metadata [[Hidden]] ==not evidence=="\nhtml: "<div>metadata</div>"\n---\n';
  const body = '# Case\n\n#### Card\n**Author 24**\n==Real evidence== #body [[Visible]]\n';
  assert.deepEqual(cardStats(prefix + body), cardStats(body));
  assert.deepEqual(speechStats(prefix + body), speechStats(body));
  assert.equal(spokenEvidence(prefix + body), spokenEvidence(body));
  assert.deepEqual(extractTags(prefix + body), ['body']);
  assert.deepEqual(extractLinks(prefix + body), ['Visible']);
  assert.deepEqual(outline(prefix + body), [
    { level: 1, text: 'Case', line: 4 }, { level: 4, text: 'Card', line: 6 },
  ]);
  assert.equal(getSectionAt(prefix + body, 5), null);
  assert.deepEqual(getSectionAt(prefix + body, prefix.length + body.indexOf('Real')), getSectionAt(body, body.indexOf('Real')));
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
  const app = { isPackaged: true, getVersion: () => '2.3.4', getPath: (name) => `/current/${name}` };
  assert.equal(installationInfo(app).version, '2.3.4');
  assert.equal(installationInfo(app).profile, '/current/userData');
  assert.equal(installationInfo(app).executable, '/current/exe');
  assert.equal(installationInfo(app).arch, process.arch);
  assert.equal(installationInfo({ ...app, isPackaged: false }).version, require('../package.json').version);
});
