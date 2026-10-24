const { test } = require('node:test');
const assert = require('node:assert/strict');

const example = {
  version: 1, name: 'Readable', mode: 'dark', colors: { selection: '#123456', 'selection-text': '#ffffff' },
  variables: { 'editor-font-size': '20px', 'font-ui': 'system-ui' },
  metadata: {
    author: 'Example', description: 'A reading theme', license: 'MIT', tags: ['reading'],
    accessibility: { contrast: 'high', colorVision: ['deuteranopia'], reducedMotion: true, notes: 'Author tested.' },
  },
  settings: [
    { id: 'selection-color', title: 'Selection', type: 'string', default: '#123456', variable: 'selection' },
    { id: 'font-size', title: 'Font size', type: 'number', default: 20, min: 12, max: 30, variable: 'editor-font-size', unit: 'px' },
    { id: 'ui-font', title: 'UI font', type: 'string', default: 'system-ui', enum: ['system-ui', 'serif'], variable: 'font-ui' },
  ],
};

test('theme settings validate and resolve into colors/variables without changing the definition', async () => {
  const { validateTheme, resolveThemeSettings } = await import('../src/lib/themes.js');
  const theme = validateTheme(example);
  const resolved = resolveThemeSettings(theme, { 'selection-color': '#abcdef80', 'font-size': 24, 'ui-font': 'serif' });
  assert.equal(resolved.colors.selection, '#abcdef80');
  assert.equal(resolved.colors['selection-text'], '#ffffff');
  assert.equal(resolved.variables['editor-font-size'], '24px');
  assert.equal(resolved.variables['font-ui'], 'serif');
  assert.equal(theme.variables['editor-font-size'], '20px');
  assert.deepEqual(theme.metadata, example.metadata);
  assert.deepEqual(validateTheme(JSON.parse(JSON.stringify(theme))), theme, 'metadata and settings survive import/export');
  assert.throws(() => resolveThemeSettings(theme, { 'font-size': 100 }), /Invalid value/);
  assert.throws(() => resolveThemeSettings(theme, { 'ui-font': 'invalid' }), /Invalid value/);
  assert.throws(() => resolveThemeSettings(theme, { 'selection-color': 'red' }), /hex color/);
  assert.throws(() => resolveThemeSettings(theme, { missing: 1 }), /Unknown theme setting/);
  const override = validateTheme({ ...example, variables: { ...example.variables, selection: '#123456' } });
  assert.equal(resolveThemeSettings(override, { 'selection-color': '#abcdef' }).variables.selection, '#abcdef',
    'color settings also override CSS variable entries for the same token');
});

test('invalid theme settings and accessibility declarations fail explicitly', async () => {
  const { validateTheme } = await import('../src/lib/themes.js');
  for (const settings of [
    null, {}, [null], [example.settings[0], example.settings[0]],
    [{ ...example.settings[0], variable: 'undeclared' }],
    [{ ...example.settings[0], default: 'red' }],
    [{ ...example.settings[1], unit: 'url(evil)' }],
    [{ ...example.settings[1], default: Infinity }],
    [{ ...example.settings[2], default: 'url(https://example.com)', enum: undefined }],
  ]) assert.throws(() => validateTheme({ ...example, settings }));
  for (const metadata of [
    null, [], { accessibility: null }, { accessibility: { contrast: 'AAA' } },
    { accessibility: { reducedMotion: 'yes' } }, { tags: [1] },
    { accessibility: { colorVision: ['unknown'] } }, { author: 'a'.repeat(501) },
  ]) assert.throws(() => validateTheme({ ...example, metadata }));
});

test('theme option values are isolated by theme and unavailable theme choices retain their fallback', async () => {
  const { validateTheme, registerExtensionThemes, getTheme } = await import('../src/lib/themes.js');
  const old = global.window;
  global.window = { dispatchEvent() { } };
  try {
    registerExtensionThemes([
      { ...validateTheme(example), id: 'ext:readable:0' },
      { ...validateTheme(example), id: 'ext:readable:1' },
    ]);
    const values = { 'ext:readable:0': { 'font-size': 26 } };
    assert.equal(getTheme('ext:readable:0', null, values).variables['editor-font-size'], '26px');
    assert.equal(getTheme('ext:readable:1', null, values).variables['editor-font-size'], '20px');
    assert.equal(getTheme('ext:missing:0', null, values).id, 'dark');
  } finally { registerExtensionThemes([]); global.window = old; }
});

test('refresh animation rounds to complete turns with a one-turn minimum', async () => {
  const { refreshTurns, REFRESH_TURN_MS } = await import('../src/lib/refreshAnimation.js');
  for (const [elapsed, turns] of [[0, 1], [1, 1], [599.9, 1], [600, 1], [600.1, 2], [1250, 3]]) {
    assert.equal(refreshTurns(elapsed), turns);
    assert.ok(refreshTurns(elapsed) * REFRESH_TURN_MS >= elapsed);
  }
});
