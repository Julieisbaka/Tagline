if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tagline-search-'));
  try {
    const result = spawnSync(require('electron'), [__filename], {
      env: { ...process.env, TAGLINE_SEARCH_ROOT: root }, stdio: 'inherit', timeout: 120000,
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
  return;
}

const { app, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const root = process.env.TAGLINE_SEARCH_ROOT;
  if (!root) throw new Error('Run through npm run test:search.');
  const profile = path.join(root, 'profile');
  const vault = path.join(root, 'vault');
  await fs.mkdir(profile, { recursive: true });
  await fs.mkdir(vault);
  const documents = {
    'Grid.md': '# Grid transmission\n#neg\nExact keyword evidence.',
    'Both.md': '# Evidence\n#neg\nGrid transmission upgrades.',
    'Meaning.md': '#neg\nPower networks need renewable energy.',
    'Phrase.md': '#neg\nPolitical capital evidence.',
    'Split.md': '#neg\nPolitical hard-earned capital.',
    'Excluded.md': '#aff\nGrid transmission and political capital.',
  };
  await Promise.all(Object.entries(documents).map(([file, text]) => fs.writeFile(path.join(vault, file), text)));
  await fs.writeFile(path.join(profile, 'config.json'), JSON.stringify({ lastVault: vault, modelAutoload: false }));
  app.setPath('userData', profile);
  let behavior = 'success';
  let resolveHeld;
  const requests = [];

  app.on('browser-window-created', (_event, win) => {
    win.webContents.once('did-finish-load', async () => {
      const wc = win.webContents;
      const js = (code) => wc.executeJavaScript(code);
      const wait = async (code) => {
        for (let i = 0; i < 100; i++) {
          if (await js(code)) return;
          await delay(100);
        }
        throw new Error(`Timed out: ${code}`);
      };
      const input = (value) => js(`(() => {
        const el = document.querySelector('.search .palette-input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      const mode = (value) => js(`(() => {
        const el = document.querySelector('.search-options select');
        el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      const openSearch = async () => {
        await js(`window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'F', shiftKey: true, ctrlKey: ${process.platform !== 'darwin'},
          metaKey: ${process.platform === 'darwin'}, bubbles: true
        }))`);
        await wait("!!document.querySelector('.search .palette-input')");
      };
      const runSearch = async () => {
        await js("document.querySelector('.search-options button').click()");
        await wait("!document.querySelector('.search-options button').disabled");
      };
      try {
        await wait("document.querySelectorAll('.tree-item').length === 6");
        // Stub only inference for deterministic UI/race checks. test:semantic covers the real model.
        ipcMain.removeHandler('embeddings:search');
        ipcMain.handle('embeddings:search', async (_event, request) => {
          requests.push(request);
          if (behavior === 'error') throw new Error('Test semantic failure');
          if (behavior === 'hold') return new Promise((resolve) => { resolveHeld = resolve; });
          const order = request.query.includes('political capital') ? ['Phrase.md'] : ['Both.md', 'Meaning.md', 'Grid.md'];
          return order.filter((file) => Object.hasOwn(request.documents, file)).map((file, index) => ({
            path: file, score: 0.95 - index * 0.2, line: 2, text: request.documents[file].split('\n').at(-1),
          }));
        });

        await openSearch();
        assert.equal(await js("document.querySelector('.search-options select').value"), 'text');
        await input('tag:neg grid transmission');
        await wait("document.querySelectorAll('.search-result').length === 2");
        assert.equal(await js("document.querySelector('.search-file .palette-detail').textContent"), 'Grid.md');
        assert.equal(requests.length, 0);
        await mode('hybrid');
        await wait("document.querySelector('[role=status]')?.textContent.includes('Keyword results shown')");
        assert.equal(requests.length, 0, 'Selecting hybrid must not start inference or download');
        await runSearch();
        assert.equal(requests[0].maxResults, 1000);
        assert.equal(Object.hasOwn(requests[0].documents, 'Excluded.md'), false);
        await wait("document.querySelectorAll('.search-result').length === 3");
        assert.equal(await js("document.querySelector('.search-file .palette-detail').textContent"), 'Both.md');
        assert.ok(await js("document.querySelector('.search-file').textContent.includes('Keyword + semantic')"));
        assert.ok(await js("[...document.querySelectorAll('.search-file')].some(el => el.textContent.includes('Meaning') && el.textContent.includes('Semantic match'))"));
        await js("document.querySelector('.search-line').click()");
        await wait("document.querySelector('.tab.active')?.getAttribute('title') === 'Both.md'");
        await wait("!!document.querySelector('.cm-editor')");
        await js("document.querySelector('.tab.active .tab-close').click()");
        await wait("!document.querySelector('.tab.active')");

        await openSearch();
        await mode('hybrid');
        await input('tag:neg "political capital" influence');
        await runSearch();
        assert.deepEqual(Object.keys(requests.at(-1).documents), ['Phrase.md']);
        assert.equal(await js("document.querySelectorAll('.search-result').length"), 1);
        await input('tag:missing anything');
        const beforeEmpty = requests.length;
        await runSearch();
        assert.equal(requests.length, beforeEmpty, 'Empty filters should not load the model');
        assert.equal(await js("document.querySelectorAll('.search-result').length"), 0);
        await input('tag:neg');
        await wait("document.querySelector('.search-options button').disabled");

        await input('grid transmission');
        behavior = 'error';
        await runSearch();
        await wait("document.querySelector('.search-error')?.textContent.includes('showing keyword results only')");
        assert.ok(await js("document.querySelector('.search-error').textContent.includes('Test semantic failure')"));
        assert.ok(await js("document.querySelectorAll('.search-result').length > 0"));

        behavior = 'hold';
        const beforeHold = requests.length;
        await js("document.querySelector('.search-options button').click()");
        await wait("document.querySelector('.search-options button').disabled");
        assert.equal(requests.length, beforeHold + 1);
        await input('capital');
        resolveHeld([{ path: 'Stale.md', score: 1, line: 0, text: 'stale' }]);
        await wait("!document.querySelector('.search-options button').disabled");
        assert.equal(await js("document.querySelector('.search-results').textContent.includes('Stale')"), false);
        assert.ok(await js("document.querySelector('[role=status]').textContent.includes('Keyword results shown')"));

        behavior = 'success';
        await mode('semantic');
        await input('tag:neg "political capital"');
        await runSearch();
        assert.deepEqual(Object.keys(requests.at(-1).documents), ['Phrase.md']);
        assert.equal(await js("document.querySelector('.search-file .palette-detail').textContent"), 'Phrase.md');
        await mode('text');
        await js("document.querySelector('.search .palette-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
        await wait("!document.querySelector('.search')");
        await js("localStorage.setItem('tagline-settings', JSON.stringify({searchMaxResults: 1}))");
        await new Promise((resolve) => { wc.once('did-finish-load', resolve); wc.reload(); });
        await wait("document.querySelectorAll('.tree-item').length === 6");
        await openSearch();
        await mode('hybrid');
        await input('tag:neg grid transmission');
        await runSearch();
        assert.equal(await js("document.querySelectorAll('.search-result').length"), 1);
        assert.equal(await js("document.querySelector('.search-file .palette-detail').textContent"), 'Both.md',
          'A keyword runner-up must win fusion even with a final result limit of one');
        console.log('PASS: hybrid fusion UI, tags/phrases, semantic-only recall, navigation, explicit failures, stale requests, result limit.');
        app.exit(0);
      } catch (error) {
        console.error(error);
        console.error(await js("JSON.stringify({query: document.querySelector('.search input')?.value, results: document.querySelector('.search-results')?.textContent, error: document.querySelector('.search-error')?.textContent})"));
        app.exit(1);
      }
    });
  });
  require('../electron/main.cjs');
})().catch((error) => { console.error(error); app.exit(1); });
