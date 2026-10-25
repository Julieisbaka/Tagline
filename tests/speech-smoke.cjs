const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-speech-'));
  const vault = path.join(temp, 'vault');
  const userData = path.join(temp, 'userData');
  await fs.mkdir(vault);
  await fs.mkdir(userData);
  await fs.writeFile(path.join(vault, 'Cards.md'), '# Cards\n\n#### Evidence tag\n**Author 24**\n==Warrant text==\n');
  await fs.writeFile(path.join(userData, 'config.json'), JSON.stringify({ lastVault: vault }));
  app.setPath('userData', userData);
  const speech = path.join(vault, 'Speech_Docs', 'Speech.md');
  const exists = () => fs.readFile(speech, 'utf8').catch(() => null);

  app.on('browser-window-created', (_event, win) => {
    win.webContents.once('did-finish-load', async () => {
      const wc = win.webContents;
      const errors = [];
      wc.on('console-message', (e) => { if (e.level === 'error') errors.push(e.message); });
      const js = (s) => wc.executeJavaScript(s);
      const wait = async (s) => {
        for (let i = 0; i < 100; i++) { if (await js(s)) return; await delay(100); }
        throw new Error('Timed out: ' + s);
      };
      const waitFile = async (test) => {
        for (let i = 0; i < 50; i++) { const c = await exists(); if (test(c)) return c; await delay(100); }
        throw new Error('Speech doc not written as expected: ' + JSON.stringify(await exists()));
      };
      try {
        await wait("!!document.querySelector('.onboarding-skip')");
        await js("document.querySelector('.onboarding-skip').click()");
        await wait("document.querySelectorAll('.tree-item').length === 1");
        assert.equal(await js("document.querySelectorAll('.ribbon button').length"), 8);
        assert.equal(await js("!!document.querySelector('.ribbon [title=\"Open speech doc\"]')"), false);
        await js("document.querySelector('.tree-item').click()");
        await wait("!!document.querySelector('.visual-document')");
        await js(`(() => { const s = document.querySelector('.note-actions select'); s.value = 'edit';
          s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await wait("!!document.querySelector('.cm-content')");
        await js(`(() => { const line = [...document.querySelectorAll('.cm-line')].find(l => l.textContent.includes('Evidence'));
          const r = document.createRange(); r.setStart(line.firstChild, 1); r.collapse(true);
          const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
        await delay(200);
        await js("document.querySelector('.note-actions [title^=\"Send card\"]').click()");
        await waitFile((c) => c && c.includes('Warrant text'));
        await js("document.querySelector('[title=\"Current speech document\"]').click()");
        await wait("[...document.querySelectorAll('.tab')].some(t => t.textContent.includes('Speech'))");
        await fs.rm(speech);

        await js("[...document.querySelectorAll('.tree-item')].find(e => e.textContent.trim() === 'Cards').click()");
        await js(`(() => { const s = document.querySelector('.note-actions select'); s.value = 'visual';
          s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await wait("document.querySelector('.note-title')?.value === 'Cards'");
        await wait("!!document.querySelector('.visual-document')");
        await js(`(() => { const h = [...document.querySelectorAll('.visual-document h4')][0];
          const r = document.createRange(); r.setStart(h.firstChild, 2); r.collapse(true);
          const s = getSelection(); s.removeAllRanges(); s.addRange(r); h.closest('[contenteditable]').focus(); })()`);
        await delay(200);
        await js("document.querySelector('.note-actions [title^=\"Send card\"]').click()");
        const sent = await waitFile((c) => c && c.includes('Warrant text'));
        assert.match(sent, /#### Evidence tag\n+\*\*Author 24\*\*/);
        assert.deepEqual(errors, []);
        console.log('PASS: source and visual send-card buttons write cards; status bar opens the speech doc.');
        app.exit(0);
      } catch (e) {
        console.error('FAIL:', e.stack || e);
        app.exit(1);
      } finally {
        await fs.rm(temp, { recursive: true, force: true }).catch(() => { });
      }
    });
  });
  require('../electron/main.cjs');
})();
