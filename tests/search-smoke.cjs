if (!process.versions.electron) {
  process.exitCode = require('./helpers/smoke.cjs').runSmoke({
    script: __filename,
    prefix: 'tagline-search-',
    rootEnv: 'TAGLINE_SEARCH_ROOT',
  });
  return;
}

const { app, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const root = process.env.TAGLINE_SEARCH_ROOT;
  if (!root) {
    throw new Error('Run through npm run test:search.');
  }
  const profile = path.join(root, 'profile');
  const vault = path.join(root, 'vault');
  await fs.mkdir(profile, { recursive: true });
  await fs.mkdir(vault);
  await fs.mkdir(path.join(vault, '.tagline'), { recursive: true });
  await fs.writeFile(
    path.join(vault, '.tagline', 'vault.json'),
    JSON.stringify({ version: require('../electron/vaultMigrations.cjs').migrations.length })
  );
  const documents = {
    'Grid.md':
      '# **Grid** [[Network|transmission]]\n#neg\nExact keyword evidence.\n' +
      'Background context. '.repeat(60) +
      'Électricité supports resilience.',
    'Both.md': '# Evidence\n#neg\nGrid transmission upgrades.',
    'Meaning.md': '#neg\nPower networks need renewable energy.',
    'Phrase.md': '#neg\nPolitical capital evidence.',
    'Split.md': '#neg\nPolitical hard-earned capital.',
    'Excluded.md': '#aff\nGrid transmission and political capital.',
  };
  await Promise.all(
    Object.entries(documents).map(([file, text]) => fs.writeFile(path.join(vault, file), text))
  );
  await fs.writeFile(
    path.join(profile, 'config.json'),
    JSON.stringify({ lastVault: vault, modelAutoload: false })
  );
  app.setPath('userData', profile);
  // Electron is launched with this test script, so its app path is the tests folder.
  app.getAppPath = () => path.resolve(__dirname, '..');
  let behavior = 'success';
  let resolveHeld;
  const requests = [];

  app.on('browser-window-created', (_event, win) => {
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error') {
        console.error(event.message);
      }
    });
    win.webContents.setBackgroundThrottling(false);
    win.webContents.once('did-finish-load', async () => {
      const wc = win.webContents;
      const js = (code) => wc.executeJavaScript(code);
      const wait = require('./helpers/wait.cjs').rendererWait(js);
      const input = (value) =>
        js(`(() => {
        const el = document.querySelector('.search .palette-input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      const mode = (value) =>
        js(`(() => {
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
      const waitForRequests = async (count) => {
        for (let i = 0; i < 100; i++) {
          if (requests.length >= count) {
            return;
          }
          await delay(100);
        }
        throw new Error(`Timed out waiting for ${count} semantic requests`);
      };
      try {
        await wait("!!document.querySelector('.onboarding-skip')");
        await js("document.querySelector('.onboarding-skip').click()");
        await wait("document.querySelectorAll('.tree-item').length === 6");
        // Stub only inference for deterministic UI/race checks. test:semantic covers the real model.
        ipcMain.removeHandler('embeddings:search');
        ipcMain.handle('embeddings:search', async (_event, request) => {
          requests.push(request);
          if (behavior === 'error') {
            throw new Error('Test semantic failure');
          }
          if (behavior === 'hold') {
            return new Promise((resolve) => {
              resolveHeld = resolve;
            });
          }
          const order = request.query.includes('political capital')
            ? ['Phrase.md']
            : ['Both.md', 'Meaning.md', 'Grid.md'];
          return order
            .filter((file) => Object.hasOwn(request.documents, file))
            .map((file, index) => ({
              path: file,
              score: 0.95 - index * 0.2,
              line: 2,
              text: request.documents[file].split('\n').at(-1),
            }));
        });

        await openSearch();
        assert.equal(await js("document.querySelector('.search-options select').value"), 'text');
        await input('tag:neg grid transmission');
        await wait("document.querySelectorAll('.search-result').length === 2");
        assert.equal(
          await js("document.querySelector('.search-file .palette-detail').textContent"),
          'Grid.md'
        );
        assert.equal(requests.length, 0);

        await input('tag:neg transmision');
        await wait("document.querySelectorAll('.search-result').length === 2");
        assert.ok(
          await js(
            "document.querySelector('.search').textContent.includes('Showing close spelling matches')"
          )
        );
        assert.ok(
          await js(
            "[...document.querySelectorAll('.search-line mark')].some(el => /transmission/i.test(el.textContent))"
          )
        );
        await input('electricite');
        await wait("document.querySelectorAll('.search-result').length === 1");
        assert.equal(
          await js("document.querySelector('.search-line mark').textContent"),
          'Électricité'
        );
        assert.ok(await js("document.querySelector('.search-line').textContent.startsWith('…')"));
        await js(
          "document.querySelector('.search input').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))"
        );
        assert.ok(await js("document.activeElement.matches('.search-file')"));
        await js(
          "document.querySelector('.search input').focus(); document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))"
        );
        await wait("!document.querySelector('.search')");
        await wait("document.querySelector('.tab.active')?.getAttribute('title') === 'Grid.md'");
        await wait("!!document.querySelector('.cm-editor')");
        await wait(
          "window.getSelection()?.anchorNode?.parentElement?.closest('.cm-line')?.textContent.includes('Électricité')"
        );
        await js("document.querySelector('.tab.active .tab-close').click()");
        await wait("!document.querySelector('.tab.active')");
        await openSearch();
        await input('"grid transmission"');
        await wait("document.querySelectorAll('.search-result').length === 3");
        assert.ok(
          await js(
            "document.querySelector('.search-line').textContent.includes('Grid transmission')"
          )
        );
        await js("document.querySelector('.search-line').click()");
        await wait("document.querySelector('.tab.active')?.getAttribute('title') === 'Grid.md'");
        await wait(
          "window.getSelection()?.anchorNode?.parentElement?.closest('.cm-line')?.textContent.includes('[[Network|transmission]]')"
        );
        await js("document.querySelector('.tab.active .tab-close').click()");
        await wait("!document.querySelector('.tab.active')");
        await openSearch();
        await input('tag:neg grid transmission');
        await mode('hybrid');
        await waitForRequests(1);
        await wait(
          "document.querySelector('.search [role=status]')?.textContent.includes('Combines keyword and semantic rankings')"
        );
        assert.equal(requests[0].maxResults, 1000);
        assert.equal(Object.hasOwn(requests[0].documents, 'Excluded.md'), false);
        await wait("document.querySelectorAll('.search-result').length === 3");
        assert.equal(
          await js("document.querySelector('.search-file .palette-detail').textContent"),
          'Both.md'
        );
        assert.ok(
          await js(
            "document.querySelector('.search-file').textContent.includes('Keyword + semantic')"
          )
        );
        assert.ok(
          await js(
            "[...document.querySelectorAll('.search-file')].some(el => el.textContent.includes('Meaning') && el.textContent.includes('Semantic match'))"
          )
        );
        await js("document.querySelector('.search-line').click()");
        await wait("document.querySelector('.tab.active')?.getAttribute('title') === 'Both.md'");
        await wait("!!document.querySelector('.cm-editor')");
        await js("document.querySelector('.tab.active .tab-close').click()");
        await wait("!document.querySelector('.tab.active')");

        await openSearch();
        const beforePhrase = requests.length;
        await mode('hybrid');
        await input('tag:neg "political capital" influence');
        await waitForRequests(beforePhrase + 1);
        await wait("document.querySelectorAll('.search-result').length === 1");
        assert.deepEqual(Object.keys(requests.at(-1).documents), ['Phrase.md']);
        assert.equal(await js("document.querySelectorAll('.search-result').length"), 1);
        await input('tag:missing anything');
        const beforeEmpty = requests.length;
        await wait(
          "document.querySelector('.search [role=status]')?.textContent.includes('Keyword results shown')"
        );
        await wait(
          "document.querySelector('.search [role=status]')?.textContent.includes('Combines keyword and semantic rankings')"
        );
        assert.equal(requests.length, beforeEmpty, 'Empty filters should not load the model');
        assert.equal(await js("document.querySelectorAll('.search-result').length"), 0);
        await input('tag:neg');
        await wait("document.querySelector('.search-options button').disabled");

        behavior = 'error';
        await input('grid transmission');
        await wait(
          "document.querySelector('.search-error')?.textContent.includes('showing keyword results only')"
        );
        assert.ok(
          await js(
            "document.querySelector('.search-error').textContent.includes('Test semantic failure')"
          )
        );
        assert.ok(await js("document.querySelectorAll('.search-result').length > 0"));

        behavior = 'hold';
        const beforeHold = requests.length;
        await js("document.querySelector('.search-options button').click()");
        await wait("document.querySelector('.search-options button').disabled");
        assert.equal(requests.length, beforeHold + 1);
        await input('capital');
        resolveHeld([{ path: 'Stale.md', score: 1, line: 0, text: 'stale' }]);
        await wait("!document.querySelector('.search-options button').disabled");
        assert.equal(
          await js("document.querySelector('.search-results').textContent.includes('Stale')"),
          false
        );
        assert.ok(
          await js(
            "document.querySelector('.search [role=status]').textContent.includes('Keyword results shown')"
          )
        );

        const beforeOverlap = requests.length;
        await input('grid');
        await waitForRequests(beforeOverlap + 1);
        const resolveOld = resolveHeld;
        await input('capital');
        await waitForRequests(beforeOverlap + 2);
        const resolveNew = resolveHeld;
        await wait("document.querySelector('.search-options button').disabled");
        resolveOld([]);
        await delay(200);
        assert.equal(
          await js("document.querySelector('.search-options button').disabled"),
          true,
          'An older request must not clear a newer request’s busy state'
        );
        resolveNew([]);
        await wait("!document.querySelector('.search-options button').disabled");

        const beforeInvalidation = requests.length;
        await input('grid');
        await waitForRequests(beforeInvalidation + 1);
        const resolveInvalidated = resolveHeld;
        await input('tag:missing anything');
        await wait("!document.querySelector('.search-options button').disabled");
        resolveInvalidated([]);
        await wait(
          "document.querySelector('.search [role=status]')?.textContent.includes('Combines keyword and semantic rankings')"
        );
        assert.equal(requests.length, beforeInvalidation + 1);

        behavior = 'success';
        const beforeSemantic = requests.length;
        await mode('semantic');
        await input('tag:neg "political capital"');
        await waitForRequests(beforeSemantic + 1);
        await wait(
          "document.querySelector('.search-file .palette-detail')?.textContent === 'Phrase.md'"
        );
        assert.deepEqual(Object.keys(requests.at(-1).documents), ['Phrase.md']);
        assert.equal(
          await js("document.querySelector('.search-file .palette-detail').textContent"),
          'Phrase.md'
        );
        await mode('text');
        await js(
          "document.querySelector('.search .palette-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))"
        );
        await wait("!document.querySelector('.search')");
        await js("localStorage.setItem('tagline-settings', JSON.stringify({searchMaxResults: 1}))");
        await new Promise((resolve) => {
          wc.once('did-finish-load', resolve);
          wc.reload();
        });
        await wait("document.querySelectorAll('.tree-item').length === 6");
        await openSearch();
        const beforeLimited = requests.length;
        await mode('hybrid');
        await input('tag:neg grid transmission');
        await waitForRequests(beforeLimited + 1);
        await wait(
          "document.querySelector('.search-file .palette-detail')?.textContent === 'Both.md'"
        );
        assert.equal(await js("document.querySelectorAll('.search-result').length"), 1);
        assert.equal(
          await js("document.querySelector('.search-file .palette-detail').textContent"),
          'Both.md',
          'A keyword runner-up must win fusion even with a final result limit of one'
        );
        ipcMain.removeHandler('extensions:networkFetch');
        ipcMain.handle('extensions:networkFetch', async (_event, id, url) => {
          assert.equal(id, 'scholarly-search');
          assert.equal(new URL(url).searchParams.get('query.bibliographic'), 'climate policy');
          return {
            ok: true,
            body: {
              status: 'ok',
              message: {
                items: [
                  {
                    DOI: '10.1234/example',
                    title: ['Climate Policy'],
                    author: [{ given: 'Ada', family: 'Smith' }],
                    published: { 'date-parts': [[2023]] },
                    'container-title': ['Journal'],
                  },
                ],
              },
            },
          };
        });
        await wait(
          '!!document.querySelector(\'option[value="extension:scholarly-search:search"]\')'
        );
        await input('climate policy');
        await mode('extension:scholarly-search:search');
        let frame;
        for (let i = 0; i < 100; i++) {
          frame = wc.mainFrame.framesInSubtree.find((item) =>
            item.url.includes('extension-webview.html')
          );
          if (frame && (await frame.executeJavaScript("!!document.querySelector('#query')"))) {
            break;
          }
          await delay(100);
        }
        assert.ok(frame, 'Scholarly extension surface should load');
        const view = (code) => frame.executeJavaScript(code);
        const waitView = require('./helpers/wait.cjs').rendererWait(view);
        await waitView("document.querySelector('#query').value === 'climate policy'");
        await view("document.querySelector('#search').click()");
        await waitView(
          "document.querySelector('.result strong')?.textContent === 'Climate Policy'"
        );
        await view(
          "[...document.querySelectorAll('.result button')].find(b => b.textContent === 'Cut card').click()"
        );
        assert.equal(await view("document.querySelector('#author').value"), 'Ada Smith');
        await view(
          "document.querySelector('#tag').value = 'Both'; document.querySelector('#excerpt').value = 'Evidence from the source.'; document.querySelector('#save').click()"
        );
        await wait("!document.querySelector('.modal.search')");
        await wait("document.querySelector('.tab.active')?.textContent.includes('Both 1')");
        assert.equal(await fs.readFile(path.join(vault, 'Both.md'), 'utf8'), documents['Both.md']);
        const card = await fs.readFile(path.join(vault, 'Both 1.md'), 'utf8');
        assert.match(card, /Ada Smith/);
        assert.match(card, /2023/);
        assert.match(card, /10\.1234\/example/);
        assert.match(card, /Evidence from the source\./);
        await js("document.documentElement.lang = 'es'");
        await openSearch();
        await mode('extension:scholarly-search:search');
        let spanishFrame;
        for (let i = 0; i < 100; i++) {
          spanishFrame = wc.mainFrame.framesInSubtree.find((item) =>
            item.url.includes('extension-webview.html')
          );
          if (
            spanishFrame &&
            (await spanishFrame.executeJavaScript(
              "document.querySelector('#search')?.textContent === 'Buscar en Crossref'"
            ))
          ) {
            break;
          }
          await delay(100);
        }
        assert.equal(
          await spanishFrame.executeJavaScript("document.querySelector('#search').textContent"),
          'Buscar en Crossref',
          'the standalone plugin uses the host language in its sandbox'
        );
        console.log(
          'PASS: typo recovery, deep accent-folded previews, keyboard navigation, matching-line jumps, hybrid fusion, tags/phrases, semantic recall, explicit failures, stale requests, result limit.'
        );
        app.exit(0);
      } catch (error) {
        console.error(error);
        console.error(await js('document.body.innerText.slice(0, 1000)'));
        console.error(
          await js(
            "JSON.stringify({query: document.querySelector('.search input')?.value, results: document.querySelector('.search-results')?.textContent, error: document.querySelector('.search-error')?.textContent})"
          )
        );
        app.exit(1);
      }
    });
  });
  require('../electron/main.cjs');
})().catch((error) => {
  console.error(error);
  app.exit(1);
});
