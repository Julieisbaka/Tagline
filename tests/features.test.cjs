const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const { promisify } = require('node:util');

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
