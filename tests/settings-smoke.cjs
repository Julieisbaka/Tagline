if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tagline-settings-'));
  try {
    const result = spawnSync(require('electron'), [__filename], {
      env: { ...process.env, TAGLINE_SETTINGS_ROOT: root }, stdio: 'inherit', timeout: 120000,
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
  return;
}

const { app, shell, dialog, ipcMain } = require('electron');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const root = process.env.TAGLINE_SETTINGS_ROOT;
  if (!root) throw new Error('Run through npm run test:settings.');
  const profile = path.join(root, 'profile');
  const vault = path.join(root, 'vault');
  const otherVault = path.join(root, 'other-vault');
  await fs.mkdir(profile, { recursive: true });
  await fs.mkdir(vault);
  await fs.mkdir(otherVault);
  await fs.writeFile(path.join(otherVault, 'Other.md'), '# Other\n');
  await fs.writeFile(path.join(vault, 'Alpha.md'), '# Alpha\n\n[[Beta]]\n');
  await fs.writeFile(path.join(vault, 'Beta.md'), '# Beta\n\n==Evidence==\n');
  await fs.writeFile(path.join(vault, 'Links.md'), '[[Beta#Beta|alias]]');
  await fs.writeFile(path.join(profile, 'config.json'), JSON.stringify({ lastVault: vault, modelAutoload: false }));
  app.setPath('userData', profile);
  // Keep deletion local to this temporary test vault rather than using the OS trash.
  shell.trashItem = async (file) => fs.rm(file);
  const externalUrls = [];
  shell.openExternal = async (url) => { externalUrls.push(url); };
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<h1>${request.url}</h1><a id="next" href="/two">Next</a>
      <script>document.body.dataset.rendered = 'yes';</script>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const website = `http://127.0.0.1:${server.address().port}/one`;
  app.on('browser-window-created', (_event, win) => {
    win.webContents.setBackgroundThrottling(false);
    win.webContents.once('did-finish-load', async () => {
      const wc = win.webContents;
      const js = (code) => wc.executeJavaScript(code).catch((error) => {
        throw new Error(`${error.message}\nScript: ${code}`);
      });
      const wait = async (code) => {
        for (let i = 0; i < 100; i++) { if (await js(code)) return; await delay(100); }
        throw new Error('Timed out: ' + code + '\nCSS: ' + JSON.stringify(await js(`({
          saved: JSON.parse(localStorage.getItem('tagline-settings')),
          style: document.querySelector('#tagline-custom-css')?.textContent,
          outline: getComputedStyle(document.querySelector('.sidebar')).outline,
          draft: document.querySelector('.custom-css-editor .cm-content')?.textContent,
          cssApplyDisabled: [...document.querySelectorAll('.custom-css-settings button')].find(el => el.textContent.trim() === 'Apply CSS')?.disabled,
          website: document.querySelector('.website-status')?.textContent,
          browserUpdates: window.browserUpdates,
          browserButtons: [...document.querySelectorAll('.website-toolbar button')].map(el => [el.textContent, el.disabled])
        })`)));
      };
      const click = (selector) => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
      const button = (selector, text) => js(`(() => {
        const item = [...document.querySelectorAll(${JSON.stringify(selector)})].find(el => el.textContent.trim() === ${JSON.stringify(text)});
        if (!item) throw new Error('Missing button: ' + ${JSON.stringify(text)});
        item.click();
      })()`);
      const input = (selector, value, type = 'HTMLInputElement') => js(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        Object.getOwnPropertyDescriptor(${type}.prototype, 'value').set.call(el, ${JSON.stringify(value)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      const cssText = "document.querySelector('.custom-css-editor .cm-content').textContent";
      const setCss = async (value) => {
        await js(`document.querySelector('[aria-label="CSS source"]').focus()`);
        const modifiers = [process.platform === 'darwin' ? 'meta' : 'control'];
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers });
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers });
        await delay(100);
        await wc.insertText(value);
        await wait(`[...document.querySelectorAll('.custom-css-settings button')]
          .some(el => el.textContent.trim() === 'Apply CSS' && !el.disabled)`);
      };
      const open = async (file) => {
        await js(`document.querySelector('.tree-item[title=${JSON.stringify(file)}]').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))`);
        await wait(`document.querySelector('.tab.active')?.getAttribute('title') === ${JSON.stringify(file)}`);
      };
      const settings = async (section = 'files') => {
        await click('.ribbon button:last-child');
        await wait("!!document.querySelector('.settings')");
        await click(`[data-section="${section}"]`);
      };
      const done = () => button('.settings button', 'Done');
      const toggle = async (key, value) => {
        const checked = await js(`document.querySelector('[data-setting="${key}"]').checked`);
        if (checked !== value) await click(`[data-setting="${key}"]`);
        await wait(`JSON.parse(localStorage.getItem('tagline-settings')).${key} === ${value}`);
      };
      const reload = async () => {
        await new Promise((resolve) => { wc.once('did-finish-load', resolve); wc.reload(); });
        await wait("!!document.querySelector('.onboarding-skip')");
        await click('.onboarding-skip');
        await wait("!!document.querySelector('.file-tree')");
      };
      const rename = async (from, to) => {
        await js(`document.querySelector('.tree-item[title=${JSON.stringify(from)}]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))`);
        await button('.context-menu button', 'Rename…');
        await wait("!!document.querySelector('.dialog input')");
        await input('.dialog input', to);
        await wait(`document.querySelector('.dialog input')?.getAttribute('value') === ${JSON.stringify(to)}`);
        await button('.dialog button', 'OK');
        await wait(`!!document.querySelector('.tree-item[title=${JSON.stringify(to + '.md')}]')`);
      };
      try {
        await wait("document.querySelectorAll('.tree-item').length === 3");
        await open('Alpha.md');
        await wait("!!document.querySelector('[aria-label=\"Dismiss visual editor notice\"]')");
        await click('[aria-label="Dismiss visual editor notice"]');
        await wait("!document.querySelector('.editor-notice')");
        await reload();
        await wait("!!document.querySelector('.ProseMirror')");
        assert.equal(await js("!!document.querySelector('[aria-label=\"Dismiss visual editor notice\"]')"), false);
        await settings('advanced');
        assert.equal(await js("document.querySelector('[data-flag=\"visualNoticeDismissed\"]').checked"), true);
        await click('[data-flag="visualNoticeDismissed"]');
        await done();
        await wait("!!document.querySelector('[aria-label=\"Dismiss visual editor notice\"]')");

        ipcMain.removeHandler('pandoc:status');
        ipcMain.handle('pandoc:status', () => ({ available: false }));
        await settings('integrations');
        await button('.integration-settings button', 'Install Pandoc');
        assert.equal(externalUrls.pop(), 'https://pandoc.org/installing.html');
        await done();

        await js(`window.browserUpdates = []; window.api.onWebsiteState(next => window.browserUpdates.push(next)); window.open(${JSON.stringify(website)})`);
        await wait("!!document.querySelector('.website-view')");
        await wait(`document.querySelector('.website-status')?.textContent === ${JSON.stringify(website)}`);
        const websiteView = win.contentView.children.find((view) => view.webContents);
        const checkBrowserBounds = async () => {
          let area, box;
          for (let i = 0; i < 30; i++) {
            area = await js(`(() => {
            const workspace = document.querySelector('.workspace').getBoundingClientRect();
            const surface = document.querySelector('.website-surface').getBoundingClientRect();
            const browser = document.querySelector('.website-view').getBoundingClientRect();
            return { x: surface.x, y: surface.y, width: surface.width, height: surface.height,
              inside: browser.x >= workspace.x && browser.y >= workspace.y &&
                browser.right <= workspace.right + 1 && browser.bottom <= workspace.bottom + 1 };
            })()`);
            box = websiteView.getBounds();
            if (['x', 'y', 'width', 'height'].every((key) => Math.abs(box[key] - area[key] * wc.getZoomFactor()) <= 1)) break;
            await delay(100);
          }
          assert.equal(area.inside, true, 'Browser stays inside the note workspace');
          for (const key of ['x', 'y', 'width', 'height']) {
            assert.ok(Math.abs(box[key] - area[key] * wc.getZoomFactor()) <= 1,
              `Native browser ${key} matches the note surface: ${JSON.stringify({ box, area })}`);
          }
        };
        await checkBrowserBounds();
        const remote = websiteView.webContents;
        const preferences = remote.getLastWebPreferences();
        assert.equal(preferences.nodeIntegration, false);
        assert.equal(preferences.sandbox, true);
        assert.equal(preferences.contextIsolation, true);
        assert.equal(preferences.preload, undefined);
        assert.equal(await remote.executeJavaScript("document.body.dataset.rendered"), 'yes');
        assert.equal(await remote.executeJavaScript("typeof window.api + ',' + typeof require"), 'undefined,undefined');
        assert.doesNotMatch(await remote.executeJavaScript('navigator.userAgent'), /Electron|tagline/i);
        await remote.session.cookies.set({
          url: website, name: 'login-test', value: 'signed-in',
          expirationDate: Date.now() / 1000 + 3600
        });
        assert.equal((await wc.session.cookies.get({ url: website, name: 'login-test' })).length, 0);
        await remote.executeJavaScript("document.querySelector('#next').click()", true);
        await wait("document.querySelector('.website-status')?.textContent.endsWith('/two')");
        await wait("!document.querySelector('.website-toolbar button').disabled");
        await button('.website-toolbar button', 'Back');
        await wait(`document.querySelector('.website-status')?.textContent === ${JSON.stringify(website)}`);
        await button('.website-toolbar button', 'Forward');
        await wait("document.querySelector('.website-status')?.textContent.endsWith('/two')");
        win.setSize(1200, 800);
        await delay(200);
        const surfaceWidth = await js("document.querySelector('.website-surface').getBoundingClientRect().width");
        assert.ok(Math.abs(websiteView.getBounds().width - surfaceWidth * wc.getZoomFactor()) <= 1,
          `Website bounds ${JSON.stringify(websiteView.getBounds())}, surface ${surfaceWidth}, zoom ${wc.getZoomFactor()}, content ${win.getContentSize()}`);
        await checkBrowserBounds();
        await button('.website-toolbar button', 'Open in browser');
        assert.equal(externalUrls.pop(), website.replace('/one', '/two'));
        await input('[aria-label="Website address"]', 'file:///C:/Windows/win.ini');
        await js("document.querySelector('.website-toolbar').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))");
        await wait("document.querySelector('.website-status')?.textContent.includes('Only HTTP')");
        assert.equal(remote.getURL(), website.replace('/one', '/two'));
        await click('[aria-label="Close website"]');
        await wait("!document.querySelector('.website-view')");
        assert.equal(remote.isDestroyed(), true);
        await js(`window.open(${JSON.stringify(website)})`);
        await wait(`document.querySelector('.website-status')?.textContent === ${JSON.stringify(website)}`);
        const reopened = win.contentView.children.find((view) => view.webContents).webContents;
        assert.equal((await reopened.session.cookies.get({ url: website, name: 'login-test' }))[0].value, 'signed-in');
        await reload();
        assert.equal(reopened.isDestroyed(), true, 'Reloading the application cleans up its native website view');
        await js(`window.open(${JSON.stringify(website)})`);
        await wait(`document.querySelector('.website-status')?.textContent === ${JSON.stringify(website)}`);
        const beforeDialog = win.contentView.children.find((view) => view.webContents).webContents;
        await settings('integrations');
        assert.equal(beforeDialog.isDestroyed(), true, 'Website does not cover application dialogs');
        await done();
        await wait("!!document.querySelector('.website-view')");
        await open('Alpha.md');
        await wait("!document.querySelector('.website-view')");
        await settings('integrations');
        await toggle('embedWebsites', false);
        await done();
        await js(`window.open(${JSON.stringify(website)})`);
        await delay(100);
        assert.equal(externalUrls.pop(), website);
        assert.equal(await js("!!document.querySelector('.website-view')"), false);
        await settings('integrations');
        await toggle('embedWebsites', true);
        await done();
        await open('Beta.md');
        await settings();
        await toggle('showMarkdownExtension', true);
        await done();
        assert.equal(await js("document.querySelector('.tree-item[title=\"Alpha.md\"] .tree-label').textContent"), 'Alpha.md');
        assert.equal(await js("document.querySelector('.tab[title=\"Beta.md\"] .tab-label').textContent"), 'Beta.md');
        await settings();
        await toggle('showMarkdownExtension', false);
        await toggle('autoRelink', false);
        await done();
        await rename('Beta.md', 'Gamma');
        assert.equal(await fs.readFile(path.join(vault, 'Alpha.md'), 'utf8'), '# Alpha\n\n[[Beta]]\n');
        assert.equal(await fs.readFile(path.join(vault, 'Links.md'), 'utf8'), '[[Beta#Beta|alias]]');
        await settings();
        await toggle('autoRelink', true);
        await done();
        await rename('Gamma.md', 'Beta');
        await rename('Beta.md', 'Gamma');
        assert.match(await fs.readFile(path.join(vault, 'Alpha.md'), 'utf8'), /\[\[Gamma\]\]/);
        assert.match(await fs.readFile(path.join(vault, 'Links.md'), 'utf8'), /\[\[Gamma#Beta\|alias\]\]/);
        await wait("document.querySelector('.tab.active')?.getAttribute('title') === 'Gamma.md'");

        // Opt out of automatic tab cleanup, then remove and restore the active file externally.
        await settings();
        await toggle('closeMissingTabs', false);
        await done();
        const gamma = await fs.readFile(path.join(vault, 'Gamma.md'), 'utf8');
        await fs.unlink(path.join(vault, 'Gamma.md'));
        await click('.sidebar-header button[title="Refresh"]');
        await wait("document.querySelector('.empty-workspace')?.textContent.includes('no longer in the vault')");
        assert.equal(await js("!!document.querySelector('.tab[title=\"Gamma.md\"]')"), true);
        await fs.writeFile(path.join(vault, 'Gamma.md'), gamma);
        await button('.empty-workspace button', 'Reload vault');
        await wait("document.querySelector('.note-title')?.value === 'Gamma'");

        // Disabling persistence leaves its old snapshot untouched across reload and restores it on enable.
        await settings();
        await toggle('persistWorkspaceTabs', false);
        await done();
        const savedWorkspace = await js("Object.entries(localStorage).find(([key]) => key.startsWith('tabs:'))[1]");
        await click('.tab[title="Alpha.md"] .tab-close');
        await delay(150);
        assert.equal(await js("Object.entries(localStorage).find(([key]) => key.startsWith('tabs:'))[1]"), savedWorkspace);

        // Temporary tabs must not leak between vaults or create new persisted snapshots.
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [otherVault] });
        await click('.vault-switch');
        await wait("!!document.querySelector('.vault-manager-dialog')");
        await button('.vault-manager-dialog button', 'Add existing or create vault…');
        await wait(`document.querySelector('.sidebar-footer')?.title === ${JSON.stringify(otherVault)}`);
        await wait("document.querySelectorAll('.tab').length === 0");
        await wait("!!document.querySelector('.tree-item[title=\"Other.md\"]')");
        await open('Other.md');
        assert.equal(await js(`localStorage.getItem(${JSON.stringify('tabs:' + otherVault)})`), null);
        await settings();
        await toggle('persistWorkspaceTabs', true);
        await done();
        await wait("document.querySelector('.tab.active')?.getAttribute('title') === 'Other.md'");
        await wait(`!!localStorage.getItem(${JSON.stringify('tabs:' + otherVault)})`);
        await settings();
        await toggle('persistWorkspaceTabs', false);
        await done();
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [vault] });
        await click('.vault-switch');
        await wait("!!document.querySelector('.vault-manager-dialog')");
        await button('.vault-manager-dialog button', 'Add existing or create vault…');
        await wait(`document.querySelector('.sidebar-footer')?.title === ${JSON.stringify(vault)}`);
        await wait("document.querySelectorAll('.tab').length === 0");

        await settings('appearance');
        const css = '@media (min-width: 1px) { .sidebar { outline: 7px solid rgb(1, 2, 3) !important; } }';
        await setCss(css);
        await wait(`${cssText} === ${JSON.stringify(css)}`);
        await button('.custom-css-settings button', 'Apply CSS');
        await wait(`JSON.parse(localStorage.getItem('tagline-settings')).customCss === ${JSON.stringify(css)}`);
        assert.equal(await js("!!document.querySelector('#tagline-custom-css')"), false);
        await click('[data-setting="customCssEnabled"]');
        await wait("!!document.querySelector('.confirm-dialog')");
        await button('.confirm-dialog button', 'Cancel');
        assert.equal(await js("document.querySelector('[data-setting=\"customCssEnabled\"]').checked"), false);
        await click('[data-setting="customCssEnabled"]');
        await wait("!!document.querySelector('.confirm-dialog')");
        await button('.confirm-dialog button', 'Confirm');
        await wait("JSON.parse(localStorage.getItem('tagline-settings')).customCssEnabled === true");
        // Chromium rounds CSS border/outline widths to device pixels under Windows display scaling.
        await wait("Math.abs(parseFloat(getComputedStyle(document.querySelector('.sidebar')).outlineWidth) - 7) < 1");
        assert.equal(await js("getComputedStyle(document.querySelector('.sidebar')).outlineColor"), 'rgb(1, 2, 3)');
        await setCss('.sidebar { outline-width: 12px !important; }');
        assert.ok(await js("Math.abs(parseFloat(getComputedStyle(document.querySelector('.sidebar')).outlineWidth) - 7) < 1"));
        await button('.custom-css-settings button', 'Discard CSS edits');
        await wait(`${cssText} === ${JSON.stringify(css)}`);
        await done();
        await reload();
        await wait("document.querySelectorAll('.tab').length === 0");
        assert.ok(await js("Math.abs(parseFloat(getComputedStyle(document.querySelector('.sidebar')).outlineWidth) - 7) < 1"));
        assert.equal(await js(`localStorage.getItem(${JSON.stringify('tabs:' + vault)})`), savedWorkspace);
        await settings();
        await toggle('persistWorkspaceTabs', true);
        await done();
        await wait("document.querySelectorAll('.tab').length === 2");
        assert.equal(await js("document.querySelector('.tab.active').getAttribute('title')"), 'Gamma.md');
        await settings('appearance');
        await js(`(() => {
          const data = new DataTransfer();
          data.items.add(new File(['.sidebar { outline: 9px solid blue !important; }'], 'custom.css', {type: 'text/css'}));
          const el = document.querySelector('[aria-label="Import CSS file"]');
          el.files = data.files; el.dispatchEvent(new Event('change', {bubbles: true}));
        })()`);
        await wait(`${cssText}.includes('9px')`);
        await button('.custom-css-settings button', 'Apply CSS');
        await wait("Math.abs(parseFloat(getComputedStyle(document.querySelector('.sidebar')).outlineWidth) - 9) < 1");
        assert.equal(await js("getComputedStyle(document.querySelector('.sidebar')).outlineColor"), 'rgb(0, 0, 255)');
        await toggle('customCssEnabled', false);
        assert.equal(await js("!!document.querySelector('#tagline-custom-css')"), false);
        await button('.custom-css-settings button', 'Reset custom CSS');
        await wait(`${cssText} === ''`);
        await done();

        // Re-enabling cleanup prunes the active missing tab and activates a remaining tab.
        await settings();
        await toggle('closeMissingTabs', true);
        await done();
        await fs.unlink(path.join(vault, 'Gamma.md'));
        await click('.sidebar-header button[title="Refresh"]');
        await wait("!document.querySelector('.tab[title=\"Gamma.md\"]')");
        await wait("document.querySelector('.note-title')?.value === 'Alpha'");
        // In-app deletion still closes tabs when automatic external cleanup is disabled.
        await settings();
        await toggle('closeMissingTabs', false);
        await done();
        await js("document.querySelector('.tree-item[title=\"Alpha.md\"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))");
        await button('.context-menu button', 'Delete');
        await wait("!!document.querySelector('.confirm-dialog')");
        await button('.confirm-dialog button', 'Confirm');
        await wait("!document.querySelector('.tab[title=\"Alpha.md\"]')");
        server.close();
        console.log('PASS: notice dismissal/reset/reload, Pandoc install link, isolated embedded websites/navigation/resize/close/external toggle, extension labels, configurable relinking, missing tabs, dormant workspaces, and custom CSS.');
        app.exit(0);
      } catch (error) {
        console.error('FAIL:', error.stack);
        console.error('Vault files:', await fs.readdir(vault), 'UI:', await js(`({
          files: [...document.querySelectorAll('.tree-item')].map(el => el.title),
          toast: document.querySelector('.toast')?.textContent,
          prompt: document.querySelector('.dialog input')?.value,
          dialog: document.querySelector('.dialog')?.textContent
        })`));
        for (const view of win.contentView.children) {
          if (view.webContents) console.error('Website history:', view.webContents.navigationHistory.canGoBack(),
            view.webContents.navigationHistory.getActiveIndex(),
            view.webContents.navigationHistory.getAllEntries().map((entry) => entry.url));
        }
        app.exit(1);
      }
    });
  });
  require('../electron/main.cjs');
})().catch((error) => { console.error(error); app.exit(1); });
