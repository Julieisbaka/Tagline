const { test } = require('node:test');
const assert = require('node:assert/strict');

test('native UI is opt-in, follows light/dark mode and validates application-only requests', async () => {
  const { registerNativeUi } = require('../electron/nativeUi.cjs');
  const handlers = {};
  const nativeTheme = { themeSource: 'system' };
  const mainFrame = {};
  const webContents = { mainFrame };
  const win = { webContents };
  const event = { sender: webContents, senderFrame: mainFrame };
  let menuItems, confirmOptions;
  let answer = 1, selection = 0;
  registerNativeUi({
    ipcMain: { handle: (name, handler) => { handlers[name] = handler; } },
    nativeTheme, getWindow: () => win,
    Menu: { buildFromTemplate: (items) => {
      menuItems = items;
      return { popup: ({ callback }) => { if (selection !== null) items[selection].click(); callback(); } };
    } },
    dialog: { showMessageBox: async (_win, options) => { confirmOptions = options; return { response: answer }; } },
  });
  const preferences = handlers['app:setNativeUi'];
  const contextMenu = handlers['app:nativeContextMenu'];
  const confirm = handlers['app:nativeConfirm'];
  assert.throws(() => contextMenu(event, []), /disabled/);
  assert.throws(() => preferences({ ...event, senderFrame: {} }, { enabled: true, mode: 'dark' }), /only available/);
  assert.throws(() => preferences(event, { enabled: true, mode: 'invalid' }), /Invalid/);
  preferences(event, { enabled: true, mode: 'dark' });
  assert.equal(nativeTheme.themeSource, 'dark');
  assert.equal(await contextMenu(event, [{ label: 'Copy', disabled: false }, { label: 'Cut', disabled: true }]), 0);
  assert.equal(menuItems[1].enabled, false);
  selection = null;
  assert.equal(await contextMenu(event, [{ label: 'Copy', disabled: false }]), null);
  assert.throws(() => contextMenu(event, [{ label: 'Copy', disabled: 'no' }]), /Invalid/);
  const options = { message: 'Delete this?', title: 'Confirm', cancel: 'Cancel', confirm: 'Confirm' };
  assert.equal(await confirm(event, options), true);
  assert.equal(confirmOptions.defaultId, 0);
  assert.equal(confirmOptions.cancelId, 0);
  answer = 0;
  assert.equal(await confirm(event, options), false);
  preferences(event, { enabled: true, mode: 'light' });
  assert.equal(nativeTheme.themeSource, 'light');
  preferences(event, { enabled: false, mode: 'dark' });
  assert.equal(nativeTheme.themeSource, 'system');
  await assert.rejects(confirm(event, options), /disabled/);
  const defaults = require('../src/lib/defaultSettings.json');
  assert.equal(defaults.nativeUi, false);
  assert.equal(defaults.sourceSelectionMatches, true);
});

test('cache limits trim immediately, enforce character budgets, and allow disabling', async () => {
  const { configureVisualCache, cacheDocument, cachedDocument } = await import('../src/lib/visualCache.js');
  const json = { type: 'doc', content: [] };
  configureVisualCache(2, 1000);
  cacheDocument('a', json); cacheDocument('b', json);
  cachedDocument('a');
  cacheDocument('c', json);
  assert.equal(cachedDocument('b'), null);
  assert.deepEqual(cachedDocument('a'), json);
  configureVisualCache(1, 1000);
  assert.equal(cachedDocument('c'), null);
  configureVisualCache(1, 1);
  assert.equal(cachedDocument('a'), null);
  cacheDocument('large', json);
  assert.equal(cachedDocument('large'), null);
  configureVisualCache(0, 1000);
  cacheDocument('disabled', json);
  assert.equal(cachedDocument('disabled'), null);
  assert.throws(() => configureVisualCache(-1, 0));
  configureVisualCache(16, 4_000_000);
});

test('JSON defaults define settings and independent file-extension labels', async () => {
  const defaults = require('../src/lib/defaultSettings.json');
  const { displayName } = await import('../src/lib/vault.js');
  assert.equal(defaults.showMarkdownExtension, false);
  assert.equal(defaults.autoRelink, true);
  assert.equal(defaults.closeMissingTabs, true);
  assert.equal(defaults.persistWorkspaceTabs, true);
  assert.equal(defaults.customCssEnabled, false);
  assert.equal(defaults.customCss, '');
  for (const hideFlow of [false, true]) {
    assert.equal(displayName('Folder/Note.md', hideFlow, false), 'Note');
    assert.equal(displayName('Folder/Note.md', hideFlow, true), 'Note.md');
    assert.equal(displayName('Folder/Note.MD', hideFlow, true), 'Note.MD');
  }
  for (const showMarkdown of [false, true]) {
    assert.equal(displayName('Folder/Round.flow', true, showMarkdown), 'Round');
    assert.equal(displayName('Folder/Round.flow', false, showMarkdown), 'Round.flow');
  }
  const fs = require('node:fs');
  const path = require('node:path');
  const settingsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'settings.js'), 'utf8');
  const cacheSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'visualCache.js'), 'utf8');
  assert.match(settingsSource, /defaultSettings\.json/);
  assert.match(cacheSource, /defaults\.visualCacheEntries/);
  assert.match(cacheSource, /defaults\.visualCacheCharacters/);
});

test('platform: credentials await async availability, encrypt/decrypt asynchronously and reject unavailable storage', async (t) => {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const { EventEmitter } = require('node:events');
  const root = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'tagline-async-token-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const requests = [];
  class Worker extends EventEmitter {
    postMessage(message) {
      requests.push(message);
      setImmediate(() => this.emit('message', { id: message.id, result: { ready: true } }));
    }
    terminate() { }
  }
  const module = { exports: {} };
  const dirname = path.join(__dirname, '..', 'electron');
  require('node:vm').runInNewContext(await fs.readFile(path.join(dirname, 'embeddings.cjs'), 'utf8'), {
    module, __dirname: dirname, console,
    require: (name) => name === 'node:worker_threads' ? { Worker } : require(name),
  });
  const app = new EventEmitter();
  app.getPath = () => root;
  let available = false;
  let decrypted = false;
  const handlers = {};
  module.exports.registerEmbeddings({
    app, ipcMain: { handle: (name, handler) => { handlers[name] = handler; } },
    safeStorage: {
      isAsyncEncryptionAvailable: async () => { await new Promise((resolve) => setImmediate(resolve)); return available; },
      encryptStringAsync: async (text) => Buffer.from(Buffer.from(text).toString('hex')),
      decryptStringAsync: async (buffer) => {
        decrypted = true;
        return { result: Buffer.from(buffer.toString(), 'hex').toString(), shouldReEncrypt: false };
      },
    },
    getVaultRoot: () => root, readConfig: () => ({ modelAutoload: false }), writeConfig() { },
  });
  t.after(() => app.emit('before-quit'));
  const call = (name, ...args) => handlers[`embeddings:${name}`](null, ...args);
  assert.equal((await call('status')).encryptionAvailable, false);
  await assert.rejects(call('token', 'hf_TestOnly123'), /unavailable/);
  const tokenFile = path.join(root, 'semantic-search', 'huggingface-token.bin');
  await assert.rejects(fs.access(tokenFile), { code: 'ENOENT' });
  available = true;
  assert.equal((await call('status')).encryptionAvailable, true);
  await call('token', 'hf_TestOnly123');
  assert.equal((await fs.readFile(tokenFile)).includes(Buffer.from('hf_TestOnly123')), false);
  await call('download');
  assert.equal(decrypted, true);
  assert.equal(requests[0].token, 'hf_TestOnly123');
  await call('token', '');
  assert.equal((await call('status')).tokenConfigured, false);
});

test('citation creator validates, escapes markup, and reading time counts only the spoken lead', async () => {
  const { createCitation, spokenCitations } = await import('../src/lib/citation.js');
  const { cardStats, formatDuration } = await import('../src/lib/card.js');
  const cite = createCitation({ author: 'Smith', year: '2024', title: 'A *study*', url: 'https://example.com/a(b)' });
  assert.ok(cite.startsWith('**Smith 2024**'));
  assert.ok(cite.includes('\\*study\\*'));
  assert.throws(() => createCitation({ author: '', year: '24' }));
  assert.throws(() => createCitation({ author: 'X', year: '2024', url: 'file:///bad' }));
  assert.equal(spokenCitations('**Smith 24 — Example Journal 2024**'), 'Smith 24');
  const stats = cardStats(`#### Tag\n${cite}\n==Read these words==`);
  assert.equal(stats.citationWords, 2);
  assert.equal(stats.highlighted, 3);
  assert.equal(stats.readWords, 5);
  assert.equal(cardStats('<mark>read <sup>this</sup></mark>').highlighted, 2);
  assert.equal(cardStats('<scr<em>ipt>alert(1)</script>').words, 2);
  assert.equal(formatDuration(61), '1:01');
  assert.equal(formatDuration(12), '0:12');
});

test('read time uses syllables and articulation complexity, not word count', async () => {
  const { speechStats, readingSeconds } = await import('../src/lib/readTime.js');
  const simple = speechStats('cat dog fish');
  const complex = speechStats('internationalization constitutional complexity');
  assert.equal(simple.syllables, 3);
  assert.equal(simple.weightedSyllables, 3);
  assert.ok(complex.syllables >= 12);
  assert.ok(readingSeconds(complex) > readingSeconds(simple) * 4);
  const clusters = speechStats('strengths strengths strengths strengths');
  const easy = speechStats('cat cat cat cat');
  assert.equal(clusters.syllables, easy.syllables);
  assert.ok(clusters.weightedSyllables > easy.weightedSyllables);
  assert.equal(readingSeconds({ weightedSyllables: 375 }, 250), 60);
  assert.equal(readingSeconds(complex, 500), readingSeconds(complex, 250) / 2);
  assert.equal(readingSeconds(speechStats('')), 0);
  assert.throws(() => readingSeconds(simple, 0), /positive/);
  assert.throws(() => readingSeconds(simple, NaN), /positive/);
});

test('speech estimates expand numbers, years and initialisms and strip nonspoken markup', async () => {
  const { speechStats } = await import('../src/lib/readTime.js');
  assert.equal(speechStats('2024').syllables, speechStats('twenty twenty four').syllables);
  assert.equal(speechStats('1999').syllables, speechStats('nineteen ninety nine').syllables);
  assert.equal(speechStats('2001').syllables, speechStats('two thousand one').syllables);
  assert.equal(speechStats('1,234').syllables, speechStats('one thousand two hundred thirty four').syllables);
  assert.equal(speechStats('1.5%').syllables, speechStats('one point five percent').syllables);
  assert.equal(speechStats('GDP USA WMD').syllables, 11);
  assert.equal(speechStats('000').syllables, speechStats('zero zero zero').syllables);
  assert.deepEqual(speechStats('<b>hello</b> &amp; world'), speechStats('hello and world'));
  assert.deepEqual(speechStats('[hello](https://example.com/very-long-url)'), speechStats('hello'));
  assert.deepEqual(speechStats('inter<em>national</em>'), speechStats('international'));
});

test('document and section read times include only highlights and spoken citation leads', async () => {
  const { cardStats, getSectionAt } = await import('../src/lib/card.js');
  const { speechStats } = await import('../src/lib/readTime.js');
  const content = '#### Ignore heading\n**Smith 2024** — Long publication and credentials\n==Read this==\nNever spoken words';
  const expected = speechStats('Read this Smith 2024');
  const stats = cardStats(content);
  assert.equal(stats.syllables, expected.syllables);
  assert.equal(stats.weightedSyllables, expected.weightedSyllables);
  assert.equal(cardStats(getSectionAt(content, 0).text).syllables, stats.syllables);
  assert.equal(cardStats('==Read==').syllables, cardStats('<mark>Read</mark>').syllables);
  assert.equal(cardStats('====').syllables, 0);
});

test('full text ranking favors titles and headings before limiting, respects phrases and tags', async () => {
  const { searchVault } = await import('../src/lib/search.js');
  const contents = {
    'A.md': '# Other\n' + 'grid transmission text '.repeat(100),
    'Grid.md': '# Grid\n## Transmission\nUseful evidence.',
    'Phrase.md': '# Phrase\npolitical capital costs',
    'Split.md': '# Split\npolitical other capital',
    'Résumé.md': '# Résumé\nélectricité',
  };
  const index = { tags: { aff: ['Grid.md'] } };
  assert.equal(searchVault(contents, index, 'grid transmission', 1)[0].path, 'Grid.md');
  assert.deepEqual(searchVault(contents, index, '"political capital"').map((r) => r.path), ['Phrase.md']);
  assert.deepEqual(searchVault(contents, index, 'tag:aff grid').map((r) => r.path), ['Grid.md']);
  assert.equal(searchVault(contents, index, 'electricite')[0].path, 'Résumé.md');
  assert.equal(searchVault(contents, index, '', 1).length, 0);
  const { lexicalAffinity } = require('../electron/embeddingMath.cjs');
  assert.equal(lexicalAffinity('grid grid infrastructure', 'Grid upgrades'), 0.5);
  assert.equal(lexicalAffinity('electricite', 'électricité'), 1);
  assert.equal(lexicalAffinity('', 'text'), 0);
});

test('folder normalization preserves existing paths and filenames without migrating folders', async () => {
  const { normalizeFolders, folderPaths } = await import('../src/lib/folderPaths.js');
  assert.equal(normalizeFolders('New Folder/A note.md', false), 'New_Folder/A note.md');
  assert.equal(normalizeFolders('Old Folder/New Folder/A.md', false, ['Old Folder']), 'Old Folder/New_Folder/A.md');
  assert.equal(normalizeFolders('New Folder', true), 'New_Folder');
  const tree = [{ type: 'folder', path: 'A B', children: [{ type: 'folder', path: 'A B/C D', children: [] }] }];
  assert.equal(normalizeFolders('A B/C D/Card name.md', false, folderPaths(tree)), 'A B/C D/Card name.md');
  assert.equal(normalizeFolders('A B/C D/New Folder/Card name.md', false, folderPaths(tree)), 'A B/C D/New_Folder/Card name.md');
});

test('ranking bounds heading boosts and favors exact words over substring noise', async () => {
  const { searchVault } = await import('../src/lib/search.js');
  const contents = {
    'Grid.md': '# Grid\nTransmission evidence.',
    'Spam.md': '## Grid transmission\n'.repeat(100),
    'Exact.md': 'The grid matters.',
    'Partial.md': 'Offgrid solutions matter.',
  };
  const index = { tags: {} };
  assert.equal(searchVault(contents, index, 'grid transmission', 1)[0].path, 'Grid.md');
  const ranks = searchVault(contents, index, 'grid');
  assert.ok(ranks.findIndex((r) => r.path === 'Exact.md') < ranks.findIndex((r) => r.path === 'Partial.md'));
  assert.deepEqual(searchVault(contents, index, 'grid grid'), ranks);
  assert.ok(ranks.every((r) => Number.isFinite(r.rank)));
  assert.ok(ranks.every((r) => r.matches.length <= 4));
  assert.throws(() => searchVault(contents, index, 'grid', 0), /Maximum search results/);
  assert.throws(() => searchVault(contents, index, 'grid', 1.5), /Maximum search results/);
});

test('platform: model autoload preference persists and semantic search forwards the result limit', async (t) => {
  const { EventEmitter } = require('node:events');
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const root = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'tagline-model-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const model = path.join(root, 'semantic-search', 'models', 'Xenova', 'all-MiniLM-L6-v2');
  await fs.mkdir(path.join(model, 'onnx'), { recursive: true });
  await Promise.all(['config.json', 'tokenizer.json', 'tokenizer_config.json', path.join('onnx', 'model_quantized.onnx')]
    .map((file) => fs.writeFile(path.join(model, file), 'test fixture')));
  const requests = [];
  let terminated = false;
  class Worker extends EventEmitter {
    postMessage(message) {
      requests.push(message);
      setImmediate(() => this.emit('message', { id: message.id, result: message.type === 'search' ? [] : { ready: true } }));
    }
    terminate() { terminated = true; }
  }
  const module = { exports: {} };
  const dirname = path.join(__dirname, '..', 'electron');
  require('node:vm').runInNewContext(await fs.readFile(path.join(dirname, 'embeddings.cjs'), 'utf8'), {
    module, __dirname: dirname, console,
    require: (name) => name === 'node:worker_threads' ? { Worker } : require(name),
  });
  const { registerEmbeddings } = module.exports;
  const app = new EventEmitter();
  app.getPath = () => root;
  const handlers = {};
  let config = { modelAutoload: false };
  registerEmbeddings({
    app, ipcMain: { handle: (name, handler) => { handlers[name] = handler; } },
    safeStorage: { isAsyncEncryptionAvailable: async () => true }, getVaultRoot: () => root,
    readConfig: () => config, writeConfig: (patch) => { config = { ...config, ...patch }; },
  });
  t.after(() => app.emit('before-quit'));
  const call = (name, ...args) => handlers[`embeddings:${name}`](null, ...args);
  const status = await call('status');
  assert.equal(status.downloaded, true);
  assert.equal(status.ready, false);
  assert.equal(status.autoload, false);
  assert.equal(requests.length, 0);
  await call('autoload', true);
  assert.equal(config.modelAutoload, true);
  assert.deepEqual(requests.map((r) => r.type), ['load']);
  await call('autoload', false);
  assert.equal(config.modelAutoload, false);
  assert.equal((await call('status')).ready, true);
  await call('search', { query: 'grid', documents: { 'Grid.md': 'grid' }, maxResults: 1 });
  assert.equal(requests.at(-1).maxResults, 1);
  await assert.rejects(call('search', { query: 'grid', documents: {}, maxResults: 1001 }), /Invalid semantic search request/);
  await assert.rejects(call('autoload', 'false'), /Invalid model autoload preference/);
  app.emit('before-quit');
  assert.equal(terminated, true);
});

test('platform: macOS desktop wiring provides native window controls, menus and Dock reactivation', async () => {
  const { EventEmitter } = require('node:events');
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const app = new EventEmitter();
  const windows = [];
  let menu;
  let dockIcon;
  let quit = false;
  const ipcMain = new EventEmitter();
  const handlers = new Map();
  ipcMain.handle = (name, callback) => handlers.set(name, callback);
  app.whenReady = () => Promise.resolve();
  app.getPreferredSystemLanguages = () => ['fr-CA', 'en-US'];
  app.dock = { setIcon: (icon) => { dockIcon = icon; } };
  app.setAboutPanelOptions = () => { };
  app.setName = () => { };
  app.quit = () => { quit = true; };
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => { };
      this.webContents.send = (channel, command) => { this.sent = { channel, command }; };
      this.webContents.isDestroyed = () => false;
      this.webContents.isCrashed = () => false;
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    close() {
      let prevented = false;
      this.emit('close', { preventDefault: () => { prevented = true; } });
      if (!prevented) { this.destroyed = true; this.emit('closed'); }
    }
    loadFile() { }
    static getAllWindows() { return windows.filter((win) => !win.destroyed); }
  }
  const electron = {
    app, BrowserWindow, ipcMain, dialog: {}, shell: {}, safeStorage: {},
    Menu: {
      buildFromTemplate: (template) => template,
      setApplicationMenu: (template) => { menu = template; },
    },
  };
  const dirname = path.join(__dirname, '..', 'electron');
  const fakeProcess = { platform: 'darwin', argv: [], env: { PATH: '/usr/bin:/bin:/usr/local/bin' } };
  vm.runInNewContext(fs.readFileSync(path.join(dirname, 'main.cjs'), 'utf8'), {
    __dirname: dirname, process: fakeProcess, console, URL, setTimeout, clearTimeout,
    require: (name) => {
      if (name === 'electron') return electron;
      if (name.startsWith('./')) {
        if (name === './sampleVault.cjs') return { SAMPLE_VAULT: {} };
        if (name === './installation.cjs') return { installationInfo: () => ({ version: require('../package.json').version }) };
        if (name === './appUpdates.cjs') return {
          createUpdateManager: () => ({ installUpdate: async (beforeInstall) => { await beforeInstall(); return { manual: true }; } }),
        };
        if (name === './browser.cjs') return { registerBrowser: () => () => { } };
        if (name === './revisionHistory.cjs') return {
          DEFAULT_RETENTION: 50,
          createRevisionHistory: () => ({ snapshot() { }, list() { return []; }, read() { }, rename() { } }),
        };
        return Object.fromEntries(['registerPandoc', 'registerEmbeddings', 'registerDocuments', 'registerFonts', 'registerTimerSound', 'registerFlowFiles', 'registerExtensions', 'registerNli', 'registerSummarization', 'registerOpenCaselist', 'registerGoogleDocs', 'registerTabroom', 'registerNativeUi']
          .map((key) => [key, () => true]));
      }
      return require(name);
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  // Finder/Dock launches gain Homebrew and MacTeX without duplicating existing entries.
  assert.equal(fakeProcess.env.PATH, '/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin:/Library/TeX/texbin');
  assert.equal(windows[0].options.titleBarStyle, 'hiddenInset');
  assert.equal(windows[0].options.trafficLightPosition.x, 14);
  assert.equal(windows[0].options.webPreferences.sandbox, true);
  assert.equal(windows[0].options.webPreferences.additionalArguments[0],
    `--tagline-languages=${encodeURIComponent(JSON.stringify(['fr-CA', 'en-US']))}`);
  assert.ok(dockIcon.endsWith(path.join('build', 'icon.png')));
  assert.equal(menu[0].label, 'Tagline');
  assert.ok(menu[0].submenu.some((item) => item.role === 'services'));
  assert.ok(menu.some((item) => item.role === 'windowMenu'));
  const file = menu.find((item) => item.label === 'File').submenu;
  assert.equal(file.find((item) => item.label === 'Close Tab').accelerator, 'CmdOrCtrl+W');
  assert.equal(file.find((item) => item.role === 'close').accelerator, 'Cmd+Shift+W');
  file.find((item) => item.label === 'New Note').click();
  assert.equal(windows[0].sent.command, 'newNote');
  ipcMain.emit('app:saveHandlerReady', { sender: windows[0].webContents }, true);
  const rejectedUpdate = handlers.get('app:installUpdate')();
  assert.equal(windows[0].sent.channel, 'app:prepareClose');
  ipcMain.emit('app:closeReady', { sender: windows[0].webContents }, false);
  await assert.rejects(rejectedUpdate, /Pending edits could not be saved/);
  assert.equal(windows[0].destroyed, undefined);
  const installedUpdate = handlers.get('app:installUpdate')();
  ipcMain.emit('app:closeReady', { sender: windows[0].webContents }, true);
  await installedUpdate;
  assert.equal(windows[0].destroyed, undefined, 'macOS DMG opening does not force-close the workspace');
  windows[0].close();
  assert.equal(windows[0].sent.channel, 'app:prepareClose');
  assert.equal(windows[0].destroyed, undefined, 'close waits for pending writes');
  ipcMain.emit('app:closeReady', { sender: windows[0].webContents }, false);
  assert.equal(windows[0].destroyed, undefined, 'failed save leaves the window open');
  windows[0].close();
  ipcMain.emit('app:closeReady', { sender: {} }, true);
  assert.equal(windows[0].destroyed, undefined, 'foreign IPC cannot acknowledge another window');
  ipcMain.emit('app:closeReady', { sender: windows[0].webContents }, true);
  assert.equal(windows[0].destroyed, true);
  assert.equal(ipcMain.listenerCount('app:closeReady'), 0, 'window recreation does not leak IPC handlers');
  assert.equal(ipcMain.listenerCount('app:saveHandlerReady'), 0);
  app.emit('window-all-closed');
  assert.equal(quit, false);
  app.emit('activate');
  assert.equal(windows.length, 2);
  windows[1].close();
  assert.equal(windows[1].destroyed, true, 'closing before the editor mounts needs no save acknowledgement');
  app.emit('activate');
  ipcMain.emit('app:saveHandlerReady', { sender: windows[2].webContents }, true);
  app.emit('before-quit');
  windows[2].close();
  ipcMain.emit('app:closeReady', { sender: windows[2].webContents }, true);
  assert.equal(quit, true, 'app quit resumes after pending edits save, including on macOS');
});

test('Pandoc detection supports Apple Silicon and Intel Homebrew without relying on shell PATH', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '..', 'electron', 'pandoc.cjs'), 'utf8');
  for (const installed of ['/opt/homebrew/bin/pandoc', '/usr/local/bin/pandoc']) {
    const tried = [];
    const module = { exports: {} };
    vm.runInNewContext(source, {
      module, process: { platform: 'darwin' }, setTimeout, clearTimeout,
      require: (name) => name === 'node:util' ? {
        promisify: () => async (executable) => {
          tried.push(executable);
          if (executable !== installed) throw Object.assign(new Error('Not on PATH'), { code: 'ENOENT' });
          return { stdout: 'pandoc 3.6\n' };
        }
      } : require(name),
    });
    const result = await module.exports.detectPandoc();
    assert.equal(result.executable, installed);
    assert.equal(result.available, true);
    assert.equal(tried[0], 'pandoc');
  }
});
test('calendar dates stay local, validate leap years and clamp month navigation', async () => {
  const { dateValue, parseDate, moveMonth, monthDays } = await import('../src/lib/calendar.js');
  assert.equal(dateValue(new Date(2024, 0, 1, 23, 59)), '2024-01-01');
  for (const value of ['2024-02-29', '2000-02-29', '0001-01-01', '0099-12-31', '9999-12-31']) {
    assert.equal(dateValue(parseDate(value)), value);
  }
  for (const value of ['', '2023-02-29', '1900-02-29', '2024-04-31', '2024-13-01', '0000-01-01', '2024-1-01']) {
    assert.equal(parseDate(value), null);
  }
  assert.equal(dateValue(moveMonth(parseDate('2024-01-31'), 1)), '2024-02-29');
  assert.equal(dateValue(moveMonth(parseDate('2024-02-29'), 12)), '2025-02-28');
  assert.equal(dateValue(moveMonth(parseDate('2024-01-31'), -1)), '2023-12-31');
  assert.equal(dateValue(moveMonth(parseDate('0001-01-01'), -1)), '0001-01-01');
  assert.equal(dateValue(moveMonth(parseDate('9999-12-31'), 1)), '9999-12-31');
  const days = monthDays(parseDate('2024-02-01'));
  assert.equal(days.length % 7, 0);
  assert.equal(days.filter(Boolean).length, 29);
  assert.equal(days.findIndex(Boolean), 4);
  assert.equal(dateValue(days.filter(Boolean).at(-1)), '2024-02-29');
});
