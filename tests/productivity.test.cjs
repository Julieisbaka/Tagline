const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMetadata, publicAddress, validateUrl, extractCitation } = require('../electron/citationMetadata.cjs');

test('citation autofill reads JSON-LD graphs, repeated authors, entities and meta fallbacks', () => {
  const fields = parseMetadata(`
    <script type="application/ld+json">invalid JSON</script>
    <script type="application/ld+json">{"@graph":[{"@type":["NewsArticle"],
      "headline":"Climate &amp; Energy","author":[{"name":"Jane Smith"},{"name":"John Doe"}],
      "datePublished":"2025-01-20","publisher":{"name":"Reuters"}}]}</script>
    <meta content='Ignored title' property='og:title'>
  `, 'https://www.reuters.com/world/story-2024-01-01/');
  assert.deepEqual(fields, { author: 'Jane Smith, John Doe', title: 'Climate & Energy',
    year: '2025', publication: 'Reuters', url: 'https://www.reuters.com/world/story-2024-01-01/' });
  const fallback = parseMetadata(`<meta name="byl" content="By Jane Smith">
    <meta property="og:title" content="Research &#x2014; explained">`, 'https://www.nytimes.com/2024/05/03/science/research.html');
  assert.equal(fallback.author, 'Jane Smith');
  assert.equal(fallback.year, '2024');
  assert.equal(fallback.publication, 'The New York Times');
  assert.equal(fallback.title, 'Research \u2014 explained');
  const reuters = parseMetadata('<title>Article</title>', 'https://reuters.com/world/article-2023-06-10/');
  assert.equal(reuters.year, '2023');
  assert.equal(parseMetadata('<title>Unknown</title>', 'https://example.com/2020/archive').year, '');

  const primaryArticle = parseMetadata(`
    <link rel="canonical" href="https://example.com/story/">
    <script type="application/ld+json">${JSON.stringify({ '@graph': [
    { '@type': 'NewsArticle', headline: 'Sponsored placement', author: { name: 'Ad Writer' } },
    { '@type': 'https://schema.org/NewsArticle', url: 'https://example.com/story/',
      headline: 'Actual story &amp; analysis', author: { givenName: 'Ada', familyName: 'Lovelace' },
      datePublished: '2024-04-11', publisher: { name: 'Example Journal' } },
    ] })}</script>
  `, 'https://example.com/story/?utm_source=feed');
  assert.equal(primaryArticle.title, 'Actual story & analysis');
  assert.equal(primaryArticle.author, 'Ada Lovelace');
  assert.equal(primaryArticle.publication, 'Example Journal');
  assert.equal(primaryArticle.year, '2024');

  const repeatedAuthors = parseMetadata(`
    <meta name="citation_author" content="Jane Smith">
    <meta name="citation_author" content="John Doe">
    <meta name="dc.title" content="A cited research paper">
    <meta name="dcterms.issued" content="2022-08-14">
  `, 'https://example.com/paper');
  assert.equal(repeatedAuthors.author, 'Jane Smith, John Doe');
  assert.equal(repeatedAuthors.title, 'A cited research paper');
  assert.equal(repeatedAuthors.year, '2022');
});

test('citation URLs reject local networks, credentials and non-web schemes', async () => {
  for (const address of ['127.0.0.1', '10.2.3.4', '172.20.1.2', '192.168.1.1', '169.254.169.254',
    '100.64.1.2', '::1', '::ffff:127.0.0.1', 'fc00::1', '2001:db8::1']) assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress('8.8.8.8'), true);
  assert.equal(publicAddress('2606:4700:4700::1111'), true);
  for (const url of ['file:///secret', 'https://localhost/a', 'http://127.0.0.1', 'http://[::1]',
    'https://user:password@example.com', 'https://example.com:8080']) assert.throws(() => validateUrl(url));
  await assert.rejects(extractCitation('http://127.0.0.1'), /private network/);
});

test('citation URL rules extract fields for common sites without fetching', () => {
  const { parseUrl } = require('../electron/citationMetadata.cjs');
  const cases = [
    ['https://www.theguardian.com/environment/2023/jun/14/carbon-tax-plan-explained', { year: '2023', title: 'Carbon tax plan explained', publication: 'The Guardian' }],
    ['https://www.reuters.com/world/us/senate-passes-aid-bill-2024-02-13/', { year: '2024', title: 'Senate passes aid bill', publication: 'Reuters' }],
    ['https://en.wikipedia.org/wiki/Nuclear_deterrence', { year: '', title: 'Nuclear deterrence', publication: 'Wikipedia' }],
    ['https://arxiv.org/abs/2106.09685', { year: '2021', title: '', publication: 'arXiv' }],
    ['https://www.congress.gov/bill/118th-congress/house-bill/2/text', { year: '', title: 'House Bill 2 (118th Congress)', publication: 'Congress.gov' }],
    ['https://doi.org/10.1038/s41586-020-2649-2', { year: '', title: 'doi:10.1038/s41586-020-2649-2', publication: '' }],
    ['https://www.foreignaffairs.com/articles/china/2022-08-01/taiwan-strategy', { year: '2022', title: 'Taiwan strategy', publication: 'Foreign Affairs' }],
  ];
  for (const [url, expected] of cases) {
    const { year, title, publication } = parseUrl(url);
    assert.deepEqual({ year, title, publication }, expected, url);
  }
  // Unknown sites do not guess titles from arbitrary slugs.
  assert.equal(parseUrl('https://example.com/some-random-page').title, '');
  // Page metadata wins over URL-derived values.
  const page = parseMetadata('<meta property="og:title" content="Real headline">', 'https://www.theguardian.com/world/2023/jun/14/slug-title');
  assert.equal(page.title, 'Real headline');
  assert.equal(page.year, '2023');
});

test('citation transport pins public DNS results and handles redirects, errors and size limits', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const { EventEmitter } = require('node:events');
  let address = '93.184.215.14';
  let route = 'success';
  const requests = [];
  const module = { exports: {} };
  const client = { get(url, options, callback) {
    requests.push(new URL(url.href || url));
    const crossref = url.hostname === 'api.crossref.org';
    const request = new EventEmitter();
    request.destroy = (error) => { request.emit('error', error); request.emit('close'); };
    process.nextTick(() => options.lookup(url.hostname, { all: true }, (error, addresses) => {
      if (error) return request.destroy(error);
      assert.equal(addresses[0].address, address);
      const response = new EventEmitter();
      response.statusCode = route === 'redirect' ? 302 : route === 'denied' ? 403 : 200;
      response.headers = {
        'content-type': crossref ? 'application/json; charset=utf-8' : 'text/html',
        location: 'http://127.0.0.1/private',
      };
      response.resume = () => request.emit('close');
      callback(response);
      if (response.statusCode !== 200) return;
      const body = crossref
        ? JSON.stringify({ status: 'ok', message: {
          title: ['Public metadata title'], author: [{ given: 'Ada', family: 'Lovelace' }],
          issued: { 'date-parts': [[2024, 3, 5]] }, 'container-title': ['Journal of Scholarly Metadata'],
        } })
        : route === 'large' ? 'a'.repeat(2_000_001)
          : '<meta name="author" content="A Writer"><meta property="og:title" content="Example story">';
      response.emit('data', Buffer.from(body));
      response.emit('end');
      request.emit('close');
    }));
    return request;
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'electron', 'citationMetadata.cjs'), 'utf8'), {
    module, URL, Buffer, setTimeout, clearTimeout,
    require: (name) => ['node:http', 'node:https'].includes(name) ? client
      : name === 'node:dns' ? { lookup: (_host, _options, cb) => cb(null, [{ address, family: 4 }]) } : require(name),
  });
  const extract = () => module.exports.extractCitation('https://example.com/article');
  assert.equal((await extract()).author, 'A Writer');
  address = '127.0.0.1';
  await assert.rejects(extract(), /private network/);
  address = '93.184.215.14';
  route = 'redirect';
  await assert.rejects(extract(), /private network/);
  route = 'denied';
  await assert.rejects(extract(), /HTTP 403/);
  // Known sites fall back to URL rules when the publisher blocks the request.
  const blocked = await module.exports.extractCitation('https://www.nytimes.com/2024/03/05/us/politics/border-deal-vote.html');
  assert.deepEqual({ ...blocked }, { author: '', title: 'Border deal vote', year: '2024',
    publication: 'The New York Times', url: 'https://www.nytimes.com/2024/03/05/us/politics/border-deal-vote.html' });
  route = 'crossref';
  const doiCitation = await module.exports.extractCitation('https://doi.org/10.5555/example.2024');
  assert.deepEqual({ ...doiCitation }, {
    author: 'Ada Lovelace', title: 'Public metadata title', year: '2024',
    publication: 'Journal of Scholarly Metadata', url: 'https://doi.org/10.5555/example.2024',
  });
  assert.equal(requests.at(-1).hostname, 'api.crossref.org');
  route = 'large';
  await assert.rejects(extract(), /too large/);
});

test('configurable shortcuts support platform modifiers, conflicts, clearing and editor syntax', async () => {
  global.window = { api: { platform: 'win32' } };
  const { binding, displayBinding, matchesBinding, bindingConflict, editorBinding, eventBinding, reservedBinding, validBinding } =
    await import('../src/lib/keybindings.js');
  assert.equal(binding('new-note'), 'Mod+N');
  assert.equal(binding('new-note', { 'new-note': '' }), '');
  assert.equal(displayBinding('Mod+Shift+N', 'darwin'), 'Cmd+Shift+N');
  const event = { key: 'n', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false };
  assert.equal(matchesBinding(event, 'Mod+Shift+N', 'win32'), true);
  assert.equal(matchesBinding(event, 'Mod+Shift+N', 'darwin'), false);
  assert.equal(matchesBinding({ ...event, ctrlKey: false, metaKey: true }, 'Mod+Shift+N', 'darwin'), true);
  assert.equal(matchesBinding({ ...event, shiftKey: false }, 'Mod+Shift+N', 'win32'), false);
  assert.equal(bindingConflict('new-note', 'Mod+O', {}).id, 'switcher');
  assert.equal(bindingConflict('new-note', '', {}), null);
  assert.equal(editorBinding('Mod+Shift+N'), 'Mod-Shift-n');
  assert.equal(eventBinding({ key: 'Control' }, 'win32'), '');
  assert.equal(validBinding('Mod+Shift+L'), true);
  assert.equal(validBinding('Mod++'), false);
  assert.equal(reservedBinding('Mod+C'), true);
  assert.equal(reservedBinding('Mod+Shift+L'), false);
});

test('intermediate empty highlight delimiters do not crash read-time statistics', async () => {
  const { cardStats } = await import('../src/lib/card.js');
  assert.equal(cardStats('====').highlighted, 0);
});

test('OS flow opens handle cold starts, second instances, macOS events and vault selection', async () => {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const os = require('node:os');
  const { EventEmitter } = require('node:events');
  const { registerFlowFiles, flowArguments } = require('../electron/flowFiles.cjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-flow-test-'));
  try {
    const file = path.join(root, 'Round with spaces.flow');
    await fs.writeFile(file, '{"version":1,"sheets":[]}');
    const app = new EventEmitter();
    app.requestSingleInstanceLock = () => true;
    app.isReady = () => true;
    const handlers = {};
    let current = null;
    let focused = 0;
    const win = { isDestroyed: () => false, isMinimized: () => false, show() {},
      focus: () => focused++, webContents: { send() {} } };
    registerFlowFiles({ app, ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
      getWindow: () => win, createWindow() {}, getVaultRoot: () => current,
      openVault: async (dir) => { current = dir; return { root: dir, name: path.basename(dir) }; },
      argv: ['tagline.exe', file, 'relative.flow', path.join(root, 'not-md.md')] });
    assert.deepEqual(flowArguments([file, '--other', 'relative.flow']), [file]);
    assert.equal(handlers['flow:pending'](), file);
    let result = await handlers['flow:open'](null, file);
    assert.equal(result.path, 'Round with spaces.flow');
    assert.equal(result.vault.root, root);
    assert.equal(handlers['flow:pending'](), null);
    await assert.rejects(handlers['flow:open'](null, file), /not requested/);
    app.emit('second-instance', {}, ['tagline', file]);
    assert.equal(handlers['flow:pending'](), file);
    result = await handlers['flow:open'](null, file);
    assert.equal(result.vault.root, root);
    let prevented = false;
    app.emit('open-file', { preventDefault: () => { prevented = true; } }, file);
    assert.equal(prevented, true);
    assert.equal(handlers['flow:pending'](), file);
    assert.ok(focused >= 3);
    let quit = false;
    const secondary = { requestSingleInstanceLock: () => false, quit: () => { quit = true; } };
    assert.equal(registerFlowFiles({ app: secondary }), false);
    assert.equal(quit, true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('extension manifests validate ids, permissions, commands and contained file paths', async () => {
  const path = require('node:path');
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const { validateManifest, registerExtensions } = require('../electron/extensions.cjs');
  const root = path.join(os.tmpdir(), 'tagline-ext');
  const base = { manifestVersion: 1, id: 'word-tools', name: 'Word tools', version: '1.0.0' };
  const ok = validateManifest({ ...base, main: 'main.js', permissions: ['editor', 'editor'],
    contributes: { commands: [{ id: 'count', title: ' Count ', key: 'Mod+Alt+K' }], themes: ['themes/a.json'] } }, root);
  assert.deepEqual(ok.permissions, ['editor']);
  assert.deepEqual(ok.contributes.commands, [{ id: 'count', title: 'Count', key: 'Mod+Alt+K' }]);
  assert.throws(() => validateManifest({ ...base, manifestVersion: 2 }, root), /manifestVersion/);
  assert.throws(() => validateManifest({ ...base, id: 'Bad_Id' }, root), /id must be/);
  assert.throws(() => validateManifest({ ...base, permissions: ['network'] }, root), /permissions/);
  assert.throws(() => validateManifest({ ...base, contributes: { commands: [{ id: 'go', title: 'Go' }] } }, root), /main script/);
  assert.throws(() => validateManifest({ ...base, main: '../escape.js' }, root), /escapes/);
  assert.throws(() => validateManifest({ ...base, main: path.resolve(root, 'abs.js') }, root), /relative/);
  assert.throws(() => validateManifest({ ...base, contributes: { themes: ['theme.css'] } }, root), /relative \.json/);
  assert.throws(() => validateManifest({ ...base, main: 'a.js', contributes: { commands: [{ id: 'go', title: 'Go' }, { id: 'go', title: 'Again' }] } }, root), /unique/);

  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-ext-test-'));
  const write = async (folder, manifest, files = {}) => {
    await fs.mkdir(path.join(userData, 'extensions', folder), { recursive: true });
    await fs.writeFile(path.join(userData, 'extensions', folder, 'manifest.json'), JSON.stringify(manifest));
    for (const [name, text] of Object.entries(files)) await fs.writeFile(path.join(userData, 'extensions', folder, name), text);
  };
  await write('a', { ...base, main: 'main.js', contributes: { commands: [{ id: 'count', title: 'Count' }] } }, { 'main.js': 'void 0;' });
  await write('b', base);
  await write('c', { ...base, id: 'broken' }, {});
  await fs.writeFile(path.join(userData, 'extensions', 'c', 'manifest.json'), '{ not json');
  let config = {};
  const handlers = {};
  registerExtensions({
    app: { getPath: () => userData }, shell: { openPath: async () => '' },
    ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
    readConfig: () => config, writeConfig: (patch) => { config = { ...config, ...patch }; },
  });
  const list = await handlers['extensions:list']();
  assert.equal(list.length, 3);
  assert.equal(list.some((item) => 'root' in item), false);
  assert.match(list.find((item) => item.folder === 'b').error, /Duplicate/);
  assert.equal(list.find((item) => item.folder === 'c').id, null);
  await assert.rejects(handlers['extensions:load'](null, 'word-tools'), /disabled/);
  await assert.rejects(handlers['extensions:setEnabled'](null, '../x', true), /Invalid/);
  await handlers['extensions:setEnabled'](null, 'word-tools', true);
  assert.deepEqual(config.enabledExtensions, ['word-tools']);
  assert.deepEqual(await handlers['extensions:load'](null, 'word-tools'), {
    source: 'void 0;', themes: [], limits: (await import('../electron/customization.mjs')).DEFAULT_LIMITS,
  });
  await fs.rm(userData, { recursive: true, force: true });
});

test('extension default shortcuts never shadow built-ins and .flow labels follow the setting', async () => {
  global.window = { api: { platform: 'win32' }, addEventListener() {}, dispatchEvent() {} };
  const { usableDefaultKey, extensionCommandId } = await import('../src/lib/extensions.js');
  const { displayName } = await import('../src/lib/vault.js');
  assert.equal(extensionCommandId('word-tools', 'count'), 'ext:word-tools.count');
  assert.equal(usableDefaultKey('Mod+Alt+K'), 'Mod+Alt+K');
  assert.equal(usableDefaultKey('Mod+N'), '');
  assert.equal(usableDefaultKey('Mod+C'), '');
  assert.equal(usableDefaultKey('Mod++'), '');
  assert.equal(usableDefaultKey('Mod+Alt+K', [{ key: 'Mod+Alt+K' }]), '');
  assert.equal(displayName('Rounds/Round 1.flow'), 'Round 1');
  assert.equal(displayName('Rounds/Round 1.flow', false), 'Round 1.flow');
  assert.equal(displayName('Cases/Aff.md', false), 'Aff');
});
