const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tagline-installation-'));
  try {
    for (const version of ['1.0.0', '1.1.0']) {
      const installed = path.join(root, version, 'dist');
      fs.cpSync(path.join(__dirname, '..', 'dist'), installed, { recursive: true });
      const result = spawnSync(require('electron'), [__filename], {
        env: { ...process.env, TAGLINE_INSTALLATION_ROOT: root, TAGLINE_INSTALLATION_VERSION: version },
        stdio: 'inherit', timeout: 60000,
      });
      if (result.error) throw result.error;
      assert.equal(result.status, 0, `Installation launch ${version} failed`);
    }
    console.log('PASS: simulated version/location upgrade preserves profile, settings, tabs, extensions, models, credentials and vault history.');
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
  return;
}

const { app, BrowserWindow, safeStorage, ipcMain, shell } = require('electron');
const root = process.env.TAGLINE_INSTALLATION_ROOT;
assert.ok(root, 'Run through npm run test:installation after building.');
const version = process.env.TAGLINE_INSTALLATION_VERSION;
const first = version === '1.0.0';
const profile = path.join(root, 'Tagline');
const vault = path.join(root, 'vault');
const openedUrls = [];
shell.openExternal = async (url) => { openedUrls.push(url); };
const handle = ipcMain.handle.bind(ipcMain);
let releaseCalls = 0;
ipcMain.handle = (channel, callback) => handle(channel, channel === 'app:checkUpdates' ? async () => {
  releaseCalls++;
  if (releaseCalls === 2) throw new Error('Simulated GitHub rate limit');
  return { currentVersion: version, latestVersion: 'v9.0.0', updateAvailable: true };
} : callback);
app.setPath('appData', root);
app.setPath('userData', profile);
// Exercise packaged version reporting without requiring an installer inside the test harness.
Object.defineProperty(app, 'isPackaged', { value: true });
app.getVersion = () => version;
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, ...args) {
  return loadFile.call(this, file === path.join(__dirname, '..', 'dist', 'index.html')
    ? path.join(root, version, 'dist', 'index.html') : file, ...args);
};
if (first) {
  fs.mkdirSync(vault, { recursive: true });
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(vault, 'Card.md'), '# Saved evidence\n\nKeep this note.\n');
  fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify({
    lastVault: vault, modelAutoload: false, upgradeSentinel: { keep: true },
  }));
}

app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', async () => {
    const js = (code) => win.webContents.executeJavaScript(code);
    const wait = async (code) => {
      for (let i = 0; i < 150; i++) {
        if (await js(code)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`Timed out: ${code}`);
    };
    try {
      await wait("!!document.querySelector('.onboarding-skip') || JSON.parse(localStorage.getItem('tagline-settings'))?.internalFlags.hasSeenOnboarding");
      await js("document.querySelector('.onboarding-skip')?.click()");
      await wait("!!document.querySelector('.tree-item[title=\"Card.md\"]')");
      assert.equal(app.getName(), 'Tagline');
      const info = await js('window.api.getInstallationInfo()');
      assert.equal(info.version, version);
      assert.equal(info.packaged, true);
      assert.equal(info.profile, profile);
      assert.equal(info.arch, process.arch);
      assert.equal(info.electron, process.versions.electron);
      if (first) {
        const created = await js(`Promise.all(Array.from({ length: 8 }, (_, i) =>
          window.api.create('Concurrent.md', 'Note ' + i)))`);
        assert.equal(new Set(created).size, created.length, 'Concurrent note creation must use distinct filenames');
        for (const [index, file] of created.entries()) {
          assert.equal(fs.readFileSync(path.join(vault, file), 'utf8'), `Note ${index}`);
          fs.unlinkSync(path.join(vault, file));
        }
        const folders = await js(`Promise.all(Array.from({ length: 8 }, () => window.api.mkdir('Concurrent folder', true)))`);
        assert.equal(new Set(folders).size, folders.length, 'Concurrent folder creation must use distinct paths');
        for (const folder of folders) fs.rmdirSync(path.join(vault, folder));
        const disk = require('node:fs/promises');
        const writeFile = disk.writeFile;
        const card = path.join(vault, 'Card.md');
        const original = fs.readFileSync(card, 'utf8');
        disk.writeFile = async (file, ...args) => {
          if (file === card || path.basename(file).startsWith('.tagline-save-')) {
            await writeFile(file, 'Partial write', ...args.slice(1));
            throw Object.assign(new Error('Simulated disk full'), { code: 'ENOSPC' });
          }
          return writeFile(file, ...args);
        };
        try { await assert.rejects(js("window.api.write('Card.md', 'Unsaved edit')"), /disk full/); }
        finally { disk.writeFile = writeFile; }
        assert.equal(fs.readFileSync(card, 'utf8'), original, 'Failed saves must not truncate the original note');
        assert.equal(fs.readdirSync(vault).some((file) => file.startsWith('.tagline-save-')), false,
          'Failed saves clean up temporary files');
        const defaults = require('../src/lib/defaultSettings.json');
        const settings = {
          ...defaults, internalFlags: { ...defaults.internalFlags, hasSeenOnboarding: true }, wpm: 333, theme: 'high-contrast-dark', modelAutoload: false,
          customCss: '.note-title { font-weight: 600; }', keybindings: { settings: 'Mod+,' },
          themeSettings: { dark: { customOption: 'saved' } }
        };
        await js(`localStorage.setItem('tagline-settings', ${JSON.stringify(JSON.stringify(settings))});
          localStorage.setItem('tagline-extension:upgrade-test', '{"saved":"extension data"}');
          localStorage.setItem(${JSON.stringify(`tabs:${vault}`)}, ${JSON.stringify(JSON.stringify({
          tabs: [{ id: 'saved-card', kind: 'file', path: 'Card.md' }], activeId: 'saved-card',
        }))});`);
        const retained = {
          'extensions/upgrade-test/manifest.json': JSON.stringify({
            manifestVersion: 1, id: 'upgrade-test', name: 'Upgrade test', version: '1.0.0', main: 'main.js',
          }),
          'extensions/upgrade-test/main.js': '// Saved extension\n',
          'semantic-search/models/keep.bin': 'cached model bytes',
        };
        for (const [file, text] of Object.entries(retained)) {
          fs.mkdirSync(path.dirname(path.join(profile, file)), { recursive: true });
          fs.writeFileSync(path.join(profile, file), text);
        }
        const encrypted = await safeStorage.isAsyncEncryptionAvailable();
        const credential = encrypted ? await safeStorage.encryptStringAsync('upgrade-test-token') : Buffer.from('sentinel');
        fs.writeFileSync(path.join(profile, 'credential-preservation.bin'), credential);
        await js("window.api.write('Card.md', '# Saved evidence\\n\\nUpdated before upgrade.\\n', 50)");
        fs.writeFileSync(path.join(root, 'expected.json'), JSON.stringify({
          settings, retained, encrypted, credential: credential.toString('base64'),
          history: await js("window.api.listHistory('Card.md')"),
        }));
      } else {
        const expected = JSON.parse(fs.readFileSync(path.join(root, 'expected.json'), 'utf8'));
        await wait("!!document.querySelector('.note-title')");
        const settings = await js("JSON.parse(localStorage.getItem('tagline-settings'))");
        for (const [key, value] of Object.entries(expected.settings)) assert.deepEqual(settings[key], value, key);
        assert.deepEqual(await js("JSON.parse(localStorage.getItem('tagline-extension:upgrade-test'))"), { saved: 'extension data' });
        assert.equal(await js("document.querySelector('.note-title').value"), 'Card');
        assert.equal(await js('document.documentElement.dataset.theme'), 'high-contrast-dark');
        for (const [file, text] of Object.entries(expected.retained))
          assert.equal(fs.readFileSync(path.join(profile, file), 'utf8'), text);
        assert.equal(fs.readFileSync(path.join(profile, 'credential-preservation.bin')).toString('base64'), expected.credential);
        if (expected.encrypted) {
          const decrypted = await safeStorage.decryptStringAsync(fs.readFileSync(path.join(profile, 'credential-preservation.bin')));
          assert.equal(decrypted.result, 'upgrade-test-token');
        }
        assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile, 'config.json'), 'utf8')).upgradeSentinel, { keep: true });
        assert.match(fs.readFileSync(path.join(vault, 'Card.md'), 'utf8'), /Updated before upgrade/);
        assert.deepEqual(await js("window.api.listHistory('Card.md')"), expected.history);
        assert.ok(expected.history.length > 0);
        await js("document.querySelector('.ribbon-settings-button').click()");
        await wait("!!document.querySelector('[data-section=installation]')");
        await js("document.querySelector('[data-section=installation]').click()");
        await wait("!!document.querySelector('.installation-details')");
        const displayed = await js("document.querySelector('.installation-settings').textContent");
        assert.ok(displayed.includes(version));
        assert.ok(displayed.includes(profile));
        assert.ok(displayed.includes('does not check for or install updates automatically'));
        assert.equal(releaseCalls, 0, 'opening settings never contacts GitHub automatically');
        await js("[...document.querySelectorAll('.installation-settings button')].find(el => el.textContent === 'Check for updates').click()");
        await wait("document.querySelector('.installation-settings [role=status]')?.textContent.includes('v9.0.0')");
        await js("[...document.querySelectorAll('.installation-settings button')].find(el => el.textContent === 'Check for updates').click()");
        await wait("document.querySelector('.installation-settings [role=alert]')?.textContent.includes('Simulated GitHub rate limit')");
        await js("[...document.querySelectorAll('.installation-settings button')].find(el => el.textContent === 'GitHub repository').click()");
        await js("[...document.querySelectorAll('.installation-settings button')].find(el => el.textContent === 'View releases').click()");
        assert.deepEqual(openedUrls, ['https://github.com/Julieisbaka/Tagline', 'https://github.com/Julieisbaka/Tagline/releases']);
        await assert.rejects(js("window.api.openProjectPage('https://example.com')"), /Unknown project page/);
        await js("document.querySelector('.installation-settings > button.danger').click()");
        await wait("!!document.querySelector('.uninstall-dialog')");
        const uninstallChoices = await js("document.querySelector('.uninstall-dialog').textContent");
        assert.ok(uninstallChoices.includes('Keep profile data'));
        assert.ok(uninstallChoices.includes('Remove profile data'));
        assert.ok(uninstallChoices.includes('vault files and revision history'));
        assert.equal(await js("document.querySelector('.uninstall-dialog input[type=radio]').checked"), true);
        await js("document.querySelector('.uninstall-dialog button').click()");
        await wait("!document.querySelector('.uninstall-dialog')");
      }
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
});
require(process.env.TAGLINE_INSTALLATION_APP
  ? path.join(process.env.TAGLINE_INSTALLATION_APP, 'electron', 'main.cjs')
  : '../electron/main.cjs');
