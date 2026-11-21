const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildWebsite, loadSources, renderHtml } = require('../scripts/build-website.cjs');

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
    fs.writeFileSync(path.join(constantRoot, 'limits.cjs'), 'const MAX_BYTES = 5 * 1_024 * 1_024;\n');
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

    const pages = fs.readdirSync(path.join(outputDir, 'docs')).filter((name) => name.endsWith('.html'));
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
