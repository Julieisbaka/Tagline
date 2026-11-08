if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tagline-speech-'));
  try {
    const result = spawnSync(require('electron'), [__filename], {
      env: { ...process.env, TAGLINE_SPEECH_ROOT: root },
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

const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const temp = process.env.TAGLINE_SPEECH_ROOT;
  const vault = path.join(temp, 'vault');
  const userData = path.join(temp, 'userData');
  await fs.mkdir(vault);
  await fs.mkdir(userData);
  const prefix =
    '---\n# Keep these properties\ntitle: "Source cards"\ncustom:\n  choices: [one, two]\n---\n';
  await fs.writeFile(
    path.join(vault, 'Cards.md'),
    prefix + '# Cards\n\n#### Evidence tag\n**Author 24**\n==Warrant text==\n'
  );
  await fs.writeFile(path.join(userData, 'config.json'), JSON.stringify({ lastVault: vault }));
  app.setPath('userData', userData);
  const speech = path.join(vault, 'Speech_Docs', 'Speech.md');
  const exists = () => fs.readFile(speech, 'utf8').catch(() => null);

  app.on('browser-window-created', (_event, win) => {
    win.webContents.once('did-finish-load', async () => {
      const wc = win.webContents;
      const errors = [];
      wc.on('console-message', (e) => {
        if (e.level === 'error') {
          errors.push(e.message);
        }
      });
      const js = async (s) => {
        try {
          return await wc.executeJavaScript(s);
        } catch (error) {
          throw new Error(`Renderer script failed: ${s}`, { cause: error });
        }
      };
      const wait = async (s) => {
        for (let i = 0; i < 100; i++) {
          if (await js(s)) {
            return;
          }
          await delay(100);
        }
        throw new Error('Timed out: ' + s);
      };
      const waitFile = async (test) => {
        for (let i = 0; i < 50; i++) {
          const c = await exists();
          if (test(c)) {
            return c;
          }
          await delay(100);
        }
        throw new Error('Speech doc not written as expected: ' + JSON.stringify(await exists()));
      };
      const change = async (selector, value) => {
        await js(`(() => { const select = document.querySelector(${JSON.stringify(selector)});
          select.value = ${JSON.stringify(value)}; select.dispatchEvent(new Event('change', {bubbles: true})); })()`);
      };
      const reload = async () => {
        await new Promise((resolve) => {
          wc.once('did-finish-load', resolve);
          wc.reload();
        });
        await wait("!!document.querySelector('.tree-item')");
      };
      const open = async (name) => {
        await js(
          `document.querySelector(${JSON.stringify(`.tree-item[title="${name}"]`)}).click()`
        );
        await wait(
          `document.querySelector('.note-title')?.value === ${JSON.stringify(name.replace(/\.md$/, ''))}`
        );
      };
      const mark = async (name) => {
        await js(`document.querySelector(${JSON.stringify(`.tree-item[title="${name}"]`)}).dispatchEvent(
          new MouseEvent('contextmenu', {bubbles: true, clientX: 100, clientY: 140}))`);
        await wait("!!document.querySelector('.context-menu')");
        await js(
          "[...document.querySelectorAll('.context-menu button')].find(b => b.textContent === 'Set as speech doc').click()"
        );
      };
      try {
        await wait("!!document.querySelector('.onboarding-skip')");
        await js("document.querySelector('.onboarding-skip').click()");
        await wait("document.querySelectorAll('.tree-item').length === 1");
        assert.equal(await js("document.querySelectorAll('.ribbon button').length"), 8);
        assert.equal(
          await js('!!document.querySelector(\'.ribbon [title="Open speech doc"]\')'),
          false
        );
        await js("document.querySelector('.tree-item').click()");
        await wait("!!document.querySelector('.visual-document')");
        assert.equal(await js("!!document.querySelector('.source-fallback')"), false);
        assert.equal(
          await js("document.querySelector('.visual-document').textContent.includes('choices')"),
          false
        );
        assert.equal(
          await js(
            "document.querySelector('.note-properties [aria-label=\"YAML value for custom\"]').value.includes('choices')"
          ),
          true
        );
        await js(`(() => { const s = document.querySelector('.note-actions select'); s.value = 'edit';
          s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await wait("!!document.querySelector('.cm-content')");
        await js(`(() => { const line = [...document.querySelectorAll('.cm-line')].find(l => l.textContent.includes('Evidence'));
          const r = document.createRange(); r.setStart(line.firstChild, 1); r.collapse(true);
          const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
        await delay(200);
        await js('document.querySelector(\'.note-actions [title^="Send card"]\').click()');
        const initialSpeech = await waitFile((c) => c && c.includes('Warrant text'));
        assert.match(initialSpeech, /^---\nspeech: true\n---\n/);
        await wait(
          "document.querySelector('.sr-only[role=status]')?.textContent.includes('Sent to Speech')"
        );
        await js('document.querySelector(\'[title="Current speech document"]\').click()');
        await wait(
          "[...document.querySelectorAll('.tab')].some(t => t.textContent.includes('Speech'))"
        );
        await wait(
          "document.querySelector('.note-title')?.value === 'Speech' && !!document.querySelector('.visual-document')"
        );
        assert.equal(
          await js(
            "document.querySelector('.visual-document').textContent.includes('speech: true')"
          ),
          false
        );
        await fs.rm(speech);
        await wait(
          "![...document.querySelectorAll('.tree-item')].some(e => e.textContent.trim() === 'Speech')"
        );

        await js(
          "[...document.querySelectorAll('.tree-item')].find(e => e.textContent.trim() === 'Cards').click()"
        );
        await js(`(() => { const s = document.querySelector('.note-actions select'); s.value = 'visual';
          s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await wait("document.querySelector('.note-title')?.value === 'Cards'");
        await wait("!!document.querySelector('.visual-document')");
        await js(`(() => { const h = [...document.querySelectorAll('.visual-document h4')][0];
          const r = document.createRange(); r.setStart(h.firstChild, 2); r.collapse(true);
          const s = getSelection(); s.removeAllRanges(); s.addRange(r); h.closest('[contenteditable]').focus(); })()`);
        await delay(200);
        await js('document.querySelector(\'.note-actions [title^="Send card"]\').click()');
        await delay(200);
        await js(
          "[...document.querySelectorAll('.dialog button')].find(b => b.textContent === 'Confirm')?.click()"
        );
        const sent = await waitFile((c) => c && c.includes('Warrant text'));
        assert.match(sent, /#### Evidence tag\n+\*\*Author 24\*\*/);
        await js("document.querySelector('.visual-document').focus()");
        wc.sendInputEvent({
          type: 'keyDown',
          keyCode: 'End',
          modifiers: [process.platform === 'darwin' ? 'meta' : 'control'],
        });
        wc.sendInputEvent({
          type: 'keyUp',
          keyCode: 'End',
          modifiers: [process.platform === 'darwin' ? 'meta' : 'control'],
        });
        await wc.insertText(' Added text');
        await wait("document.querySelector('.visual-document').textContent.includes('Added text')");
        for (let i = 0; i < 100; i++) {
          if ((await fs.readFile(path.join(vault, 'Cards.md'), 'utf8')).includes('Added text')) {
            break;
          }
          await delay(50);
        }
        const savedCards = await fs.readFile(path.join(vault, 'Cards.md'), 'utf8');
        assert.ok(
          savedCards.startsWith(prefix),
          'visual edits preserve exact frontmatter, including comments and quotes'
        );
        assert.ok(savedCards.includes('Added text'));
        await change('.note-actions select', 'read');
        await wait("!!document.querySelector('.preview')");
        assert.equal(
          await js("document.querySelector('.preview').textContent.includes('choices')"),
          false
        );
        await change('.note-actions select', 'visual');
        await wait("!!document.querySelector('.visual-document')");

        await fs.writeFile(
          path.join(vault, 'Imported.md'),
          '---\nspeech: true\nowner: Imported\n---\n# Imported speech\n'
        );
        await fs.writeFile(
          path.join(vault, 'Legacy.md'),
          '---\n# Keep me\nowner: "Original"\n---\n# Existing speech\n'
        );
        const broken = '---\nspeech: [\n---\n# Broken metadata\n';
        await fs.writeFile(path.join(vault, 'Broken.md'), broken);
        await reload();
        await js("document.querySelector('.ribbon-settings-button').click()");
        await wait("!!document.querySelector('[data-setting=speechDoc]')");
        const choices = await js(
          "[...document.querySelector('[data-setting=speechDoc]').options].map(o => o.value)"
        );
        assert.ok(
          choices.includes('Imported.md'),
          'copied documents are discovered by their marker'
        );
        assert.equal(choices.includes('Legacy.md'), false, 'unmarked files are not discovered');
        await change('[data-setting=speechDoc]', 'Imported.md');
        await wait(
          "JSON.parse(localStorage.getItem('tagline-settings')).speechDoc === 'Imported.md'"
        );
        await js("document.querySelector('.settings-close').click()");
        await open('Cards.md');
        await wait("!!document.querySelector('.visual-document h4')");
        await js(`(() => { const h = document.querySelector('.visual-document h4');
          const r = document.createRange(); r.setStart(h.firstChild, 1); r.collapse(true);
          const s = getSelection(); s.removeAllRanges(); s.addRange(r); h.closest('[contenteditable]').focus(); })()`);
        await js('document.querySelector(\'.note-actions [title^="Send card"]\').click()');
        let imported;
        for (let i = 0; i < 100; i++) {
          imported = await fs.readFile(path.join(vault, 'Imported.md'), 'utf8');
          if (imported.includes('Warrant text')) {
            break;
          }
          await delay(50);
        }
        assert.ok(imported.includes('Warrant text'), 'send-card uses the selected marked document');
        assert.equal(await exists(), sent, 'other marked documents do not receive the card');
        await mark('Legacy.md');
        await wait(
          "JSON.parse(localStorage.getItem('tagline-settings')).speechDoc === 'Legacy.md'"
        );
        const legacy = await fs.readFile(path.join(vault, 'Legacy.md'), 'utf8');
        assert.match(legacy, /speech: true/);
        assert.match(legacy, /# Keep me/);
        assert.match(legacy, /owner: "Original"/);
        assert.ok(
          legacy.endsWith('# Existing speech\n'),
          'designation preserves the existing body'
        );
        await mark('Broken.md');
        await wait(
          "document.querySelector('.toast')?.textContent.includes('Invalid YAML frontmatter')"
        );
        assert.equal(
          await js("JSON.parse(localStorage.getItem('tagline-settings')).speechDoc"),
          'Legacy.md'
        );
        assert.equal(await fs.readFile(path.join(vault, 'Broken.md'), 'utf8'), broken);
        await open('Broken.md');
        await wait(
          "!!document.querySelector('.source-fallback') && !!document.querySelector('.cm-content')"
        );
        assert.equal(
          await js("!!document.querySelector('[role=alert]')"),
          true,
          'invalid metadata has an explicit error'
        );
        await reload();
        assert.equal(
          await js("JSON.parse(localStorage.getItem('tagline-settings')).speechDoc"),
          'Legacy.md'
        );
        await js('document.querySelector(\'[title="Current speech document"]\').click()');
        await wait("document.querySelector('.note-title')?.value === 'Legacy'");
        await fs.mkdir(path.join(vault, 'Templates'));
        await fs.writeFile(
          path.join(vault, 'Templates', 'Context.md'),
          '\n\nPATH={{path}}\nBODY={{content}}\nPROPERTIES={{properties}}\nEND\n'
        );
        await reload();
        await open('Legacy.md');
        await wait("!!document.querySelector('.visual-document')");
        const beforeTemplate = await fs.readFile(path.join(vault, 'Legacy.md'), 'utf8');
        const choosePalette = async (label) => {
          await wait(
            `!![...document.querySelectorAll('.palette-item')].find(el => el.querySelector('span')?.textContent === ${JSON.stringify(label)})`
          );
          await js(
            `[...document.querySelectorAll('.palette-item')].find(el => el.querySelector('span')?.textContent === ${JSON.stringify(label)}).click()`
          );
        };
        await js("document.querySelector('.ribbon [data-ribbon-item=commands]').click()");
        await choosePalette('Insert template at cursor');
        await choosePalette('Context');
        let templated;
        for (let i = 0; i < 100; i++) {
          templated = await fs.readFile(path.join(vault, 'Legacy.md'), 'utf8');
          if (templated.includes('PATH=Legacy.md')) {
            break;
          }
          await delay(50);
        }
        assert.ok(templated.includes('PATH=Legacy.md'));
        assert.ok(
          templated.includes('Existing speech'),
          'target body is available to the template'
        );
        assert.ok(templated.includes('PROPERTIES='), 'target YAML is available to the template');
        assert.equal(
          templated.split('---')[1],
          beforeTemplate.split('---')[1],
          'template insertion preserves the target frontmatter'
        );
        await js("document.querySelector('.ribbon [data-ribbon-item=commands]').click()");
        await choosePalette('Create new note from template');
        await choosePalette('Context');
        await wait("!!document.querySelector('.dialog input')");
        await js(
          "document.querySelector('.dialog input').focus(); document.querySelector('.dialog input').select()"
        );
        await wc.insertText('Created Target');
        await js(
          "[...document.querySelectorAll('.dialog button')].find(b => b.textContent === 'OK').click()"
        );
        await wait("document.querySelector('.note-title')?.value === 'Created Target'");
        const newNote = await fs.readFile(path.join(vault, 'Created Target.md'), 'utf8');
        assert.ok(newNote.includes('PATH=Created Target.md'));
        assert.ok(
          newNote.includes('BODY=\nPROPERTIES=\nEND'),
          'new-note body and properties start empty'
        );
        await js(`(() => {
          window.micStopped = 0;
          window.voiced = false;
          const track = { stop() { window.micStopped++; }, addEventListener() {} };
          window.stream = { getTracks: () => [track], getAudioTracks: () => [track] };
          Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
            getUserMedia: () => new Promise(resolve => { window.resolveMic = resolve; })
          }});
          window.AudioContext = class {
            sampleRate = 48000;
            createMediaStreamSource() { return { connect() {} }; }
            createAnalyser() { return { fftSize: 2048, frequencyBinCount: 1024,
              getFloatTimeDomainData(a) { a.fill(window.voiced ? 0.1 : 0); },
              getFloatFrequencyData(a) { a.fill(-120); a.fill(-10, 5, 10); }
            }; }
            resume() { return Promise.resolve(); }
            close() { return Promise.resolve(); }
          };
          document.querySelector('.panel-tabs [title="Timer"]').click();
        })()`);
        const auto = '.timer-auto-start button';
        await js(`document.querySelector('${auto}').click()`);
        await wait(
          "window.resolveMic && document.querySelector('.timer-auto-start button').getAttribute('aria-pressed') === 'true'"
        );
        await js(`document.querySelector('${auto}').click(); window.resolveMic(window.stream);`);
        await wait('window.micStopped === 1');
        assert.equal(
          await js("document.querySelector('.timer-controls .primary').textContent"),
          'Start'
        );
        await js(`document.querySelector('${auto}').click(); window.resolveMic(window.stream);`);
        await delay(400);
        assert.equal(
          await js("document.querySelector('.timer-controls .primary').textContent"),
          'Start',
          'silence does not trigger'
        );
        await js('window.voiced = true');
        await wait("document.querySelector('.timer-controls .primary').textContent === 'Pause'");
        assert.equal(await js('window.micStopped'), 2);
        assert.equal(
          await js(`document.querySelector('${auto}').getAttribute('aria-pressed')`),
          'false'
        );
        await js(
          "[...document.querySelectorAll('.timer-controls button')].find(b => b.textContent === 'Next').click()"
        );
        await delay(500);
        assert.equal(
          await js("document.querySelector('.timer-controls .primary').textContent"),
          'Start',
          'next speech does not start automatically'
        );
        assert.equal(await js('window.micStopped'), 2);
        await wait("!!document.querySelector('.visual-document p')");
        await js(`(() => {
          const p = [...document.querySelectorAll('.visual-document p')].find(e => e.textContent.includes('Created Target'));
          p.closest('[contenteditable]').focus();
          const range = document.createRange(); range.selectNodeContents(p);
          const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        })()`);
        await delay(100);
        await js("document.querySelector('[data-editor-action=mark-card]').click()");
        await wait("!!document.querySelector('.visual-document [data-card-marker]')");
        await js(`(() => {
          const p = [...document.querySelectorAll('.visual-document p')].find(e => e.textContent.includes('Created Target'));
          p.closest('[contenteditable]').focus();
          const range = document.createRange(); range.selectNodeContents(p);
          const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        })()`);
        await delay(100);
        await js("document.querySelector('[data-editor-action=mark-card]').click()");
        assert.equal(
          await js("document.querySelectorAll('.visual-document [data-card-marker]').length"),
          2,
          'visual toolbar refuses nested markers'
        );
        await change('.note-actions select', 'edit');
        await wait("!!document.querySelector('.cm-content')");
        const marked = await js(
          "[...document.querySelectorAll('.cm-line')].map(e => e.textContent).join('\\n')"
        );
        assert.match(
          marked,
          /<!-- card:start -->[\s\S]*<!-- card:end -->/,
          'visual toolbar writes marker pair'
        );
        await js("document.querySelector('.cm-content').focus()");
        wc.sendInputEvent({
          type: 'keyDown',
          keyCode: 'End',
          modifiers: [process.platform === 'darwin' ? 'meta' : 'control'],
        });
        wc.sendInputEvent({
          type: 'keyUp',
          keyCode: 'End',
          modifiers: [process.platform === 'darwin' ? 'meta' : 'control'],
        });
        await wc.insertText('\n\nOther evidence');
        await wait(
          "[...document.querySelectorAll('.cm-line')].some(e => e.textContent === 'Other evidence')"
        );
        await js(`(() => {
          const line = [...document.querySelectorAll('.cm-line')].find(e => e.textContent === 'Other evidence');
          const range = document.createRange(); range.selectNodeContents(line);
          const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
          document.querySelector('.cm-content').focus();
        })()`);
        await delay(100);
        await js("document.querySelector('[data-editor-action=mark-card]').click()");
        await wait(
          "[...document.querySelectorAll('.cm-line')].filter(e => e.textContent.includes('<!-- card:start -->')).length === 2"
        );
        await js(`(() => {
          const line = [...document.querySelectorAll('.cm-line')].find(e => e.textContent === 'Other evidence');
          const range = document.createRange(); range.selectNodeContents(line);
          const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
          document.querySelector('.cm-content').focus();
        })()`);
        await delay(100);
        await js("document.querySelector('[data-editor-action=mark-card]').click()");
        assert.equal(
          await js(
            "[...document.querySelectorAll('.cm-line')].filter(e => e.textContent.includes('<!-- card:start -->')).length"
          ),
          2,
          'source toolbar refuses nested markers'
        );
        assert.deepEqual(errors, []);
        console.log(
          'PASS: YAML survives visual edits, speech files are discovered/selected/marked, invalid metadata is preserved, and source/visual send-card saves persist.'
        );
        app.exit(0);
      } catch (e) {
        console.error('FAIL:', e.stack || e);
        app.exit(1);
      }
    });
  });
  require('../electron/main.cjs');
})();
