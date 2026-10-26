const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv');

const root = path.join(__dirname, '..');
const directory = path.join(root, 'schemas');
const names = ['flow', 'extension-manifest', 'theme', 'extension-settings'];
const schemas = Object.fromEntries(names.map((name) => [
  name, JSON.parse(fs.readFileSync(path.join(directory, `${name}.schema.json`), 'utf8')),
]));
const ajv = new Ajv({ allErrors: true, strict: true, strictTypes: false, strictRequired: false, allowUnionTypes: true });
for (const [name, schema] of Object.entries(schemas)) ajv.addSchema(schema, `${name}.schema.json`);
const validators = Object.fromEntries(names.map((name) => [name, ajv.getSchema(`${name}.schema.json`)]));
const check = (name, data, valid = true) => {
  const validate = validators[name];
  assert.equal(validate(data), valid, `${name}: ${ajv.errorsText(validate.errors)}`);
};
const readJson = (...segments) => JSON.parse(fs.readFileSync(path.join(root, ...segments), 'utf8'));

test('all public schemas compile offline and every editor association points to a schema', () => {
  for (const name of names) {
    assert.equal(ajv.validateSchema(schemas[name]), true);
    assert.equal(typeof validators[name], 'function');
  }
  const settings = readJson('.vscode', 'settings.json');
  const associations = settings['json.schemas'];
  for (const name of names) {
    const association = associations.find((item) => item.url === `./schemas/${name}.schema.json`);
    assert.ok(association, `${name} has an authoring association`);
    assert.ok(fs.existsSync(path.resolve(root, association.url)));
  }
  assert.equal(settings['files.associations']['*.flow'], 'json');
  assert.equal(settings['files.associations']['*.canvas'], 'json');
  assert.equal(associations.some((item) => item.fileMatch.includes('*.canvas')), false,
    'JSON Canvas follows the upstream specification rather than a Tagline schema');
  assert.ok(readJson('package.json').build.files.includes('schemas/**/*'), 'schemas ship with the app for offline use');
});

test('flow schema matches supported structures and preserves extension fields', async () => {
  const { EMPTY_FLOW, parseFlow } = await import('../electron/flow.mjs');
  check('flow', JSON.parse(EMPTY_FLOW));
  const flow = { version: 1, sheets: [{ name: '', columns: ['1AC'], rows: [[''], ['Argument']] }], custom: true };
  check('flow', flow);
  assert.deepEqual(parseFlow(JSON.stringify(flow)), flow);
  for (const invalid of [
    {}, [], { sheets: [] }, { sheets: flow.sheets }, { version: 2, sheets: flow.sheets },
    { sheets: [{ name: 'Round', columns: [], rows: [] }] },
    { sheets: [{ name: 'Round', columns: ['1AC'], rows: [[true]] }] },
  ]) {
    check('flow', invalid, false);
    assert.throws(() => parseFlow(JSON.stringify(invalid)));
  }
  const unequalRow = { version: 1, sheets: [{ name: 'Round', columns: ['1AC', '1NC'], rows: [['Only one cell']] }] };
  check('flow', unequalRow);
  assert.throws(() => parseFlow(JSON.stringify(unequalRow)), /structure/, 'cross-field row length remains a runtime check');
});

test('extension manifest schema accepts the demo and checks declarations, permissions and typed settings', () => {
  const { validateManifest } = require('../electron/extensions.cjs');
  const demo = readJson('demo', 'tagline-api-demo', 'manifest.json');
  check('extension-manifest', demo);
  validateManifest(demo, path.join(root, 'demo', 'tagline-api-demo'));
  const minimal = { manifestVersion: 1, id: 'test', name: 'Test', version: '1' };
  check('extension-manifest', minimal);
  const setting = { id: 'limit', title: 'Limit', type: 'number', default: 5, min: 1, max: 10 };
  const valid = { ...minimal, permissions: ['settings'], contributes: { settings: [setting] } };
  check('extension-manifest', valid);
  for (const invalid of [
    { ...minimal, id: 'Bad ID' },
    { ...minimal, main: 'main.txt' },
    { ...minimal, main: 'C:\\outside.js' },
    { ...minimal, contributes: { commands: [{ id: 'run', title: 'Run' }] } },
    { ...minimal, main: 'main.js', contributes: { panels: [{ id: 'panel', title: 'Panel' }] } },
    { ...valid, permissions: [] },
    { ...valid, contributes: { settings: [{ ...setting, default: '5' }] } },
    { ...valid, contributes: { settings: [{ ...setting, type: 'boolean', default: true }] } },
    { ...valid, contributes: { settings: [{ ...setting, maxLength: 10 }] } },
    { ...valid, contributes: { settings: [{ id: 'choice', title: 'Choice', type: 'string', default: '', enum: [] }] } },
  ]) {
    check('extension-manifest', invalid, false);
    assert.throws(() => validateManifest(invalid, root));
  }
});

test('theme schema validates bundled themes, settings, CSS variables and metadata', async () => {
  const { COLOR_TOKENS, validateTheme } = await import('../src/lib/themes.js');
  assert.deepEqual(new Set(schemas.theme.definitions.colorToken.enum), new Set(COLOR_TOKENS));
  for (const folder of [path.join('src', 'themes'), path.join('demo', 'tagline-api-demo', 'themes')]) {
    for (const file of fs.readdirSync(path.join(root, folder)).filter((name) => name.endsWith('.json'))) {
      const theme = readJson(path.join(folder, file));
      check('theme', theme);
      validateTheme(theme);
    }
  }
  const theme = {
    version: 1, name: 'Test', mode: 'dark', colors: {},
    variables: { 'editor-font-size': '18px' },
    settings: [{ id: 'font-size', title: 'Font size', type: 'number', default: 18, min: 12, max: 32, variable: 'editor-font-size', unit: 'px' }],
  };
  check('theme', theme);
  validateTheme(theme);
  for (const invalid of [
    { ...theme, colors: { unknown: '#ffffff' } },
    { ...theme, colors: { bg: '#fff' } },
    { ...theme, variables: { '--bg': 'red' } },
    { ...theme, variables: { bg: 'URL(https://example.com)' } },
    { ...theme, metadata: { extra: true } },
    { ...theme, metadata: { accessibility: { contrast: 'guaranteed' } } },
    { ...theme, settings: [{ ...theme.settings[0], variable: 'accent' }] },
    { ...theme, settings: [{ ...theme.settings[0], unit: 'vh' }] },
  ]) {
    check('theme', invalid, false);
    assert.throws(() => validateTheme(invalid));
  }
});

test('extension settings exports have a version, matching ID shape and scalar values', () => {
  check('extension-settings', { version: 1, extensionId: 'demo', values: { enabled: true, limit: 5, style: 'brief' } });
  check('extension-settings', { version: 1, extensionId: 'demo', values: {} });
  for (const invalid of [
    {}, { version: 2, extensionId: 'demo', values: {} },
    { version: 1, extensionId: 'Bad ID', values: {} },
    { version: 1, extensionId: 'demo', values: [] },
    { version: 1, extensionId: 'demo', values: { enabled: null } },
    { version: 1, extensionId: 'demo', values: { unknown: {} } },
  ]) check('extension-settings', invalid, false);
});
