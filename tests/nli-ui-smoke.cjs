// UI check for the on-demand Political DEBATE hypothesis dialog.
// Without TAGLINE_NLI_MODEL it verifies nothing loads automatically; with a converted
// ONNX folder it also loads the model and analyzes a note through the UI.
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'tagline-nli-'));
  try {
    const result = spawnSync(require('electron'), [__filename], {
      env: { ...process.env, TAGLINE_NLI_ROOT: root }, stdio: 'inherit', timeout: 300000,
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
  return;
}

const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const root = process.env.TAGLINE_NLI_ROOT;
  if (!root) throw new Error('Run through npm run test:nli-ui.');
  const model = process.env.TAGLINE_NLI_MODEL ? path.resolve(process.env.TAGLINE_NLI_MODEL) : null;
  const profile = path.join(root, 'profile');
  const vault = path.join(root, 'vault');
  await fs.mkdir(profile, { recursive: true });
  await fs.mkdir(vault);
  await fs.writeFile(path.join(vault, 'Wage.md'), '# Minimum wage aff\n\n**Smith 24**\n\n' +
    '==The senator argued that raising the minimum wage would lift millions of families out of poverty.== ' +
    'She dismissed claims that it would cost jobs.\n');
  await fs.writeFile(path.join(profile, 'config.json'), JSON.stringify({
    lastVault: vault, modelAutoload: false, ...(model ? { nliModel: { folder: model } } : {}),
  }));
  app.setPath('userData', profile);

  app.on('browser-window-created', (_event, win) => {
    win.webContents.once('did-finish-load', async () => {
      const js = (code) => win.webContents.executeJavaScript(code);
      const wait = async (code, tries = 100) => {
        for (let i = 0; i < tries; i++) { if (await js(code)) return; await delay(100); }
        throw new Error(`Timed out: ${code}\n${await js("document.querySelector('.hypothesis-dialog')?.innerText")}`);
      };
      const button = (selector, text) => js(`(() => {
        const item = [...document.querySelectorAll(${JSON.stringify(selector)})].find(el => el.textContent.trim().startsWith(${JSON.stringify(text)}));
        if (!item) throw new Error('Missing button: ' + ${JSON.stringify(text)});
        item.click();
      })()`);
      try {
        await wait("!!document.querySelector('.onboarding-skip')");
        await js("document.querySelector('.onboarding-skip').click()");
        await wait("document.querySelectorAll('.tree-item').length === 1");
        await js(`document.querySelector('.tree-item[title="Wage.md"]').click()`);
        await wait("!!document.querySelector('.note-actions')");
        const before = await js('window.api.nliStatus()');
        assert.equal(before.ready, false, 'Model is not loaded automatically');
        assert.equal(before.busy, false);
        await button('.note-actions button', 'Hypothesis');
        await wait("!!document.querySelector('.hypothesis-dialog')");
        await wait("document.querySelector('.hypothesis-model')?.textContent.includes('not')");
        assert.equal(await js("document.querySelector('#hypothesis-run').disabled"), true, 'Analyze requires a loaded model');
        assert.equal((await js('window.api.nliStatus()')).ready, false, 'Opening the dialog does not load the model');
        await js(`(() => {
          const el = document.querySelector('.hypothesis-input textarea');
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, 'raising the minimum wage is good\\nraising the minimum wage is harmful');
          el.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
        await wait("document.querySelector('.hypothesis-dialog').innerText.includes('The author of this text believes raising the minimum wage is good.')");
        await assert.rejects(js("window.api.analyzeHypotheses({ premise: 'x', hypotheses: ['y'] })"), /Load the Political DEBATE model first/);
        if (model) {
          await button('.hypothesis-model button', 'Load model');
          await wait("document.querySelector('.hypothesis-model')?.textContent.includes('loaded') && !document.querySelector('.hypothesis-model')?.textContent.includes('not loaded')", 1200);
          await wait("!document.querySelector('#hypothesis-run').disabled");
          await js("document.querySelector('#hypothesis-run').click()");
          await wait("document.querySelectorAll('.hypothesis-result').length === 2", 1200);
          const scores = await js("[...document.querySelectorAll('.hypothesis-result meter')].map(m => m.value)");
          assert.ok(scores[0] > 0.5 && scores[1] < 0.5, `Stance scores ${scores}`);
          await button('.hypothesis-model button', 'Unload model');
          await wait("window.api.nliStatus().then(s => !s.ready)");
        }
        console.log(`PASS: on-demand hypothesis dialog${model ? ' with real model analysis' : ' (set TAGLINE_NLI_MODEL for inference)'}.`);
        app.exit(0);
      } catch (e) {
        console.error('FAIL:', e);
        app.exit(1);
      }
    });
  });
  require('../electron/main.cjs');
})().catch((e) => { console.error(e); app.exit(1); });
