const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv');

const { reviewSignature, validateManifest } = require('../electron/extensions/manifest.cjs');

const root = path.join(__dirname, 'fixture');
const rawManifest = () => ({
  manifestVersion: 1,
  id: 'contrib-test',
  name: 'Contribution Test',
  version: '1.0',
  main: 'main.js',
  permissions: ['ui'],
  contributes: {
    commands: [{ id: 'open', title: 'Open' }],
    translations: { en: 'locales/en.json' },
    fonts: [
      {
        family: 'Debate Sans',
        file: 'fonts/debate.woff2',
        license: 'OFL-1.1',
        source: 'https://example.com/fonts/debate',
      },
    ],
    templates: [{ id: 'case-note', title: 'Case note', file: 'templates/case.md' }],
    panels: [
      {
        id: 'panel',
        title: 'Panel',
        placement: 'sidebar-bottom',
        persistVisibility: true,
        when: { extensions: ['.md'], mode: 'edit' },
      },
    ],
    statusBarItems: [{ id: 'status', title: 'Ready', icon: 'check', command: 'open' }],
    contextMenus: [{ id: 'editor-menu', title: 'Run', context: 'editor', command: 'open' }],
    fileHandlers: [
      {
        id: 'markdown-handler',
        title: 'Preview',
        extensions: ['.md'],
        command: 'open',
        priority: 12,
      },
    ],
  },
});

test('manifest validates extension contributions and includes them in explicit review', () => {
  const raw = rawManifest();
  const manifest = validateManifest(raw, root);
  assert.deepEqual(manifest.contributes.panels[0], {
    id: 'panel',
    title: 'Panel',
    placement: 'sidebar-bottom',
    persistVisibility: true,
    when: { extensions: ['.md'], mode: 'edit' },
  });
  assert.deepEqual(manifest.contributes.translations, { en: 'locales/en.json' });
  assert.deepEqual(manifest.contributes.fonts[0], {
    family: 'Debate Sans',
    file: 'fonts/debate.woff2',
    weight: '400',
    style: 'normal',
    license: 'OFL-1.1',
    source: 'https://example.com/fonts/debate',
  });
  assert.deepEqual(manifest.contributes.templates[0], {
    id: 'case-note',
    title: 'Case note',
    file: 'templates/case.md',
  });
  const assetOnly = validateManifest(
    {
      ...raw,
      main: undefined,
      permissions: [],
      contributes: {
        translations: { en: 'locales/en.json' },
        fonts: [{ family: 'Debate Sans', file: 'fonts/debate.woff2', license: 'OFL-1.1' }],
        templates: [{ id: 'case-note', title: 'Case note', file: 'templates/case.md' }],
      },
    },
    root
  );
  assert.equal(assetOnly.main, null);
  assert.deepEqual(assetOnly.permissions, []);
  assert.equal(manifest.contributes.fileHandlers[0].priority, 12);
  assert.notEqual(
    reviewSignature(manifest),
    reviewSignature(
      validateManifest(
        {
          ...raw,
          contributes: {
            ...raw.contributes,
            fileHandlers: [{ ...raw.contributes.fileHandlers[0], priority: 13 }],
          },
        },
        root
      )
    )
  );
  assert.throws(
    () =>
      validateManifest(
        {
          ...raw,
          contributes: {
            ...raw.contributes,
            panels: [{ id: 'panel', title: 'Panel', when: { arbitrary: true } }],
          },
        },
        root
      ),
    /unsupported condition/
  );
  assert.throws(
    () =>
      validateManifest(
        {
          ...raw,
          contributes: {
            ...raw.contributes,
            fileHandlers: [
              { id: 'bad-handler', title: 'Preview', extensions: ['.pdf'], command: 'open' },
            ],
          },
        },
        root
      ),
    /supported extensions/
  );
  assert.throws(
    () =>
      validateManifest(
        {
          ...raw,
          contributes: {
            ...raw.contributes,
            fonts: [{ family: 'Font', file: '../font.woff2', license: 'OFL' }],
          },
        },
        root
      ),
    /escapes/
  );
  assert.throws(
    () =>
      validateManifest(
        { ...raw, contributes: { ...raw.contributes, translations: { de: 'de.json' } } },
        root
      ),
    /may only map/
  );
});

test('extension catalogs are namespaced, interpolate values, and unload', async () => {
  const previousDocument = global.document;
  global.document = { documentElement: { lang: '' } };
  try {
    const { registerExtensionTranslations, setLanguage, translate } =
      await import('../src/lib/i18n.js');
    setLanguage('en');
    registerExtensionTranslations([
      {
        id: 'alpha-one',
        translations: {
          en: { greeting: 'Hello {name}', empty: '', constructor: 'Safe' },
          es: { greeting: 'Hola {name}' },
        },
      },
      { id: 'beta-two', translations: { en: { greeting: 'Welcome {name}' } } },
    ]);
    assert.equal(translate('ext.alpha-one.greeting', { name: 'Rae' }), 'Hello Rae');
    assert.equal(translate('ext.beta-two.greeting', { name: 'Rae' }), 'Welcome Rae');
    assert.equal(translate('ext.alpha-one.empty'), '');
    assert.equal(translate('ext.alpha-one.constructor'), 'Safe');
    setLanguage('es');
    assert.equal(translate('ext.alpha-one.greeting', { name: 'Rae' }), 'Hola Rae');
    assert.equal(translate('ext.beta-two.greeting', { name: 'Rae' }), 'Welcome Rae');
    registerExtensionTranslations([]);
    assert.equal(translate('ext.alpha-one.greeting'), 'ext.alpha-one.greeting');
    setLanguage('en');
  } finally {
    global.document = previousDocument;
  }
});

test('extension font faces register and are removed on reload', async () => {
  const previousDocument = global.document;
  const previousWindow = global.window;
  const previousFontFace = global.FontFace;
  const added = [];
  const deleted = [];
  global.document = {
    fonts: {
      add: (face) => added.push(face),
      delete: (face) => deleted.push(face),
    },
  };
  global.window = { dispatchEvent() {} };
  global.FontFace = class {
    constructor(family, source, descriptors) {
      Object.assign(this, { family, source, descriptors });
    }
    async load() {
      return this;
    }
  };
  try {
    const { getExtensionFonts, registerExtensionFonts } =
      await import('../src/lib/extensionFonts.js');
    const contribution = {
      extensionId: 'alpha-one',
      family: 'Debate Sans',
      weight: '400',
      style: 'normal',
      license: 'OFL-1.1',
      source: 'https://example.com/font',
      mimeType: 'font/woff2',
      data: 'AA==',
    };
    await registerExtensionFonts([contribution]);
    assert.equal(added.length, 1);
    assert.equal(getExtensionFonts()[0].license, 'OFL-1.1');
    await registerExtensionFonts([]);
    assert.deepEqual(getExtensionFonts(), []);
    assert.deepEqual(deleted, added);
  } finally {
    global.document = previousDocument;
    global.window = previousWindow;
    global.FontFace = previousFontFace;
  }
});

test('manifest schema covers UI and packaged asset contribution declarations', () => {
  const schema = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'schemas', 'extension-manifest.schema.json'), 'utf8')
  );
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  assert.equal(validate(rawManifest()), true, JSON.stringify(validate.errors));
  const invalid = rawManifest();
  invalid.contributes.panels[0].when = { arbitrary: true };
  assert.equal(validate(invalid), false);
  const invalidFont = rawManifest();
  invalidFont.contributes.fonts[0].file = 'fonts/debate.svg';
  assert.equal(validate(invalidFont), false);
});

test('status bar updates and command contexts stay within declared UI capabilities', async () => {
  const { ExtensionHost } = await import('../src/lib/extensions.js');
  const updates = [];
  const sent = [];
  const manifest = validateManifest(rawManifest(), root);
  const host = new ExtensionHost(manifest, '', {
    updateStatusBar: (_host, items) => updates.push(items),
    translate: (id, key, values) => `${id}:${key}:${values.name}`,
  });
  assert.equal(
    await host.handle('i18n.translate', ['hello', { name: 'Rae' }]),
    'contrib-test:hello:Rae'
  );
  await assert.rejects(host.handle('i18n.translate', ['hello', { name: {} }]), /scalar values/);
  await host.handle('ui.statusBar.setText', ['status', '2 sources']);
  await host.handle('ui.statusBar.setIcon', ['status', 'search']);
  await host.handle('ui.statusBar.setTooltip', ['status', 'Open research']);
  await host.handle('ui.statusBar.setCommand', ['status', 'open']);
  assert.deepEqual(updates.at(-1), [
    { id: 'status', text: '2 sources', icon: 'search', tooltip: 'Open research', command: 'open' },
  ]);
  await assert.rejects(
    host.handle('ui.statusBar.setCommand', ['status', 'missing']),
    /declared command/
  );
  await assert.rejects(host.handle('ui.statusBar.setText', ['missing', 'x']), /Undeclared/);

  host.frame = {};
  host.port = { postMessage: (message) => sent.push(message) };
  host.registered.add('open');
  host.run('open', { path: 'Case.md', selection: 'selected text', uri: 'tagline://note/Case.md' });
  assert.deepEqual(sent.at(-1), {
    type: 'command',
    command: 'open',
    context: { path: 'Case.md', selection: 'selected text', uri: 'tagline://note/Case.md' },
  });
  assert.throws(
    () => host.run('open', { path: 'x.md', selection: 'x'.repeat(9000) }),
    /8,192 bytes/
  );
  assert.throws(() => host.run('missing'), /not registered/);
});
