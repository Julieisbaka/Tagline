const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const Ajv = require('ajv');

const root = path.join(__dirname, '..');
const importThemes = () => import('../src/lib/themes.js');
const readTheme = (name) =>
  fs.readFile(path.join(root, 'src', 'themes', `${name}.json`), 'utf8').then(JSON.parse);

test('built-in themes validate against the schema including pairings', async () => {
  const schema = JSON.parse(
    await fs.readFile(path.join(root, 'schemas', 'theme.schema.json'), 'utf8')
  );
  // The theme schema references the extension manifest's settingBase definition.
  const manifestSchema = JSON.parse(
    await fs.readFile(path.join(root, 'schemas', 'extension-manifest.schema.json'), 'utf8')
  );
  const validate = new Ajv({ allErrors: true, strict: false })
    .addSchema(manifestSchema, 'extension-manifest.schema.json')
    .compile(schema);
  for (const name of ['dark', 'light', 'high-contrast-dark', 'high-contrast-light']) {
    const theme = await readTheme(name);
    assert.equal(validate(theme), true, `${name}: ${JSON.stringify(validate.errors)}`);
    assert.ok(theme.pairings.length > 0, `${name} ships canonical pairings`);
    assert.equal(
      new Set(theme.pairings.map((pairing) => pairing.id)).size,
      theme.pairings.length,
      `${name} pairing ids are unique`
    );
  }
});

test('new component and state tokens resolve from the mode base', async () => {
  const { validateTheme, COLOR_TOKENS } = await importThemes();
  assert.ok(COLOR_TOKENS.includes('button-primary-bg'));
  assert.ok(COLOR_TOKENS.includes('link'));
  const theme = validateTheme({ version: 1, name: 'O', mode: 'dark', colors: {} });
  // Unspecified tokens inherit the dark base and include every new token.
  assert.equal(typeof theme.colors['button-bg'], 'string');
  assert.equal(typeof theme.colors['focus-ring'], 'string');
  assert.deepEqual(theme.pairings, []);
});

test('validateTheme accepts and normalizes pairings and rejects malformed ones', async () => {
  const { validateTheme } = await importThemes();
  const value = {
    version: 1,
    name: 'O',
    mode: 'dark',
    colors: {},
    pairings: [
      { id: 'body', fg: 'text', bg: 'bg', minRatio: 4.5 },
      { id: 'link', fg: 'link', bg: 'bg' },
    ],
  };
  assert.deepEqual(validateTheme(value).pairings, [
    { id: 'body', fg: 'text', bg: 'bg', minRatio: 4.5 },
    { id: 'link', fg: 'link', bg: 'bg' },
  ]);
  const broken = [
    [{ id: 'a', fg: 'text', bg: 'no-such-token' }],
    [
      { id: 'a', fg: 'text', bg: 'bg' },
      { id: 'a', fg: 'text', bg: 'bg' },
    ],
    [{ id: 'A', fg: 'text', bg: 'bg' }],
    [{ id: 'a', fg: 'text', bg: 'bg', minRatio: 0 }],
    [{ id: 'a', fg: 'text', bg: 'bg', minRatio: 22 }],
    [{ id: 'a', fg: 'text', bg: 'bg', minRatio: 'high' }],
    [{ fg: 'text', bg: 'bg' }],
    [{ id: 'a', fg: 'text', bg: 'bg', extra: true }],
    'nope',
  ];
  for (const pairings of broken) {
    assert.throws(
      () => validateTheme({ ...value, pairings }),
      /pairing/i,
      JSON.stringify(pairings)
    );
  }
});

test('checkThemeContrast measures WCAG ratios with translucent compositing', async () => {
  const { checkThemeContrast, validateTheme } = await importThemes();
  const black = validateTheme({
    version: 1,
    name: 'X',
    mode: 'dark',
    colors: { bg: '#000000' },
    pairings: [{ id: 'inverse', fg: 'text', bg: 'bg', minRatio: 1 }],
  });
  black.colors.text = '#ffffff';
  const results = checkThemeContrast(black);
  assert.equal(results.length, 1);
  assert.equal(results[0].ratio, 21);
  assert.ok(results[0].pass);
  // The dark base pairing set passes with its declared minimums.
  const dark = await readTheme('dark');
  for (const result of checkThemeContrast(dark)) {
    assert.ok(result.pass, `${result.id}: ${result.ratio} < ${result.minRatio}`);
  }
  // A translucent token composites over bg before measuring.
  const translucent = validateTheme({
    version: 1,
    name: 'T',
    mode: 'dark',
    colors: { selection: '#8b6cff59' },
    pairings: [{ id: 'selection', fg: 'selection-text', bg: 'selection', minRatio: 3 }],
  });
  const [selection] = checkThemeContrast(translucent);
  assert.ok(selection.ratio >= 3 && selection.ratio <= 21, `ratio ${selection.ratio}`);
  assert.ok(selection.pass);
  assert.throws(
    () => checkThemeContrast({ colors: {}, pairings: [{ id: 'a', fg: 'bg', bg: 'bg' }] }),
    /pairing|color/i
  );
});

test('the themes helper exposes contrast checking to extensions', async () => {
  const { extensionHelper } = await import('../src/lib/extensionCapabilities.js');
  const dark = await readTheme('dark');
  const results = extensionHelper('helpers.themes.contrast', [dark]);
  assert.ok(results.length > 0);
  assert.ok(results.every((result) => typeof result.ratio === 'number'));
  assert.throws(
    () => extensionHelper('helpers.themes.contrast', [{ colors: {} }]),
    /theme|pairing/i
  );
});
