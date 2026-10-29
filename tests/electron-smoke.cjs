const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');

const fixture = `# Test Pocket

#aff #blocks

## Test Hat

### Test Block

#### First card
**Author 24** - Credentials
Evidence with ++underlining++ and ==highlight== and **++emphasis++**.
Nested ==**++important++**== evidence.
[[Other#Section|Alias]]
![[Other|Embedded label]]

#### Second card
Evidence for the next card.

| Side | Speech |
| --- | --- |
| Aff | 1AC |

- [x] Read card
- [ ] Check cite
`;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'debate-electron-test-'));
  const vault = path.join(temp, 'vault');
  await fs.mkdir(vault);
  await fs.writeFile(path.join(vault, 'Cards.md'), fixture);
  await fs.writeFile(path.join(vault, 'Other.md'), '# Other\n\n## Section\n\nOther evidence.');
  await fs.writeFile(path.join(vault, 'Frontmatter.md'), '---\ntitle: Keep Me\n---\n# Note\n\nBody');
  await fs.writeFile(path.join(vault, 'Grid.md'), '# Grid\n#aff\n\nWind and solar energy require upgrades to the electric power grid and transmission lines.');
  await fs.writeFile(path.join(vault, 'Food.md'), '# Food\n#neg\n\nA recipe for chocolate brownies with flour and butter.');
  const userData = path.join(temp, 'userData');
  await fs.mkdir(userData);
  await fs.writeFile(path.join(userData, 'config.json'), JSON.stringify({ lastVault: vault }));
  if (process.env.TAGLINE_MODEL_CACHE) {
    await fs.cp(path.join(process.env.TAGLINE_MODEL_CACHE, 'models'),
      path.join(userData, 'semantic-search', 'models'), { recursive: true });
  }
  app.setPath('userData', userData);
  app.on('browser-window-created', (_e, win) => {
    win.webContents.once('did-finish-load', async () => {
      const wc = win.webContents;
      const errors = [];
      wc.on('console-message', (event) => {
        if (event.level === 'error') { errors.push(event.message); console.error('RENDERER', event.message); }
      });
      const js = (source) => wc.executeJavaScript(source);
      const waitFor = async (source) => {
        for (let i = 0; i < 100; i++) {
          if (await js(source)) return;
          await delay(100);
        }
        throw new Error('Timed out: ' + source);
      };
      const click = (selector, text) => js(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
          .find(e => e.textContent.trim() === ${JSON.stringify(text)});
        if (!el) throw new Error('Missing ${text}'); el.click();
      })()`);
      const mode = async (value) => {
        await js(`(() => { const el = document.querySelector('[aria-label="Editor mode"]');
          el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await delay(150);
      };
      const inputValue = async (selector, value) => js(`(() => {
        const input = document.querySelector(${JSON.stringify(selector)});
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      try {
        await waitFor("!!document.querySelector('.onboarding-skip')");
        await js("document.querySelector('.onboarding-skip').click()");
        await waitFor("document.querySelectorAll('.tree-item').length === 5");
        await click('.tree-item', 'Cards');
        await waitFor("!!document.querySelector('.visual-document')");
        assert.equal(await fs.readFile(path.join(vault, 'Cards.md'), 'utf8'), fixture, 'Opening visual mode must not rewrite markdown');
        assert.equal(await js("document.querySelectorAll('.visual-document h4').length"), 2);
        assert.equal(await js("document.querySelectorAll('.visual-document table').length"), 1);
        assert.deepEqual(await js(`(() => {
          let marks = [];
          document.querySelector('.visual-document').editor.state.doc.descendants(node => {
            if (node.text === 'important') marks = node.marks.map(m => m.type.name).sort();
          }); return marks;
        })()`), ['bold', 'highlight', 'underline']);
        assert.equal(await js("document.querySelector('[data-wiki-link]').textContent"), 'Alias');
        // Actual visual edit, then verify Markdown formatting and link preservation on disk.
        await js(`(() => { const ed = document.querySelector('.visual-document').editor;
          ed.commands.insertContentAt(ed.state.doc.content.size, '<p>Added visually.</p>'); })()`);
        await waitFor("window.api.read('Cards.md').then(text => text.includes('Added visually.'))");
        await js(`(() => { const ed = document.querySelector('.visual-document').editor;
          ed.state.doc.descendants((node, pos) => {
            if (node.text === 'Added visually.') ed.commands.setTextSelection({ from: pos, to: pos + node.text.length });
          }); })()`);
        await click('.visual-toolbar button', 'Highlight');
        await waitFor("window.api.read('Cards.md').then(text => text.includes('==Added visually.=='))");
        const saved = await fs.readFile(path.join(vault, 'Cards.md'), 'utf8');
        assert.match(saved, /Added visually\./);
        assert.match(saved, /==Added visually\.==/);
        assert.match(saved, /\+\+underlining\+\+/);
        assert.match(saved, /==highlight==/);
        assert.match(saved, /^#aff #blocks$/m);
        assert.match(saved, /\[\[Other#Section\|Alias\]\]/);
        assert.match(saved, /!\[\[Other\|Embedded label\]\]/);
        assert.match(saved, /\| Side\s*\| Speech/);
        assert.match(saved, /- \[x\] Read card/);
        // Source -> visual -> source must retain text and nested marks.
        await mode('edit');
        await waitFor("!!document.querySelector('.cm-content')");
        await mode('visual');
        await waitFor("!!document.querySelector('.visual-document')");
        const roundtrip = await js("document.querySelector('.visual-document').editor.getMarkdown()");
        assert.equal(roundtrip, saved);
        await js(`(() => { const ed = document.querySelector('.visual-document').editor;
          ed.commands.insertContentAt(ed.state.doc.content.size, '<p><strong>FindAlpha</strong> findalpha findalphabet FindAlpha.</p>');
        })()`);
        await waitFor("window.api.read('Cards.md').then(text => text.includes('findalphabet'))");
        const beforeSearch = await fs.readFile(path.join(vault, 'Cards.md'), 'utf8');
        await click('.visual-toolbar button', 'Find and replace');
        await inputValue('[aria-label="Find text"]', 'findalpha');
        await waitFor("document.querySelector('.visual-find [role=status]').textContent === '1 of 4'");
        assert.equal(await js("document.querySelectorAll('.find-and-replace-result').length"), 4);
        assert.equal(await fs.readFile(path.join(vault, 'Cards.md'), 'utf8'), beforeSearch);
        await js("document.querySelectorAll('.visual-find input[type=checkbox]')[0].click()");
        await waitFor("document.querySelector('.visual-find [role=status]').textContent === '1 of 2'");
        await js("document.querySelectorAll('.visual-find input[type=checkbox]')[0].click(); document.querySelectorAll('.visual-find input[type=checkbox]')[1].click()");
        await waitFor("document.querySelector('.visual-find [role=status]').textContent === '1 of 3'");
        await click('.visual-find button', 'Next match');
        await waitFor("document.querySelector('.visual-find [role=status]').textContent === '2 of 3'");
        await click('.visual-find button', 'Previous match');
        await inputValue('[aria-label="Replace with"]', 'Updated');
        await click('.visual-find button', 'Replace');
        await waitFor("window.api.read('Cards.md').then(text => text.includes('Updated'))");
        assert.equal(await js("[...document.querySelectorAll('.visual-document strong')].some(el => el.textContent === 'Updated')"), true);
        await waitFor("document.querySelector('.visual-find [role=status]').textContent.endsWith('of 2')");
        const beforeReplaceAll = await js("document.querySelector('.visual-document').editor.getMarkdown()");
        await delay(600);
        await click('.visual-find button', 'Replace all');
        await waitFor("document.querySelector('.visual-find [role=status]').textContent === '0 of 0'");
        assert.equal(await js("document.querySelector('.visual-document').textContent.match(/Updated/g).length"), 3);
        assert.match(await js("document.querySelector('.visual-document').editor.getMarkdown()"), /findalphabet/);
        await js("document.querySelector('.visual-document').editor.commands.undo()");
        await waitFor(`document.querySelector('.visual-document').editor.getMarkdown() === ${JSON.stringify(beforeReplaceAll)}`);
        await click('.visual-find button', 'Close find');
        assert.equal(await js("document.querySelectorAll('.find-and-replace-result').length"), 0);
        await js("document.querySelector('.visual-document').focus()");
        const primary = process.platform === 'darwin' ? 'meta' : 'control';
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'F', modifiers: [primary] });
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'F', modifiers: [primary] });
        await waitFor("!!document.querySelector('.visual-find')");
        await js("document.querySelector('[aria-label=\"Find text\"]').focus()");
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
        await waitFor("!document.querySelector('.visual-find')");
        console.log('PASS: Tiptap and CodeMirror find/replace UI, match options, navigation, replacements, undo and platform shortcut.');
        await mode('edit');
        await js("document.querySelector('.cm-content').focus()");
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'End', modifiers: ['control'] });
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'End', modifiers: ['control'] });
        await wc.insertText('\n\nSource mode addition. source mode addition. Source mode additions.');
        await waitFor("window.api.read('Cards.md').then(text => text.includes('Source mode addition.'))");
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'F', modifiers: [primary] });
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'F', modifiers: [primary] });
        await waitFor("!!document.querySelector('.visual-find')");
        await inputValue('[aria-label="Find text"]', 'Source mode addition');
        await waitFor("document.querySelector('.visual-find [role=status]').textContent === '1 of 3'");
        assert.equal(await js("document.querySelectorAll('.cm-searchMatch').length > 0"), true);
        await js("document.querySelectorAll('.visual-find input[type=checkbox]')[0].click()");
        await waitFor("document.querySelector('.visual-find [role=status]').textContent === '1 of 2'");
        await js("document.querySelectorAll('.visual-find input[type=checkbox]')[1].click()");
        await waitFor("document.querySelector('.visual-find [role=status]').textContent === '1 of 1'");
        await js("document.querySelectorAll('.visual-find input[type=checkbox]')[0].click()");
        await waitFor("document.querySelector('.visual-find [role=status]').textContent === '1 of 2'");
        await click('.visual-find button', 'Next match');
        await waitFor("document.querySelector('.visual-find [role=status]').textContent === '2 of 2'");
        await click('.visual-find button', 'Previous match');
        await waitFor("document.querySelector('.visual-find [role=status]').textContent === '1 of 2'");
        await inputValue('[aria-label="Replace with"]', 'Source mode replacement.');
        await click('.visual-find button', 'Replace');
        await waitFor("window.api.read('Cards.md').then(text => text.includes('Source mode replacement.'))");
        await waitFor("document.querySelector('.visual-find [role=status]').textContent.endsWith('of 1')");
        await click('.visual-find button', 'Replace all');
        await waitFor("document.querySelector('.visual-find [role=status]').textContent === '0 of 0'");
        await waitFor("window.api.read('Cards.md').then(text => text.split('Source mode replacement.').length === 3)");
        await click('.visual-find button', 'Close find');
        await waitFor("!document.querySelector('.visual-find')");
        assert.equal(await js("document.querySelectorAll('.cm-searchMatch').length"), 0);
        const sourceSaved = await fs.readFile(path.join(vault, 'Cards.md'), 'utf8');
        assert.match(sourceSaved, /Source mode replacement\./);
        assert.equal((sourceSaved.match(/Source mode replacement\./g) || []).length, 2);
        assert.match(sourceSaved, /Source mode additions\./);
        await mode('visual');
        assert.match(await js("document.querySelector('.visual-document').editor.getMarkdown()"), /Source mode replacement\./);
        if (process.env.TAGLINE_TEST_SCREENSHOT) {
          const image = await wc.capturePage();
          await fs.writeFile(process.env.TAGLINE_TEST_SCREENSHOT, image.toPNG());
        }
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'E', modifiers: ['control'] });
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'E', modifiers: ['control'] });
        await waitFor("!!document.querySelector('.preview')");
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'E', modifiers: ['control'] });
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'E', modifiers: ['control'] });
        await waitFor("!!document.querySelector('.visual-document')");
        // Send only the card under the visual cursor, not the following card.
        await js(`(() => { const ed = document.querySelector('.visual-document').editor;
          let found = false;
          ed.state.doc.descendants((node, pos) => {
            if (!found && node.isText && node.text.includes('Evidence with')) {
              ed.commands.setTextSelection(pos + 2); found = true;
            }
          }); ed.commands.focus(); })()`);
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'S', modifiers: ['control', 'shift'] });
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'S', modifiers: ['control', 'shift'] });
        await delay(800);
        const speech = await fs.readFile(path.join(vault, 'Speech_Docs', 'Speech.md'), 'utf8');
        assert.match(speech, /First card/);
        assert.doesNotMatch(speech, /Second card/);
        await click('.note-actions button', 'Export');
        await waitFor("!!document.querySelector('.export-dialog')");
        assert.deepEqual(await js("[...document.querySelectorAll('.export-dialog select option')].map(option => option.value)"),
          ['google-docs', 'docx', 'odt', 'rtf', 'html', 'epub', 'pdf']);
        await click('.export-dialog button', 'Close');
        await js(`document.querySelector('[title="Settings (Ctrl+,)"]').click()`);
        await waitFor("!!document.querySelector('.integration-settings')");
        assert.ok(await js("!!document.querySelector('.integration-settings input[type=password]')"));
        const modelButtons = "[...document.querySelectorAll('.integration-settings button')].map(b => b.textContent)";
        if (process.env.TAGLINE_MODEL_CACHE) {
          // A cached model loads automatically; Settings must not offer a download.
          await waitFor("window.api.embeddingStatus().then(s => s.ready)");
          await waitFor(`!${modelButtons}.some(t => /model/i.test(t))`);
          assert.equal((await js('window.api.embeddingStatus()')).downloaded, true);
        } else {
          await waitFor(`${modelButtons}.includes('Download model')`);
          assert.equal((await js('window.api.embeddingStatus()')).downloaded, false);
        }
        await click('.settings button', 'Done');
        // Optional integrations and token storage do not require Pandoc or a real token.
        const available = await js('window.api.pandocStatus()');
        assert.equal(typeof available.available, 'boolean');
        await js("window.api.saveHfToken('hf_DebateTestToken123')");
        const status = await js('window.api.embeddingStatus()');
        assert.equal(status.tokenConfigured, true);
        assert.equal('token' in status, false);
        const encrypted = await fs.readFile(path.join(userData, 'semantic-search', 'huggingface-token.bin'));
        assert.equal(encrypted.includes(Buffer.from('hf_DebateTestToken123')), false);
        await js("window.api.saveHfToken('')");
        if (process.env.TAGLINE_MODEL_CACHE) {
          const results = await js(`window.api.semanticSearch({
            query: 'clean electricity and transmission infrastructure',
            documents: {
              'Grid.md': 'Renewable wind and solar energy need electric grid upgrades.',
              'Food.md': 'A recipe for chocolate brownies with flour and butter.'
            }
          })`);
          assert.equal(results[0].path, 'Grid.md');
          assert.ok(results[0].score > results[1].score + 0.2);
          wc.sendInputEvent({ type: 'keyDown', keyCode: 'F', modifiers: ['control', 'shift'] });
          wc.sendInputEvent({ type: 'keyUp', keyCode: 'F', modifiers: ['control', 'shift'] });
          await waitFor("!!document.querySelector('.modal.search')");
          await js(`(() => {
            const input = document.querySelector('.search .palette-input');
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'tag:aff renewable electricity distribution');
            input.dispatchEvent(new Event('input', { bubbles: true }));
            const select = document.querySelector('[aria-label="Search mode"]');
            select.value = 'semantic'; select.dispatchEvent(new Event('change', { bubbles: true }));
          })()`);
          await delay(100);
          await click('.search-options button', 'Search by meaning');
          await waitFor("document.querySelectorAll('.search-result').length > 0");
          assert.match(await js("document.querySelector('.search-file').textContent"), /Grid/);
          assert.doesNotMatch(await js("document.querySelector('.search-results').textContent"), /Food\.md/);
          await js("document.querySelector('.search-line').click()");
          await waitFor("document.querySelector('.note-title')?.value === 'Grid'");
          assert.equal(await js("document.querySelector('[aria-label=\"Editor mode\"]').value"), 'edit');
          console.log('PASS: real CPU embedding inference through Electron IPC.');
        }
        await click('.tree-item', 'Frontmatter');
        await waitFor("!!document.querySelector('.source-fallback')");
        assert.ok(await js("!!document.querySelector('.cm-content')"));
        assert.match(await fs.readFile(path.join(vault, 'Frontmatter.md'), 'utf8'), /^---\ntitle: Keep Me/);
        assert.deepEqual(errors, []);
        console.log('PASS: Tiptap rendering, real visual edits, Markdown round trips, card sending, source fallback, Pandoc detection, encrypted token storage.');
      } catch (e) {
        console.error('Renderer errors:', errors);
        console.error('UI STATE', await js("({tab: document.querySelector('.tab.active')?.textContent, mode: document.querySelector('[aria-label=\"Editor mode\"]')?.value, modal: document.querySelector('.modal')?.outerHTML.slice(0, 600), text: document.body.innerText.slice(-500)})"));
        console.error(e);
        process.exitCode = 1;
      } finally {
        await fs.rm(path.join(temp, 'vault'), { recursive: true, force: true });
        await fs.rm(path.join(userData, 'semantic-search'), { recursive: true, force: true });
        app.exit(process.exitCode || 0);
      }
    });
  });
  require('../electron/main.cjs');
})().catch((e) => { console.error(e); process.exitCode = 1; app.quit(); });
