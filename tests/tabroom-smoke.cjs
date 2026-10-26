const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

if (!process.versions.electron) {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tagline-tabroom-smoke-'));
  try {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
      env: { ...process.env, TAGLINE_TABROOM_ROOT: root }, stdio: 'inherit', timeout: 90000,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
  return;
}

const { app, BrowserWindow, session, dialog } = require('electron');
const root = process.env.TAGLINE_TABROOM_ROOT;
assert.ok(root, 'Run through Node after building.');
const profile = path.join(root, 'profile');
const vault = path.join(root, 'vault');
fs.mkdirSync(profile);
fs.mkdirSync(vault);
fs.writeFileSync(path.join(vault, 'Keep.md'), '# Test');
fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify({ lastVault: vault, modelAutoload: false }));
app.setPath('userData', profile);
const backup = { id: 123, name: '<img src=x onerror=window.attacked=true>', events: [{ name: 'Policy' }],
  schools: [], description: 'x'.repeat(45000) };
const raw = JSON.stringify(backup) + '\n';
const destination = path.join(root, 'tournament.json');
let requests = 0;
let loginWindows = 0;
const fromPartition = session.fromPartition.bind(session);
session.fromPartition = (name, ...args) => {
  const isolated = fromPartition(name, ...args);
  if (name === 'persist:tabroom') isolated.fetch = async (url, options) => {
    requests++;
    assert.equal(url, 'https://www.tabroom.com/api/download_data.mhtml?tourn_id=123');
    assert.equal(options.credentials, 'include');
    if (requests === 2) return new Response('<html>Unavailable</html>');
    return new Response(raw);
  };
  return isolated;
};
dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
const loadURL = BrowserWindow.prototype.loadURL;
BrowserWindow.prototype.loadURL = async function (url, ...args) {
  if (url !== 'https://www.tabroom.com/user/login/login.mhtml') return loadURL.call(this, url, ...args);
  loginWindows++;
  const preferences = this.webContents.getLastWebPreferences();
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.preload, undefined);
  await loadURL.call(this, 'about:blank');
  await this.webContents.session.cookies.set({
    url: 'https://www.tabroom.com', name: 'mock-session', value: 'private-session',
    secure: true, httpOnly: true, expirationDate: Date.now() / 1000 + 1000,
  });
  this.close();
};
app.on('browser-window-created', (_event, win) => {
  if (win.getTitle().startsWith('Sign in to Tabroom')) return;
  win.webContents.once('did-finish-load', async () => {
    const js = (code) => win.webContents.executeJavaScript(code);
    const wait = async (code) => {
      for (let i = 0; i < 200; i++) {
        if (await js(code)) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`Timed out: ${code}`);
    };
    const click = async (label, scope = '.tabroom-dialog') => {
      const expression = `[...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`;
      await wait(`!!(${expression})`);
      await js(`(${expression}).click()`);
    };
    const input = async (value) => js(`(() => {
      const input=document.querySelector('.tabroom-field input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
      input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    try {
      await wait("!!document.querySelector('.onboarding-skip')");
      await js("document.querySelector('.onboarding-skip').click()");
      await wait("!!document.querySelector('.ribbon-settings-button')");
      await js("document.querySelector('.ribbon-settings-button').click()");
      await click('Integrations', '.settings');
      await click('Open Tabroom', '.settings');
      await wait("!!document.querySelector('.tabroom-dialog')");
      await input('123');
      await click('Load tournament');
      await wait("!!document.querySelector('.tabroom-json')");
      assert.equal(await js("document.querySelector('.tabroom-dialog h4').textContent"), backup.name);
      assert.equal(await js("!!window.attacked || !!document.querySelector('.tabroom-dialog img')"), false);
      await click('Next');
      await wait("document.querySelector('.tabroom-dialog').textContent.includes('Page 2 of 3')");
      await click('Previous');
      await wait("document.querySelector('.tabroom-dialog').textContent.includes('Page 1 of 3')");
      await click('Save tournament JSON');
      await wait("document.querySelector('.tabroom-dialog').textContent.includes('Saved tournament JSON:')");
      assert.equal(fs.readFileSync(destination, 'utf8'), raw);
      assert.equal(requests, 1);
      await click('Load tournament');
      await wait("document.querySelector('.tabroom-dialog [role=alert]')?.textContent.includes('valid JSON')");
      assert.equal(await js("!!document.querySelector('.tabroom-json')"), false);
      await click('Sign in on Tabroom');
      await wait("[...document.querySelectorAll('.tabroom-dialog button')].some(b=>b.textContent==='Clear Tabroom session'&&!b.disabled)");
      assert.equal(loginWindows, 1);
      assert.deepEqual(await js('window.api.tabroom.status()'), { hasSession: true });
      await click('Load tournament');
      await wait("!!document.querySelector('.tabroom-json')");
      await click('Clear Tabroom session');
      await wait("document.querySelector('.tabroom-dialog').textContent.includes('No Tabroom browser session saved')");
      assert.equal(await js("!!document.querySelector('.tabroom-json')"), false);
      assert.deepEqual(await js('window.api.tabroom.status()'), { hasSession: false });
      await click('Close');
      await wait("!document.querySelector('.tabroom-dialog')");
      console.log('PASS Tabroom UI: settings entry, public fetch, safe JSON, paging, exact export, errors, isolated login and session clearing.');
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
});
require('../electron/main.cjs');
