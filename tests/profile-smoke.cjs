const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tagline-profile-'));
  try {
    const result = spawnSync(require('electron'), [__filename], {
      env: { ...process.env, TAGLINE_PROFILE_ROOT: root }, stdio: 'inherit', timeout: 60000,
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
  return;
}

const { app, dialog } = require('electron');
const root = process.env.TAGLINE_PROFILE_ROOT;
if (!root) throw new Error('Run this test through Node or npm run test:profile.');
const legacy = path.join(root, 'debate-vault');
const profile = path.join(root, 'Tagline');
const vault = path.join(root, 'vault');
const sampleParent = path.join(root, 'sample-parent');
fs.mkdirSync(vault, { recursive: true });
fs.mkdirSync(sampleParent, { recursive: true });
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [sampleParent] });
fs.mkdirSync(path.join(legacy, 'semantic-search'), { recursive: true });
const config = JSON.stringify({ lastVault: vault, modelAutoload: false });
fs.writeFileSync(path.join(legacy, 'config.json'), config);
fs.writeFileSync(path.join(legacy, 'semantic-search', 'huggingface-token.bin'), 'old-profile-only');
app.setPath('appData', root);
app.setPath('userData', profile);

app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', async () => {
    const js = (code) => win.webContents.executeJavaScript(code);
    const wait = async (code) => {
      for (let i = 0; i < 100; i++) {
        if (await js(code)) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('Timed out: ' + code);
    };
    try {
      assert.equal(await js('window.api.getLastVault()'), null);
      assert.equal(fs.existsSync(path.join(profile, 'config.json')), false);
      assert.equal(fs.existsSync(path.join(profile, 'semantic-search')), false);
      assert.equal(fs.readFileSync(path.join(legacy, 'config.json'), 'utf8'), config);
      assert.equal(fs.readFileSync(path.join(legacy, 'semantic-search', 'huggingface-token.bin'), 'utf8'), 'old-profile-only');
      await js("localStorage.removeItem('tagline-settings'); localStorage.setItem('debate-vault-settings', JSON.stringify({ wpm: 499, fontFamily: 'Legacy Font' }))");
      await new Promise((resolve) => {
        win.webContents.once('did-finish-load', resolve);
        win.webContents.reload();
      });
      await wait("!!localStorage.getItem('tagline-settings')");
      const settings = await js("JSON.parse(localStorage.getItem('tagline-settings'))");
      assert.equal(settings.wpm, 250);
      assert.equal(settings.fontFamily, '');
      assert.equal(await js("JSON.parse(localStorage.getItem('debate-vault-settings')).wpm"), 499);
      await wait("!!document.querySelector('.welcome') && !!document.querySelector('.onboarding-dialog')");
      assert.equal(settings.internalFlags.hasSeenOnboarding, false);
      await js("document.querySelector('.onboarding-skip').click()");
      await wait("!document.querySelector('.onboarding-dialog')");
      assert.equal(await js("JSON.parse(localStorage.getItem('tagline-settings')).internalFlags.hasSeenOnboarding"), true);
      assert.equal(await js("!!document.querySelector('.welcome')"), true, 'tour leaves vault choice to the user');
      assert.equal(await js('window.api.getLastVault()'), null, 'tour never creates a vault');
      await new Promise((resolve) => {
        win.webContents.once('did-finish-load', resolve);
        win.webContents.reload();
      });
      await wait("!!document.querySelector('.welcome') && !!localStorage.getItem('tagline-settings')");
      assert.equal(await js("!!document.querySelector('.onboarding-dialog')"), false, 'dismissal persists without a vault');
      await js(`(() => {
        const settings = JSON.parse(localStorage.getItem('tagline-settings'));
        settings.internalFlags.hasSeenOnboarding = false;
        localStorage.setItem('tagline-settings', JSON.stringify(settings));
      })()`);
      await new Promise((resolve) => {
        win.webContents.once('did-finish-load', resolve);
        win.webContents.reload();
      });
      await wait("!!document.querySelector('.onboarding-dialog')");
      await js("document.querySelector('.onboarding-dialog .primary').click()");
      await wait("document.querySelector('.onboarding-progress').textContent.includes('Step 2 of 3')");
      await js("document.querySelector('.onboarding-dialog .primary').click()");
      await wait("document.querySelector('.onboarding-progress').textContent.includes('Step 3 of 3')");
      await wait("!!document.querySelector('.onboarding-start-actions')");
      await js(`[...document.querySelectorAll('.onboarding-start-actions button')]
        .find(button => button.textContent.includes('Create sample vault')).click()`);
      await wait("!!document.querySelector('.tree-item[title=\"Welcome.md\"]')");
      assert.equal(fs.existsSync(path.join(sampleParent, 'Tagline Sample Vault', 'Welcome.md')), true,
        'sample-vault action from onboarding creates and opens the sample');
      assert.equal(await js("JSON.parse(localStorage.getItem('tagline-settings')).internalFlags.hasSeenOnboarding"), true);
      console.log('PASS: legacy profiles stay untouched; first-run onboarding dismissal persists and sample-vault action works.');
      app.exit(0);
    } catch (e) {
      console.error('FAIL:', e.stack || e);
      app.exit(1);
    }
  });
});
require('../electron/main.cjs');
