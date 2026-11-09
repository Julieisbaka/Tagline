const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateManifest } = require('../electron/extensions/manifest.cjs');

const base = (themeGroups) => ({
  manifestVersion: 1,
  id: 'ocean-themes',
  name: 'Ocean',
  version: '1.0.0',
  contributes: { themeGroups },
});
const group = { id: 'ocean', title: 'Ocean', light: 'themes/l.json', dark: 'themes/d.json' };

test('theme groups validate and normalize', () => {
  const manifest = validateManifest(base([group]), __dirname);
  assert.deepEqual(manifest.contributes.themeGroups, [group]);
  assert.deepEqual(manifest.permissions, []);
});

test('theme groups reject duplicates, bad paths and too many', () => {
  assert.throws(() => validateManifest(base([group, group]), __dirname));
  assert.throws(() => validateManifest(base([{ ...group, dark: '../d.json' }]), __dirname));
  assert.throws(() => validateManifest(base([{ ...group, light: 'a.txt' }]), __dirname));
  assert.throws(() => validateManifest(base([{ ...group, title: '' }]), __dirname));
  const many = Array.from({ length: 11 }, (_, i) => ({ ...group, id: `g${i}x` }));
  assert.throws(() => validateManifest(base(many), __dirname));
});

test('match-system resolves the half for the OS scheme', async () => {
  const themes = await import('../src/lib/themes.js');
  let dark = true;
  global.window = {
    matchMedia: () => ({ matches: dark }),
    dispatchEvent: () => {},
  };
  const mk = (mode) => ({
    ...themes.validateTheme({ version: 1, name: mode, mode, colors: {} }),
    id: `ext:ocean-themes:ocean:${mode}`,
    group: { id: 'ext:ocean-themes:ocean', title: 'Ocean' },
  });
  themes.registerExtensionThemes([mk('light'), mk('dark')]);
  const id = 'ext:ocean-themes:ocean:auto';
  assert.equal(themes.getTheme(id, null).mode, 'dark');
  dark = false;
  assert.equal(themes.getTheme(id, null).mode, 'light');
  themes.registerExtensionThemes([]);
  assert.equal(themes.getTheme(id, null).id, 'light');
  delete global.window;
});
