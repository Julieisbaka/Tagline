const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('extension capabilities validate selection, command, helper, event and UI contracts', async () => {
  const { ExtensionHost } = await import('../src/lib/extensions.js');
  const {
    applicationEvents,
    createEventBus,
    extensionHelper,
    pathHelper,
    markdownToText,
    requirePayload,
  } = await import('../src/lib/extensionCapabilities.js');
  const cardMarkdown = '#### Climate impact\n\n**Smith 2024**\n\n==The impact is significant.==';
  assert.equal(extensionHelper('helpers.markdown.slugify', ['Climate Impact']), 'climate-impact');
  assert.equal(extensionHelper('helpers.countdown.remainingAt', [20_000, 10_000]), 10);
  assert.equal(extensionHelper('helpers.language.system', [['fr-CA', 'en']]), 'fr');
  assert.equal(extensionHelper('helpers.language.initial', ['invalid', ['es-MX']]), 'es');
  assert.equal(extensionHelper('helpers.keybindings.valid', ['Mod+Shift+K']), true);
  assert.equal(extensionHelper('helpers.keybindings.valid', ['not-a-shortcut']), false);
  assert.equal(extensionHelper('helpers.keybindings.display', ['Mod+K', 'darwin']), 'Cmd+K');
  assert.deepEqual(extensionHelper('helpers.layout.normalizeRibbon', [['search'], [], []]), [
    'search',
  ]);
  assert.deepEqual(
    extensionHelper('helpers.layout.moveRibbon', [['search', 'graph'], 'graph', 'search']),
    ['graph', 'search']
  );
  assert.deepEqual(
    extensionHelper('helpers.layout.normalizeWorkspace', [
      ['cards'],
      [{ id: 'cards' }, { id: 'words' }],
    ]),
    ['cards']
  );
  assert.deepEqual(
    extensionHelper('helpers.layout.moveWorkspace', [['cards', 'words'], 'words', 'cards']),
    ['words', 'cards']
  );
  assert.deepEqual(extensionHelper('helpers.vault.extractLinks', ['[[Evidence]]']), ['Evidence']);
  assert.deepEqual(extensionHelper('helpers.vault.extractTags', ['#aff #impact']), [
    'aff',
    'impact',
  ]);
  assert.equal(
    extensionHelper('helpers.vault.resolveLink', ['Evidence', ['Evidence.md']]),
    'Evidence.md'
  );
  assert.deepEqual(extensionHelper('helpers.vault.outline', ['# Evidence']), [
    { level: 1, text: 'Evidence', line: 0 },
  ]);
  assert.throws(
    () =>
      extensionHelper('helpers.flowCells.copy', [
        [['cell']],
        { top: 0, bottom: 100_000, left: 0, right: 0 },
      ]),
    /bounds/
  );
  assert.throws(
    () =>
      extensionHelper('helpers.layout.normalizeRibbon', [
        [],
        new Array(1001).fill({ id: 'ext:a.b' }),
        [],
      ]),
    /1,000/
  );
  assert.equal(
    await new ExtensionHost({ permissions: [] }, '', {}).handle('helpers.language.system', [
      ['es-MX'],
    ]),
    'es'
  );
  await assert.rejects(
    new ExtensionHost({ permissions: [] }, '', {}).handle('helpers.markdownToText', ['text']),
    /Unknown/
  );
  assert.deepEqual(extensionHelper('helpers.markdown.outline', [`# Case\n${cardMarkdown}`]), [
    { level: 1, text: 'Case', line: 0 },
    { level: 4, text: 'Climate impact', line: 1 },
  ]);
  assert.deepEqual(extensionHelper('helpers.markdown.extractLinks', ['[[Evidence]]']), [
    'Evidence',
  ]);
  assert.deepEqual(extensionHelper('helpers.markdown.extractTags', ['#aff #impact']), [
    'aff',
    'impact',
  ]);
  const metadata = '---\nspeech: true\n---\n# Speech';
  assert.deepEqual(
    await new ExtensionHost({ permissions: [] }, '', {}).handle('helpers.markdown.frontmatter', [
      metadata,
    ]),
    { data: { speech: true }, body: '# Speech', prefix: '---\nspeech: true\n---\n' }
  );
  assert.equal(markdownToText(metadata), 'Speech');
  assert.throws(
    () => extensionHelper('helpers.markdown.frontmatter', ['---\nbroken: [\n---']),
    /Invalid YAML/
  );
  assert.equal(
    extensionHelper('helpers.markdown.resolveLink', ['Evidence', ['Evidence.md']]),
    'Evidence.md'
  );
  assert.equal(extensionHelper('helpers.cards.getAt', [cardMarkdown, 24]).title, 'Climate impact');
  assert.equal(
    extensionHelper('helpers.cards.spokenEvidence', [cardMarkdown]),
    'The impact is significant.\nSmith 2024'
  );
  assert.equal(extensionHelper('helpers.cards.stats', [cardMarkdown]).cards, 1);
  assert.equal(extensionHelper('helpers.cards.formatDuration', [90]), '1:30');
  assert.equal(
    extensionHelper('helpers.citations.create', [
      { author: 'Smith', year: '2024', title: 'A claim' },
    ]),
    '**Smith 2024** — "A claim"'
  );
  assert.deepEqual(extensionHelper('helpers.citations.extract', ['**Smith 2024** — "Study"']), {
    citation: {
      author: 'Smith',
      year: '2024',
      title: 'Study',
      publication: '',
      url: '',
      accessed: '',
    },
    uncertainFields: [],
  });
  assert.equal(
    extensionHelper('helpers.citations.extract', [
      '**Smith 2024** — [article][source]',
      { source: { href: 'https://example.com/a' } },
    ]).citation.url,
    'https://example.com/a'
  );
  assert.equal(extensionHelper('helpers.citations.isValidIsbn', ['978-0-201-89683-1']), true);
  assert.equal(extensionHelper('helpers.citations.isValidIsbn', ['978-0-201-89683-2']), false);
  assert.equal(extensionHelper('helpers.citations.expandTwoDigitYear', [24, 2026]), 2024);
  assert.equal(extensionHelper('helpers.citations.expandTwoDigitYear', [27, 2026]), 1927);
  assert.throws(
    () => extensionHelper('helpers.citations.expandTwoDigitYear', [100]),
    /Year must be/
  );
  assert.throws(
    () => extensionHelper('helpers.citations.extract', ['**Smith 2024**', []]),
    /References/
  );
  assert.throws(
    () =>
      extensionHelper('helpers.citations.extract', ['**Smith 2024**', { source: { href: 42 } }]),
    /href/
  );
  assert.equal(extensionHelper('helpers.search.fuzzyScore', ['deb', 'debate']), 999.4);
  assert.equal(extensionHelper('helpers.templates.fill', ['{{title}}', 'Case']), 'Case');
  assert.equal(
    extensionHelper('helpers.templates.fill', [
      '{{path}}\n{{properties}}\n{{content}}',
      'Case',
      { path: 'Cards/Case.md', content: '---\nspeech: true\n---\n# Case' },
    ]),
    'Cards/Case.md\nspeech: true\n\n# Case'
  );
  for (const context of [null, [], 'bad', { path: 42 }, { content: false }]) {
    assert.throws(
      () => extensionHelper('helpers.templates.fill', ['', 'Case', context]),
      /Template context|Path|Content/
    );
  }
  assert.ok(extensionHelper('helpers.speech.analyze', ['A short speech.']).spokenWords > 0);
  assert.ok(extensionHelper('helpers.speech.estimate', ['A short speech.', 250]).seconds > 0);
  assert.throws(
    () =>
      extensionHelper('helpers.speech.readingSeconds', [
        { weightedSyllables: 10 },
        250,
        { articulation: NaN, pauses: 1 },
      ]),
    /profile/
  );
  assert.throws(
    () =>
      extensionHelper('helpers.speech.assess', [
        { syllables: 1, weightedSyllables: 1, spokenWords: 1, sentences: 1 },
        0,
      ]),
    /Speaking rate/
  );
  assert.throws(() => extensionHelper('helpers.cards.getAt', [cardMarkdown, -1]), /Offset/);
  assert.throws(() => extensionHelper('helpers.speech.estimate', ['words', 0]), /Speaking rate/);
  const calls = [];
  const sent = [];
  const manifest = {
    id: 'capabilities',
    name: 'Capabilities',
    permissions: ['editor', 'events', 'ui', 'vault:read', 'editor:active-note'],
    contributes: { commands: [], panels: [{ id: 'status', title: 'Status' }], webviews: [] },
  };
  const host = new ExtensionHost(manifest, '', {
    setSelection: (range) => {
      calls.push(range);
      return true;
    },
    getTiptapSnapshot: () => ({ doc: { type: 'doc' }, selection: { from: 1, to: 1 } }),
    runTiptapCommand: (...args) => {
      calls.push(args);
      return true;
    },
    updateSurface: (...args) => calls.push(args.slice(1)),
  });
  host.frame = { contentWindow: { postMessage: (message) => sent.push(message) } };
  assert.equal(await host.handle('editor.setSelection', [{ from: 0, to: 3 }]), true);
  for (const range of [{ from: -1, to: 2 }, { from: 3, to: 2 }, { from: 1.5, to: 2 }, null]) {
    await assert.rejects(host.handle('editor.setSelection', [range]), /Selection/);
  }
  assert.equal((await host.handle('editor.getTiptapSnapshot', [])).doc.type, 'doc');
  await host.handle('editor.runTiptapCommand', ['toggleHeading', { level: 4 }]);
  await assert.rejects(host.handle('editor.runTiptapCommand', ['setContent']), /Unsupported/);
  await assert.rejects(
    host.handle('editor.runTiptapCommand', ['toggleHeading', { level: 9 }]),
    /Heading/
  );
  await assert.rejects(
    host.handle('editor.runTiptapCommand', ['toggleBold', { arbitrary: true }]),
    /options/
  );
  const watch = await host.handle('events.subscribe', ['ext.capabilities.ready']);
  await host.handle('events.emit', ['ext.capabilities.ready', { count: 1 }]);
  assert.deepEqual(sent.at(-1).event, { count: 1 });
  await host.handle('events.unsubscribe', [watch]);
  const count = sent.length;
  applicationEvents.emit('ext.capabilities.ready', {});
  assert.equal(sent.length, count);
  await assert.rejects(host.handle('events.emit', ['editor.ready', {}]), /namespaced/);
  await assert.rejects(host.handle('events.emit', ['ext.other.ready', {}]), /namespaced/);
  await assert.rejects(host.handle('events.subscribe', ['unknown.event']), /Unknown/);
  await host.handle('ui.setHtml', ['panels', 'status', '<p>Hello</p>']);
  await host.handle('ui.show', ['panels', 'status']);
  await assert.rejects(host.handle('ui.show', ['webviews', 'undeclared']), /Undeclared/);
  manifest.permissions = [];
  for (const [method, args] of [
    ['editor.setSelection', [{ from: 0, to: 0 }]],
    ['editor.getTiptapSnapshot', []],
    ['events.subscribe', ['editor.ready']],
    ['ui.show', ['panels', 'status']],
  ]) {
    await assert.rejects(host.handle(method, args), /Permission/);
  }
  manifest.permissions = ['events'];
  await assert.rejects(host.handle('events.subscribe', ['editor.ready']), /Permission "editor"/);
  assert.equal(pathHelper('join', ['Folder', '..', 'Note.md']), 'Note.md');
  assert.equal(pathHelper('basename', ['Folder\\Note.md']), 'Note.md');
  assert.equal(pathHelper('extname', ['.hidden']), '');
  assert.throws(() => pathHelper('normalize', ['../../secret']), /escapes/);
  assert.throws(() => pathHelper('normalize', ['C:\\secret']), /relative/);
  assert.equal(
    markdownToText('# Heading\n\n**Evidence** [source](https://example.com)'),
    'Heading\nEvidence source'
  );
  assert.throws(() => requirePayload('x'.repeat(65537)), /65,536/);
  const bus = createEventBus();
  const payload = { nested: { value: 1 } };
  const stop = bus.on('test', (value) => {
    value.nested.value = 2;
  });
  bus.emit('test', payload);
  assert.equal(payload.nested.value, 1);
  stop();
  await host.handle('events.subscribe', ['ext.capabilities.disposal']);
  const originalWindow = global.window;
  global.window = { removeEventListener() {} };
  host.frame.remove = () => {};
  try {
    host.dispose();
  } finally {
    global.window = originalWindow;
  }
  assert.equal(host.eventWatches.size, 0);
  assert.equal(host.surfaces.size, 0);
  applicationEvents.emit('ext.capabilities.disposal', {});
  assert.equal(sent.length, count);
});

test('utility helpers expose cards, checkup, search, themes and reject unbounded input', async () => {
  const { extensionHelper } = await import('../src/lib/extensionCapabilities.js');
  const cardMarkdown = '#### Climate impact\n\n**Smith 2024** — "Study", https://example.com/a\n';
  const detected = extensionHelper('helpers.cards.detect', [cardMarkdown]);
  assert.equal(detected.length, 1);
  assert.equal(detected[0].title, 'Climate impact');
  assert.equal(
    extensionHelper('helpers.cards.containsEvidence', [cardMarkdown, 'Climate impact']),
    true
  );

  assert.deepEqual(extensionHelper('helpers.checkup.fields', []), [
    'author',
    'year',
    'title',
    'publication',
    'url',
    'accessed',
  ]);
  assert.equal(extensionHelper('helpers.checkup.normalize', [{}]).staleYears, 5);
  const cards = extensionHelper('helpers.checkup.scan', [{ 'a.md': cardMarkdown }]);
  assert.equal(cards.length, 1);
  assert.deepEqual(extensionHelper('helpers.checkup.citedUrls', [cards]), [
    'https://example.com/a',
  ]);
  const issues = extensionHelper('helpers.checkup.audit', [
    cards,
    { checks: { stale: false, links: false } },
    '2026-01-01',
  ]);
  assert.ok(issues.some((issue) => issue.kind === 'missing_fields'));
  assert.deepEqual(extensionHelper('helpers.checkup.linkIssues', [cards, {}]), []);
  assert.deepEqual(extensionHelper('helpers.checkup.sourceIssues', [cards, {}]), []);

  const metadata = extensionHelper('helpers.frontmatter.read', ['---\nname: Test\n---\nBody']);
  assert.equal(metadata.data.name, 'Test');
  assert.ok(metadata.body.includes('Body'));

  const bindings = extensionHelper('helpers.keybindings.all', []);
  assert.ok(Array.isArray(bindings) && bindings.length > 0);
  assert.equal(extensionHelper('helpers.keybindings.binding', [bindings[0].id]), bindings[0].key);
  assert.equal(typeof extensionHelper('helpers.keybindings.reserved', ['Mod+S']), 'boolean');
  const event = { key: 's', code: 'KeyS', ctrlKey: true };
  const shortcut = extensionHelper('helpers.keybindings.event', [event, 'win32']);
  assert.equal(shortcut, 'Mod+S');
  assert.equal(extensionHelper('helpers.keybindings.matches', [event, shortcut, 'win32']), true);
  assert.equal(extensionHelper('helpers.keybindings.editor', ['Mod+B']), 'Mod-b');
  const originalWindow = global.window;
  global.window = { api: { platform: 'win32' } };
  let conflict;
  try {
    conflict = extensionHelper('helpers.keybindings.conflict', [bindings[0].id, 'Mod+Shift+Z']);
  } finally {
    global.window = originalWindow;
  }
  assert.ok(conflict === null || typeof conflict === 'object');

  assert.equal(extensionHelper('helpers.language.languages', []).en, 'English');
  assert.ok(Array.isArray(extensionHelper('helpers.nli.templates', [])));
  assert.ok(Array.isArray(extensionHelper('helpers.layout.ribbonItems', [])));
  assert.ok(Array.isArray(extensionHelper('helpers.layout.defaultRibbonItems', [])));
  assert.ok(Array.isArray(extensionHelper('helpers.layout.fileActions', [])));
  assert.ok(Array.isArray(extensionHelper('helpers.layout.statusItems', [])));

  const parsed = extensionHelper('helpers.search.parse', ['tag:#climate "carbon tax"']);
  assert.deepEqual(parsed.tags, ['climate']);
  assert.deepEqual(parsed.phrases, ['carbon tax']);
  assert.deepEqual(
    Object.keys(
      extensionHelper('helpers.search.filter', [
        { 'a.md': 'carbon tax policy', 'b.md': 'other', 'c.txt': 'carbon tax' },
        { tags: { climate: ['a.md'] } },
        'tag:#climate "carbon tax"',
      ])
    ),
    ['a.md']
  );
  assert.equal(
    extensionHelper('helpers.search.vault', [
      { 'a.md': 'carbon tax policy' },
      { tags: {} },
      'carbon',
    ]).length,
    1
  );
  assert.ok(
    Array.isArray(extensionHelper('helpers.search.excerpt', ['carbon tax policy', ['carbon']]))
  );
  assert.ok(
    Array.isArray(
      extensionHelper('helpers.search.mergeHybrid', [
        [{ path: 'a.md', matches: [] }],
        [{ path: 'b.md', line: 0, text: 'x', score: 1 }],
        10,
      ])
    )
  );
  assert.equal(extensionHelper('helpers.search.candidateLimit', []), 1000);

  const builtin = extensionHelper('helpers.themes.builtin', []);
  assert.ok(Array.isArray(builtin) && builtin.length > 0);
  assert.ok(Array.isArray(extensionHelper('helpers.themes.colorTokens', [])));
  assert.equal(extensionHelper('helpers.themes.validate', [builtin[0]]).name, builtin[0].name);
  assert.equal(
    extensionHelper('helpers.themes.resolveSettings', [builtin[0], {}]).name,
    builtin[0].name
  );
  assert.equal(extensionHelper('helpers.themes.get', ['dark']).name, builtin[0].name);
  assert.ok(Array.isArray(extensionHelper('helpers.themes.extensionThemes', [])));

  assert.equal(extensionHelper('helpers.vault.isJson', ['a.json']), true);
  assert.equal(extensionHelper('helpers.vault.isJson', ['a.md']), false);
  const emptyCanvas = extensionHelper('helpers.canvas.empty', []);
  assert.equal(typeof emptyCanvas, 'string');
  assert.ok(Array.isArray(JSON.parse(emptyCanvas).nodes));

  assert.throws(() => extensionHelper('helpers.cards.detect', ['x'.repeat(100_001)]), /100,?000/);
  assert.throws(
    () => extensionHelper('helpers.keybindings.event', [{ key: 's' }, 'plan9']),
    /platform/i
  );
  assert.throws(() => extensionHelper('helpers.checkup.citedUrls', ['cards']), /array/i);
  assert.throws(() => extensionHelper('helpers.search.filter', [{}, {}, 'x']), /index|tags/i);
  assert.throws(() => extensionHelper('helpers.themes.validate', [{}]), /theme|version|name/i);
});

test('UI contributions require permission, declarations, a script and bounded unique identifiers', () => {
  const { validateManifest } = require('../electron/extensions.cjs');
  const manifest = {
    manifestVersion: 1,
    id: 'ui-test',
    name: 'UI Test',
    version: '1',
    main: 'main.js',
    permissions: ['ui'],
    contributes: {
      panels: [{ id: 'panel', title: 'Panel' }],
      webviews: [{ id: 'details', title: 'Details' }],
    },
  };
  const root = path.join(__dirname, 'fixture');
  assert.equal(validateManifest(manifest, root).contributes.panels[0].id, 'panel');
  assert.throws(() => validateManifest({ ...manifest, permissions: [] }, root), /ui permission/);
  assert.throws(() => validateManifest({ ...manifest, main: undefined }, root), /main script/);
  assert.throws(
    () =>
      validateManifest({ ...manifest, contributes: { panels: [{ title: 'Missing ID' }] } }, root),
    /unique id/
  );
  assert.throws(
    () =>
      validateManifest(
        { ...manifest, contributes: { panels: Array(11).fill({ id: 'panel', title: 'Panel' }) } },
        root
      ),
    /at most 10/
  );
});

test('extension settings have validated types, bounds, defaults and scoped storage', async (t) => {
  const { validateSettingDefinitions, validateSettingValue } =
    await import('../electron/extensionSettings.mjs');
  const { ExtensionHost } = await import('../src/lib/extensions.js');
  const { clearExtensionData, resetExtensionSettings } =
    await import('../src/lib/extensionSettings.js');
  const settings = [
    { id: 'enabled', title: 'Enabled', type: 'boolean', default: true },
    { id: 'limit', title: 'Limit', type: 'number', min: 1, max: 5, default: 3 },
    { id: 'label', title: 'Label', type: 'string', maxLength: 10, default: 'note' },
    { id: 'mode', title: 'Mode', type: 'string', enum: ['brief', 'full'], default: 'brief' },
  ];
  assert.deepEqual(validateSettingDefinitions(settings), settings);
  for (const invalid of [
    null,
    [settings[0], settings[0]],
    [{ ...settings[0], id: undefined }],
    [{ ...settings[0], default: 'true' }],
    [{ ...settings[1], min: 6 }],
    [{ ...settings[2], maxLength: 0 }],
    [{ ...settings[3], enum: ['brief', 'brief'] }],
    [{ ...settings[0], max: 5 }],
    Array(33).fill(settings[0]),
  ]) {
    assert.throws(() => validateSettingDefinitions(invalid));
  }
  for (const [index, value] of [
    [0, 1],
    [1, NaN],
    [1, 6],
    [2, 'x'.repeat(11)],
    [3, 'other'],
  ]) {
    assert.throws(() => validateSettingValue(settings[index], value), /Invalid value/);
  }
  const original = { localStorage: global.localStorage, window: global.window };
  const storage = new Map();
  global.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  };
  global.window = { dispatchEvent() {} };
  t.after(() => {
    global.localStorage = original.localStorage;
    global.window = original.window;
  });
  const manifest = { id: 'typed', permissions: [], contributes: { settings } };
  const host = new ExtensionHost(manifest, '', {});
  await assert.rejects(host.handle('settings.get', ['enabled']), /Permission/);
  await assert.rejects(host.handle('settings.set', ['enabled', false]), /Permission/);
  manifest.permissions.push('settings');
  assert.equal(await host.handle('settings.get', ['enabled']), true);
  const denied = new ExtensionHost(manifest, '', {}, undefined, false, []);
  await assert.rejects(denied.handle('settings.get', ['enabled']), /not allowed/);
  await host.handle('settings.set', ['enabled', false]);
  assert.equal(await host.handle('settings.get', ['enabled']), false);
  await assert.rejects(host.handle('settings.set', ['limit', '4']), /Invalid value/);
  await assert.rejects(host.handle('settings.get', ['theme']), /not declared/);
  const other = new ExtensionHost({ ...manifest, id: 'other' }, '', {});
  assert.equal(await other.handle('settings.get', ['enabled']), true);
  storage.set('tagline-extension-settings:typed', '{invalid');
  assert.equal(
    await host.handle('settings.get', ['enabled']),
    true,
    'malformed settings reset to defaults'
  );
  assert.equal(
    storage.has('tagline-extension-settings:typed'),
    false,
    'only the corrupt entry is removed'
  );
  resetExtensionSettings(manifest);
  assert.equal(await host.handle('settings.get', ['enabled']), true);
  storage.set('tagline-extension-settings:typed', '{"enabled":false}');
  storage.set('tagline-extension:typed', '{"private":"value"}');
  clearExtensionData(manifest);
  assert.equal(storage.has('tagline-extension-settings:typed'), false);
  assert.equal(storage.has('tagline-extension:typed'), false);
});

test('active-note events are path-only, separately permissioned, bounded and disposable', async (t) => {
  const { ExtensionHost } = await import('../src/lib/extensions.js');
  const manifest = { id: 'events', permissions: ['editor'], contributes: { commands: [] } };
  const callbacks = new Set();
  const bridge = {
    watchActiveNote: (listener) => {
      callbacks.add(listener);
      return () => callbacks.delete(listener);
    },
  };
  const host = new ExtensionHost(manifest, '', bridge);
  const messages = [];
  host.frame = { contentWindow: { postMessage: (message) => messages.push(message) }, remove() {} };
  await assert.rejects(host.handle('editor.watchActiveNote', []), /editor:active-note/);
  manifest.permissions = ['editor:active-note'];
  await assert.rejects(host.handle('editor.getActiveNote', []), /Permission "editor"/);
  const id = await host.handle('editor.watchActiveNote', []);
  callbacks.forEach((callback) =>
    callback({ path: 'Card.md', content: 'not exposed', selection: 'private' })
  );
  callbacks.forEach((callback) => callback({ path: null }));
  assert.deepEqual(messages, [
    { type: 'active-note-event', id, event: { path: 'Card.md' } },
    { type: 'active-note-event', id, event: { path: null } },
  ]);
  assert.equal(await host.handle('editor.unwatchActiveNote', [id]), true);
  assert.equal(callbacks.size, 0);
  for (let i = 0; i < 32; i++) {
    await host.handle('editor.watchActiveNote', []);
  }
  await assert.rejects(host.handle('editor.watchActiveNote', []), /32 active-note/);
  const original = global.window;
  global.window = { removeEventListener() {} };
  t.after(() => {
    global.window = original;
  });
  host.dispose();
  assert.equal(callbacks.size, 0);
});

test('platform: settings and event permission changes require a fresh manifest review', async () => {
  const fsAsync = require('node:fs/promises');
  const { registerExtensions, validateManifest } = require('../electron/extensions.cjs');
  const root = await fsAsync.mkdtemp(path.join(require('node:os').tmpdir(), 'tagline-review-'));
  try {
    const folder = path.join(root, 'extensions', 'review');
    await fsAsync.mkdir(folder, { recursive: true });
    const manifest = {
      manifestVersion: 1,
      id: 'review',
      name: 'Review',
      version: '1',
      main: 'main.js',
      permissions: ['settings', 'editor:active-note'],
      contributes: { settings: [{ id: 'label', title: 'Label', type: 'string', default: 'x' }] },
    };
    assert.throws(
      () => validateManifest({ ...manifest, permissions: [] }, folder),
      /requires the settings permission/
    );
    const file = path.join(folder, 'manifest.json');
    await fsAsync.writeFile(file, JSON.stringify(manifest));
    await fsAsync.writeFile(path.join(folder, 'main.js'), 'void 0;');
    let config = { enabledExtensions: ['review'] };
    const handlers = {};
    registerExtensions({
      app: { getPath: () => root },
      shell: {},
      ipcMain: {
        handle: (name, fn) => {
          handlers[name] = fn;
        },
      },
      readConfig: () => config,
      writeConfig: (patch) => {
        config = { ...config, ...patch };
      },
    });
    const [item] = await handlers['extensions:list']();
    assert.equal(item.enabled, false);
    assert.equal(item.reviewRequired, true);
    assert.deepEqual(item.allowedPermissions, manifest.permissions);
    await assert.rejects(
      handlers['extensions:setPermissions'](null, 'review', ['vault:write'], item.reviewToken),
      /permissions changed/
    );
    await handlers['extensions:setPermissions'](
      null,
      'review',
      ['editor:active-note'],
      item.reviewToken
    );
    assert.deepEqual((await handlers['extensions:list']())[0].allowedPermissions, [
      'editor:active-note',
    ]);
    await assert.rejects(handlers['extensions:load'](null, 'review'), /disabled/);
    await assert.rejects(
      handlers['extensions:setEnabled'](null, 'review', true),
      /Reload and review/
    );
    await handlers['extensions:setEnabled'](null, 'review', true, item.reviewToken);
    assert.equal((await handlers['extensions:list']())[0].enabled, true);
    const firstLoad = await handlers['extensions:load'](null, 'review');
    assert.equal(firstLoad.firstInstall, true);
    const retry = await handlers['extensions:load'](null, 'review');
    assert.notEqual(retry.installToken, firstLoad.installToken);
    await assert.rejects(
      handlers['extensions:completeInstall'](null, 'review', firstLoad.installToken),
      /Stale/
    );
    await handlers['extensions:setEnabled'](null, 'review', false);
    await assert.rejects(
      handlers['extensions:completeInstall'](null, 'review', retry.installToken),
      /Stale/
    );
    await handlers['extensions:setEnabled'](null, 'review', true, item.reviewToken);
    const activeLoad = await handlers['extensions:load'](null, 'review');
    assert.equal(activeLoad.firstInstall, true, 'incomplete setup retries');
    await handlers['extensions:completeInstall'](null, 'review', activeLoad.installToken);
    assert.deepEqual(config.initializedExtensions, ['review']);
    await assert.rejects(
      handlers['extensions:completeInstall'](null, 'review', activeLoad.installToken),
      /Stale/
    );
    assert.equal((await handlers['extensions:load'](null, 'review')).firstInstall, false);
    manifest.contributes.settings[0].default = 'changed';
    await fsAsync.writeFile(file, JSON.stringify(manifest));
    assert.equal((await handlers['extensions:list']())[0].reviewRequired, true);
    await assert.rejects(
      handlers['extensions:setEnabled'](null, 'review', true, item.reviewToken),
      /Reload and review/
    );
    const [changed] = await handlers['extensions:list']();
    await handlers['extensions:setEnabled'](null, 'review', true, changed.reviewToken);
    assert.equal((await handlers['extensions:load'](null, 'review')).source, 'void 0;');
    assert.equal(
      (await handlers['extensions:load'](null, 'review')).installToken,
      null,
      'manifest updates do not repeat successful setup'
    );
    manifest.permissions.push('vault:write');
    await fsAsync.writeFile(file, JSON.stringify(manifest));
    const updated = (await handlers['extensions:list']())[0];
    assert.equal(updated.enabled, false);
    assert.deepEqual(updated.allowedPermissions, ['editor:active-note']);
  } finally {
    await fsAsync.rm(root, { recursive: true, force: true });
  }
});

test('platform: extensions can be uninstalled and their saved grants are cleared', async () => {
  const fsAsync = require('node:fs/promises');
  const { registerExtensions } = require('../electron/extensions.cjs');
  const root = await fsAsync.mkdtemp(path.join(require('node:os').tmpdir(), 'tagline-uninstall-'));
  try {
    const folder = path.join(root, 'extensions', 'remove-me');
    await fsAsync.mkdir(folder, { recursive: true });
    await fsAsync.writeFile(
      path.join(folder, 'manifest.json'),
      JSON.stringify({
        manifestVersion: 1,
        id: 'remove-me',
        name: 'Remove Me',
        version: '1',
        permissions: ['editor'],
      })
    );
    let config = {
      enabledExtensions: ['remove-me'],
      extensionReviews: { 'remove-me': 'review' },
      extensionPermissions: { 'remove-me': ['editor'] },
      initializedExtensions: ['remove-me'],
    };
    const handlers = {};
    registerExtensions({
      app: { getPath: () => root },
      shell: {},
      ipcMain: {
        handle: (name, fn) => {
          handlers[name] = fn;
        },
      },
      readConfig: () => config,
      writeConfig: (patch) => {
        config = { ...config, ...patch };
      },
    });
    const secretFile = path.join(root, 'extension-secrets', 'remove-me.bin');
    await fsAsync.mkdir(path.dirname(secretFile), { recursive: true });
    await fsAsync.writeFile(secretFile, 'encrypted extension secret');
    await handlers['extensions:uninstall'](null, 'remove-me');
    await assert.rejects(fsAsync.stat(folder), { code: 'ENOENT' });
    await assert.rejects(fsAsync.stat(secretFile), { code: 'ENOENT' });
    assert.deepEqual(config.enabledExtensions, []);
    assert.deepEqual(config.extensionReviews, {});
    assert.deepEqual(config.extensionPermissions, {});
    assert.deepEqual(config.initializedExtensions, []);
    await assert.rejects(handlers['extensions:uninstall'](null, '../remove-me'), /Invalid/);
  } finally {
    await fsAsync.rm(root, { recursive: true, force: true });
  }
});

test('extension vault mutation and watch APIs enforce permissions and clean up subscriptions', async () => {
  const { ExtensionHost } = await import('../src/lib/extensions.js');
  const manifest = { id: 'test', name: 'Test', permissions: [], contributes: { commands: [] } };
  let subscriptions = 0;
  const bridge = {
    append: async () => 'Card.md',
    delete: async () => true,
    rename: async () => 'Renamed.md',
    flush: async () => true,
    compareAndSwap: async () => false,
    watch: () => {
      subscriptions++;
      return () => {
        subscriptions--;
      };
    },
  };
  const host = new ExtensionHost(manifest, '', bridge);
  const calls = [
    ['vault.append', ['Card.md', 'text']],
    ['vault.delete', ['Card.md']],
    ['vault.rename', ['Card.md', 'Renamed.md']],
    ['vault.flush', []],
    ['vault.compareAndSwap', ['Card.md', 'old', 'new']],
    ['vault.watch', []],
  ];
  for (const [method, args] of calls) {
    await assert.rejects(host.handle(method, args), /Permission/);
  }
  manifest.permissions = ['vault:write'];
  await assert.rejects(host.handle('vault.append', ['Card.md', 'text']), /vault:read/);
  await assert.rejects(
    host.handle('vault.compareAndSwap', ['Card.md', 'old', 'new']),
    /vault:read/
  );
  manifest.permissions.push('vault:read');
  for (const [method, args] of calls.slice(0, -1)) {
    await host.handle(method, args);
  }
  await assert.rejects(
    host.handle('vault.compareAndSwap', ['Card.md', null, 'new']),
    /Expected content/
  );
  const id = await host.handle('vault.watch', []);
  assert.equal(subscriptions, 1);
  assert.equal(await host.handle('vault.unwatch', [id]), true);
  assert.equal(await host.handle('vault.unwatch', [id]), false);
  for (let i = 0; i < 32; i++) {
    await host.handle('vault.watch', []);
  }
  await assert.rejects(host.handle('vault.watch', []), /32 vault watches/);
  // Disposal's DOM listener removal is tested in the Electron suite; check its subscription cleanup here.
  const original = global.window;
  global.window = { removeEventListener() {} };
  try {
    host.dispose();
  } finally {
    global.window = original;
  }
  assert.equal(subscriptions, 0);
});
