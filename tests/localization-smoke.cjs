if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tagline-localization-'));
  try {
    for (const locale of ['es-MX', 'fr-CA', 'ja-JP', 'saved-en']) {
      const profile = path.join(root, locale);
      fs.mkdirSync(profile);
      if (locale === 'saved-en') {
        const vault = path.join(profile, 'vault');
        fs.mkdirSync(path.join(vault, '.tagline'), { recursive: true });
        fs.writeFileSync(
          path.join(vault, '.tagline', 'vault.json'),
          JSON.stringify({ version: require('../electron/vaultMigrations.cjs').migrations.length })
        );
        fs.writeFileSync(path.join(vault, 'Note.md'), '# Note');
        fs.writeFileSync(
          path.join(profile, 'config.json'),
          JSON.stringify({ lastVault: vault, modelAutoload: false })
        );
      }
      const result = spawnSync(require('electron'), [__filename], {
        env: { ...process.env, TAGLINE_LOCALE_PROFILE: profile, TAGLINE_TEST_LOCALE: locale },
        stdio: 'inherit',
        timeout: 40000,
      });
      if (result.error) {
        throw result.error;
      }
      if (result.status !== 0) {
        process.exitCode = result.status ?? 1;
        break;
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
  return;
}

const { app } = require('electron');
const assert = require('node:assert/strict');
const locale = process.env.TAGLINE_TEST_LOCALE;
app.setPath('userData', process.env.TAGLINE_LOCALE_PROFILE);
app.getPreferredSystemLanguages = () => [locale === 'saved-en' ? 'fr-FR' : locale];
app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', async () => {
    const js = (code) => win.webContents.executeJavaScript(code);
    const wait = require('./helpers/wait.cjs').rendererWait(js);
    try {
      await wait("!!document.querySelector('.onboarding-dialog')");
      if (locale === 'saved-en') {
        await js("document.querySelector('.onboarding-skip').click()");
        await wait("!!document.querySelector('.ribbon-settings-button')");
        await js("document.querySelector('.ribbon-settings-button').click()");
        await wait("!!document.querySelector('.settings')");
        await js("document.querySelector('[data-section=appearance]').click()");
        await js(`(() => {
          const language = document.querySelector('[data-setting=language]');
          language.value = 'en'; language.dispatchEvent(new Event('change', {bubbles: true}));
        })()`);
        await wait("document.documentElement.lang === 'en'");
        await js("document.querySelector('.settings-close').click()");
        await wait("!document.querySelector('.settings')");
        await js(`(() => {
          const saved = JSON.parse(localStorage.getItem('tagline-settings'));
          saved.format = 'policy';
          localStorage.setItem('tagline-settings', JSON.stringify(saved));
        })()`);
        await new Promise((resolve) => {
          win.webContents.once('did-finish-load', resolve);
          win.webContents.reload();
        });
      }
      const expected = { 'es-MX': 'es', 'fr-CA': 'fr', 'ja-JP': 'en', 'saved-en': 'en' }[locale];
      await wait(`document.documentElement.lang === '${expected}'`);
      if (locale !== 'saved-en') {
        const title = await js("document.querySelector('#onboarding-title').textContent");
        assert.equal(
          title,
          {
            es: 'Te damos la bienvenida a Tagline',
            fr: 'Bienvenue dans Tagline',
            en: 'Welcome to Tagline',
          }[expected]
        );
      } else {
        await wait("!!document.querySelector('.ribbon-settings-button')");
      }
      assert.equal(
        await js("JSON.parse(localStorage.getItem('tagline-settings')).language"),
        expected
      );
      assert.equal(
        await js("JSON.parse(localStorage.getItem('tagline-settings')).format"),
        locale === 'saved-en' ? 'policy' : 'highschool',
        'unsupported old values are not migrated'
      );
      console.log(`PASS first-run language: ${locale} -> ${expected}`);
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
});
require('../electron/main.cjs');
