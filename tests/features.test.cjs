const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const { promisify } = require('node:util');

test('extension vault mutation and watch APIs enforce permissions and clean up subscriptions', async () => {
  const { ExtensionHost } = await import('../src/lib/extensions.js');
  const manifest = { id: 'test', name: 'Test', permissions: [], contributes: { commands: [] } };
  let subscriptions = 0;
  const bridge = {
    append: async () => 'Card.md', delete: async () => true, rename: async () => 'Renamed.md',
    flush: async () => true, compareAndSwap: async () => false,
    watch: () => { subscriptions++; return () => { subscriptions--; }; },
  };
  const host = new ExtensionHost(manifest, '', bridge);
  const calls = [
    ['vault.append', ['Card.md', 'text']], ['vault.delete', ['Card.md']],
    ['vault.rename', ['Card.md', 'Renamed.md']], ['vault.flush', []],
    ['vault.compareAndSwap', ['Card.md', 'old', 'new']], ['vault.watch', []],
  ];
  for (const [method, args] of calls) await assert.rejects(host.handle(method, args), /Permission/);
  manifest.permissions = ['vault:write'];
  await assert.rejects(host.handle('vault.append', ['Card.md', 'text']), /vault:read/);
  await assert.rejects(host.handle('vault.compareAndSwap', ['Card.md', 'old', 'new']), /vault:read/);
  manifest.permissions.push('vault:read');
  for (const [method, args] of calls.slice(0, -1)) await host.handle(method, args);
  await assert.rejects(host.handle('vault.compareAndSwap', ['Card.md', null, 'new']), /Expected content/);
  const id = await host.handle('vault.watch', []);
  assert.equal(subscriptions, 1);
  assert.equal(await host.handle('vault.unwatch', [id]), true);
  assert.equal(await host.handle('vault.unwatch', [id]), false);
  for (let i = 0; i < 32; i++) await host.handle('vault.watch', []);
  await assert.rejects(host.handle('vault.watch', []), /32 vault watches/);
  // Disposal's DOM listener removal is tested in the Electron suite; check its subscription cleanup here.
  const original = global.window;
  global.window = { removeEventListener() {} };
  try { host.dispose(); } finally { global.window = original; }
  assert.equal(subscriptions, 0);
});

test('translations have matching keys and preserve every interpolation', () => {
  const es = require('../src/locales/es.json');
  const fr = require('../src/locales/fr.json');
  assert.deepEqual(Object.keys(es).sort(), Object.keys(fr).sort());
  for (const catalog of [es, fr]) {
    for (const [key, translation] of Object.entries(catalog)) {
      assert.ok(translation.length);
      assert.deepEqual((key.match(/\{\w+\}/g) || []).sort(), (translation.match(/\{\w+\}/g) || []).sort(), key);
    }
  }
});

const luminance = (hex) => {
  const rgb = hex.slice(1).match(/../g).map((n) => {
    const v = parseInt(n, 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
};
const contrast = (a, b) => {
  const l = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (l[0] + 0.05) / (l[1] + 0.05);
};

test('all themes share tokens; high contrast text meets 7:1 on major surfaces', () => {
  const themes = fs.readdirSync(path.join(__dirname, '../src/themes')).map((file) =>
    JSON.parse(fs.readFileSync(path.join(__dirname, '../src/themes', file), 'utf8')));
  for (const theme of themes) {
    assert.equal(theme.version, 1);
    assert.deepEqual(Object.keys(theme.colors).sort(), Object.keys(themes[0].colors).sort());
    if (!theme.id.startsWith('high-contrast')) continue;
    for (const color of ['text', 'text-muted', 'text-faint', 'accent', 'aff', 'neg', 'warning', 'h1', 'h2', 'h3', 'h4']) {
      for (const bg of ['bg', 'bg-secondary', 'bg-elevated', 'bg-hover']) {
        assert.ok(contrast(theme.colors[color], theme.colors[bg]) >= 7, `${theme.id}: ${color}/${bg}`);
      }
    }
    assert.ok(contrast(theme.colors['accent-text'], theme.colors.accent) >= 7);
    assert.ok(contrast(theme.colors['highlight-text'], theme.colors['highlight-bg']) >= 7);
  }
});

test('theme variables expose CSS values and reject malformed or network-loading overrides', async () => {
  const { validateTheme } = await import('../src/lib/themes.js');
  const value = { version: 1, name: 'Custom', mode: 'dark', colors: {}, variables: {
    'font-ui': '"Example", sans-serif', 'editor-font-size': '20px',
    'future-token': 'calc(100% - 20px)', accent: 'var(--text)',
  } };
  assert.deepEqual(validateTheme(value).variables, value.variables);
  assert.deepEqual(validateTheme({ ...value, variables: undefined }).variables, {});
  for (const variables of [[], null, { '--font-ui': 'serif' }, { a: 1 }, { a: 'url(https://example.com)' },
    { a: 'red; color: blue' }, { a: '' }, Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`var-${i}`, '1']))]) {
    assert.throws(() => validateTheme({ ...value, variables }), /variable/i);
  }
});

test('embedded browser accepts web URLs without enabling local or privileged schemes', () => {
  const { webUrl } = require('../electron/browser.cjs');
  assert.equal(webUrl('https://example.com/a?q=1'), 'https://example.com/a?q=1');
  for (const url of ['file:///C:/secret', 'javascript:alert(1)', 'data:text/html,test',
    'https://user:pass@example.com', '', null, 'https://example.com/' + 'a'.repeat(8192)]) {
    assert.throws(() => webUrl(url));
  }
});

test('embedded browser presents a standard Chrome user agent and builds archive links', () => {
  const { browserUserAgent, archiveUrl } = require('../electron/browser.cjs');
  const agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) tagline/0.1.0 '
    + 'Chrome/140.0.0.0 Electron/45.0.0 Safari/537.36';
  assert.equal(browserUserAgent(agent),
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
  assert.equal(archiveUrl('https://example.com/a?b=1'), 'https://web.archive.org/web/https://example.com/a?b=1');
  assert.throws(() => archiveUrl('file:///C:/secret'));
});

test('Pandoc import chooses an explicit reader, passes literal paths, and surfaces errors', async (t) => {
  let captured;
  let fail = false;
  const original = childProcess.execFile;
  const mock = () => { throw new Error('Expected promisified execFile'); };
  mock[promisify.custom] = async (exe, args, options) => {
    captured = { exe, args, options };
    if (fail) throw new Error('Bad document');
    return { stdout: '# Imported\n\n**Card**', stderr: 'Conversion warning' };
  };
  childProcess.execFile = mock;
  t.after(() => { childProcess.execFile = original; });
  const { importDocument } = require('../electron/documents.cjs');
  const file = 'C:\\notes\\document & more.docx';
  assert.deepEqual(await importDocument('pandoc', file), {
    markdown: '# Imported\n\n**Card**', warnings: 'Conversion warning',
  });
  assert.ok(captured.args.includes('--from=docx'));
  assert.ok(captured.args.includes('--to=markdown+raw_html-bracketed_spans'));
  assert.ok(captured.args.includes('--sandbox'));
  assert.equal(captured.args.at(-1), file);
  assert.equal(captured.options.timeout, 120000);
  fail = true;
  await assert.rejects(importDocument('pandoc', file), /Bad document/);
  await assert.rejects(importDocument('pandoc', 'C:\\notes\\script.exe'), /Unsupported import format/);
});
