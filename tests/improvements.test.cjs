const { test } = require('node:test');
const assert = require('node:assert/strict');

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
  assert.equal(formatDuration(61), '1:01');
  assert.equal(formatDuration(12), '0:12');
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

test('model autoload preference persists and semantic search forwards the result limit', async (t) => {
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
    safeStorage: { isEncryptionAvailable: () => true }, getVaultRoot: () => root,
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

test('macOS desktop wiring provides native window controls, menus and Dock reactivation', async () => {
  const { EventEmitter } = require('node:events');
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const app = new EventEmitter();
  const windows = [];
  let menu;
  let dockIcon;
  let quit = false;
  app.whenReady = () => Promise.resolve();
  app.dock = { setIcon: (icon) => { dockIcon = icon; } };
  app.setAboutPanelOptions = () => {};
  app.quit = () => { quit = true; };
  class BrowserWindow {
    constructor(options) {
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.send = (channel, command) => { this.sent = { channel, command }; };
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    loadFile() {}
    static getAllWindows() { return windows.filter((win) => !win.destroyed); }
  }
  const electron = {
    app, BrowserWindow, ipcMain: { handle() {} }, dialog: {}, shell: {}, safeStorage: {},
    Menu: {
      buildFromTemplate: (template) => template,
      setApplicationMenu: (template) => { menu = template; },
    },
  };
  const dirname = path.join(__dirname, '..', 'electron');
  const fakeProcess = { platform: 'darwin', argv: [], env: { PATH: '/usr/bin:/bin:/usr/local/bin' } };
  vm.runInNewContext(fs.readFileSync(path.join(dirname, 'main.cjs'), 'utf8'), {
    __dirname: dirname, process: fakeProcess, console, URL,
    require: (name) => {
      if (name === 'electron') return electron;
      if (name.startsWith('./')) {
        if (name === './sampleVault.cjs') return { SAMPLE_VAULT: {} };
        return Object.fromEntries(['registerPandoc', 'registerEmbeddings', 'registerDocuments', 'registerFonts', 'registerFlowFiles', 'registerExtensions']
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
  assert.ok(dockIcon.endsWith(path.join('build', 'icon.png')));
  assert.equal(menu[0].label, 'Tagline');
  assert.ok(menu[0].submenu.some((item) => item.role === 'services'));
  assert.ok(menu.some((item) => item.role === 'windowMenu'));
  const file = menu.find((item) => item.label === 'File').submenu;
  assert.equal(file.find((item) => item.label === 'Close Tab').accelerator, 'CmdOrCtrl+W');
  assert.equal(file.find((item) => item.role === 'close').accelerator, 'Cmd+Shift+W');
  file.find((item) => item.label === 'New Note').click();
  assert.equal(windows[0].sent.command, 'newNote');
  windows[0].destroyed = true;
  app.emit('window-all-closed');
  assert.equal(quit, false);
  app.emit('activate');
  assert.equal(windows.length, 2);
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
      require: (name) => name === 'node:util' ? { promisify: () => async (executable) => {
        tried.push(executable);
        if (executable !== installed) throw Object.assign(new Error('Not on PATH'), { code: 'ENOENT' });
        return { stdout: 'pandoc 3.6\n' };
      } } : require(name),
    });
    const result = await module.exports.detectPandoc();
    assert.equal(result.executable, installed);
    assert.equal(result.available, true);
    assert.equal(tried[0], 'pandoc');
  }
});
