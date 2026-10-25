if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tagline-localization-'));
  try {
    for (const locale of ['es-MX', 'fr-CA', 'ja-JP', 'saved-en']) {
      const profile = path.join(root, locale);
      fs.mkdirSync(profile);
      const result = spawnSync(require('electron'), [__filename], {
        env: { ...process.env, TAGLINE_LOCALE_PROFILE: profile, TAGLINE_TEST_LOCALE: locale },
        stdio: 'inherit', timeout: 40000,
      });
      if (result.error) throw result.error;
      if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
    }
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
  return;
}

const { app } = require('electron');
const assert = require('node:assert/strict');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const locale = process.env.TAGLINE_TEST_LOCALE;
app.setPath('userData', process.env.TAGLINE_LOCALE_PROFILE);
app.getPreferredSystemLanguages = () => [locale === 'saved-en' ? 'fr-FR' : locale];
app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', async () => {
    const js = (code) => win.webContents.executeJavaScript(code);
    const wait = async (code) => {
      for (let i = 0; i < 200; i++) { if (await js(code)) return; await delay(50); }
      throw new Error(`Timed out: ${code}`);
    };
    try {
      await wait("!!document.querySelector('.onboarding-dialog')");
      if (locale === 'saved-en') {
        await js(`localStorage.setItem('tagline-settings', JSON.stringify({language: 'en'}))`);
        await new Promise((resolve) => {
          win.webContents.once('did-finish-load', resolve);
          win.webContents.reload();
        });
        await wait("!!document.querySelector('.onboarding-dialog')");
      }
      const expected = { 'es-MX': 'es', 'fr-CA': 'fr', 'ja-JP': 'en', 'saved-en': 'en' }[locale];
      await wait(`document.documentElement.lang === '${expected}'`);
      const title = await js("document.querySelector('#onboarding-title').textContent");
      assert.equal(title, {
        es: 'Te damos la bienvenida a Tagline', fr: 'Bienvenue dans Tagline', en: 'Welcome to Tagline',
      }[expected]);
      assert.equal(await js("JSON.parse(localStorage.getItem('tagline-settings')).language"), expected);
      console.log(`PASS first-run language: ${locale} -> ${expected}`);
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
});
require('../electron/main.cjs');
