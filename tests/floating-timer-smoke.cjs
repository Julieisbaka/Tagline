if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tagline-floating-timer-'));
  try {
    const result = spawnSync(require('electron'), [__filename], {
      env: { ...process.env, TAGLINE_FLOATING_TIMER_ROOT: root },
      stdio: 'inherit',
      timeout: 120000,
    });
    if (result.error) {
      throw result.error;
    }
    process.exitCode = result.status ?? 1;
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
  return;
}

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const root = process.env.TAGLINE_FLOATING_TIMER_ROOT;
  const vault = path.join(root, 'vault');
  const profile = path.join(root, 'profile');
  await fs.mkdir(vault);
  await fs.mkdir(profile);
  await fs.writeFile(path.join(vault, 'Note.md'), '# Note\n');
  await fs.writeFile(
    path.join(profile, 'config.json'),
    JSON.stringify({ lastVault: vault, modelAutoload: false })
  );
  app.setPath('userData', profile);
  app.setPath('sessionData', profile);
  let main;
  app.on('browser-window-created', (_event, win) => {
    if (main) {
      return;
    }
    main = win;
    win.webContents.once('did-finish-load', async () => {
      const js = (code) => win.webContents.executeJavaScript(code);
      const wait = async (condition) => {
        for (let i = 0; i < 100; i++) {
          const value = await condition();
          if (value) {
            return value;
          }
          await delay(50);
        }
        throw new Error('Timed out waiting for timer state');
      };
      const overlay = () =>
        BrowserWindow.getAllWindows().find((window) => window !== win && window.isVisible());
      try {
        await wait(() => js("!!document.querySelector('.onboarding-skip')"));
        await js("document.querySelector('.onboarding-skip').click()");
        await wait(() => js("!!document.querySelector('.ribbon-settings-button')"));
        await js("document.querySelector('.ribbon-settings-button').click()");
        await wait(() => js("!!document.querySelector('[data-setting=timerFloatingWindow]')"));
        await js("document.querySelector('[data-setting=timerFloatingWindow]').click()");
        await wait(() =>
          js("JSON.parse(localStorage.getItem('tagline-settings')).timerFloatingWindow === true")
        );
        await js(
          "document.querySelector('.settings-close').click(); document.querySelector('.panel-tabs [title=Timer]').click()"
        );
        await js(`Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
          getUserMedia: () => new Promise(() => {})
        }}); document.querySelector('.timer-auto-start button').click()`);
        let floating = await wait(overlay);
        assert.equal(floating.isAlwaysOnTop(), true);
        await wait(
          async () =>
            (await floating.webContents.executeJavaScript(
              "document.querySelector('#status').textContent"
            )) === 'Armed'
        );
        win.minimize();
        assert.equal(floating.isVisible(), true);
        win.restore();
        await js("document.querySelector('.timer-auto-start button').click()");
        await wait(() => floating.isDestroyed());
        await js("document.querySelector('.timer-controls .primary').click()");
        floating = await wait(overlay);
        await wait(
          async () =>
            (await floating.webContents.executeJavaScript(
              "document.querySelector('#status').textContent"
            )) === 'Running'
        );
        win.minimize();
        const before = await floating.webContents.executeJavaScript(
          "document.querySelector('#time').textContent"
        );
        await delay(1600);
        const after = await floating.webContents.executeJavaScript(
          "document.querySelector('#time').textContent"
        );
        assert.notEqual(after, before, 'timer continues to update while minimized');
        assert.equal(floating.isVisible(), true);
        win.restore();
        await js("document.querySelector('.timer-controls .primary').click()");
        await wait(() => floating.isDestroyed());
        console.log('PASS: floating timer stays visible and updates while app is minimized.');
        app.exit(0);
      } catch (error) {
        console.error(error);
        app.exit(1);
      }
    });
  });
  require('../electron/main.cjs');
})().catch((error) => {
  console.error(error);
  app.exit(1);
});
