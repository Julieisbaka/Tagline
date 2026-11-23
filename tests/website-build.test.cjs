const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseDocument } = require('htmlparser2');
const { buildWebsite, loadSources, renderHtml } = require('../scripts/build-website.cjs');
const { syncDocs, syncValues } = require('../scripts/sync-doc-values.cjs');

const rootDir = path.join(__dirname, '..');

test('website build renders code-derived values from the application sources', async () => {
  const sources = await loadSources(rootDir);
  const render = (body) => renderHtml(`{{TAGLINE:${body}}}`, sources);

  assert.equal(render('SETTING:templateFolder'), sources.settings.templateFolder);
  assert.equal(render('SETTING:timerFloatingWindow'), 'off');
  assert.equal(render('KEY:send-card'), 'Mod+Shift+S');
  assert.equal(render('KEY_WIN:flow-row'), 'Ctrl+Enter');
  assert.equal(render('KEY_MAC:flow-row'), 'Cmd+Enter');
  assert.equal(render('KEY:flow-cell-up'), 'Alt+Up');
  assert.equal(render('KEY:flow-deselect'), 'Esc');
  assert.equal(render('LIMIT:themeFileBytes'), '65,536');
  assert.equal(render('LIMIT:themeFileBytes.max'), '1,048,576');
  assert.equal(render('CONST:electron/extensions/storage.cjs#MAX_SECRETS'), '50');
});

test('website build rejects unresolvable or malformed tokens', async () => {
  const sources = await loadSources(rootDir);

  for (const body of [
    'SETTING:doesNotExist',
    'SETTING:timerState',
    'KEY:doesNotExist',
    'KEY:new-flow',
    'LIMIT:themeFileBytes.step',
    'LIMIT:doesNotExist',
    'CONST:electron/extensions/storage.cjs#NOT_DECLARED',
    'CONST:../package.json#VERSION',
    'UNKNOWN:value',
  ]) {
    assert.throws(() => renderHtml(`{{TAGLINE:${body}}}`, sources), /ebsite template/, body);
  }
});

test('website build evaluates simple numeric constant products', async () => {
  const sources = await loadSources(rootDir);
  const constantRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tagline-website-const-'));

  try {
    fs.writeFileSync(
      path.join(constantRoot, 'limits.cjs'),
      'const MAX_BYTES = 5 * 1_024 * 1_024;\n'
    );
    assert.equal(
      renderHtml('{{TAGLINE:CONST:limits.cjs#MAX_BYTES}}', { ...sources, rootDir: constantRoot }),
      '5,242,880'
    );
  } finally {
    fs.rmSync(constantRoot, { recursive: true, force: true });
  }
});

test('website pages build without unresolved Tagline tokens', async () => {
  const sources = await loadSources(rootDir);
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tagline-website-build-'));

  try {
    buildWebsite(path.join(rootDir, 'website'), outputDir, sources);

    const pages = fs
      .readdirSync(path.join(outputDir, 'docs'))
      .filter((name) => name.endsWith('.html'));
    assert.ok(pages.length > 0);
    for (const page of pages) {
      const html = fs.readFileSync(path.join(outputDir, 'docs', page), 'utf8');
      assert.doesNotMatch(html, /\{\{TAGLINE:/, page);
    }
    assert.match(
      fs.readFileSync(path.join(outputDir, 'docs', 'keyboard-shortcuts.html'), 'utf8'),
      /<kbd>Mod\+P<\/kbd><span>Open command palette/
    );
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('Mintlify documentation values stay synchronized with application defaults', async () => {
  const sources = await loadSources(rootDir);
  const input = '<kbd>{/* TAGLINE:KEY:commands */}old{/* /TAGLINE */}</kbd>';
  assert.equal(
    syncValues(input, sources),
    '<kbd>{/* TAGLINE:KEY:commands */}Mod+P{/* /TAGLINE */}</kbd>'
  );
  assert.throws(() => syncValues('{/* TAGLINE:KEY:commands */}old', sources), /Malformed/);
  assert.throws(
    () => syncValues('{/* TAGLINE:KEY:missing */}x{/* /TAGLINE */}', sources),
    /Unknown shortcut/
  );
  assert.deepEqual(await syncDocs(rootDir, true), []);
});

test('Mintlify provides a page and legacy redirect for every existing guide', () => {
  const config = JSON.parse(fs.readFileSync(path.join(rootDir, 'docs', 'docs.json'), 'utf8'));
  const pages = config.navigation.groups.flatMap((group) => group.pages);
  for (const file of fs
    .readdirSync(path.join(rootDir, 'website', 'docs'))
    .filter((name) => name.endsWith('.html'))) {
    const slug = file.slice(0, -5);
    assert.ok(pages.includes(slug), `${file}: missing navigation`);
    const mdx = fs.readFileSync(path.join(rootDir, 'docs', `${slug}.mdx`), 'utf8');
    assert.ok(
      config.redirects.some(
        (entry) => entry.source === `/${file}` && entry.destination === `/${slug}`
      ),
      `${file}: missing redirect`
    );
    const html = parseDocument(
      fs.readFileSync(path.join(rootDir, 'website', 'docs', file), 'utf8')
    );
    const visit = (node) => {
      if ((node.name === 'section' || /^h[2-6]$/.test(node.name || '')) && node.attribs?.id) {
        assert.ok(
          mdx.includes(`{#${node.attribs.id}}`),
          `${file}: missing anchor ${node.attribs.id}`
        );
      }
      for (const child of node.children || []) {
        visit(child);
      }
    };
    visit(html);
  }
});
