if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tagline-accessibility-'));
  try {
    const result = spawnSync(require('electron'), [__filename], {
      env: { ...process.env, TAGLINE_A11Y_ROOT: root }, stdio: 'inherit', timeout: 120000,
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); }
  return;
}

const { app } = require('electron');
const fs = require('node:fs/promises'), path = require('node:path');
const assert = require('node:assert/strict');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const root = process.env.TAGLINE_A11Y_ROOT;
  const profile = path.join(root, 'profile'), vault = path.join(root, 'vault');
  await fs.mkdir(profile, { recursive: true });
  await fs.mkdir(vault);
  await fs.writeFile(path.join(vault, 'Card.md'), '#### Claim\n\nEvidence to find and replace.\n');
  await fs.writeFile(path.join(profile, 'config.json'), JSON.stringify({ lastVault: vault, modelAutoload: false }));
  app.setPath('userData', profile);
  app.on('browser-window-created', (_event, win) => {
    win.webContents.once('did-finish-load', async () => {
      const wc = win.webContents;
      const js = (code) => wc.executeJavaScript(code);
      const wait = async (code) => {
        for (let i = 0; i < 100; i++) { if (await js(code)) return; await delay(50); }
        throw new Error(`Timed out: ${code}`);
      };
      const key = async (keyCode, modifiers = []) => {
        wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
        wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
        await delay(30);
      };
      const primary = process.platform === 'darwin' ? 'meta' : 'control';
      const checkTabLoop = async (selector) => {
        await js(`(() => {
          const root = document.querySelector(${JSON.stringify(selector)});
          const controls = [...root.querySelectorAll('button, input, select, textarea, [tabindex]')]
            .filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
          controls.at(-1).focus();
          window.expectedFirst = controls[0];
          window.expectedLast = controls.at(-1);
        })()`);
        await key('Tab');
        assert.equal(await js('document.activeElement === window.expectedFirst'), true, `${selector} wraps Tab`);
        await key('Tab', ['shift']);
        assert.equal(await js('document.activeElement === window.expectedLast'), true, `${selector} wraps Shift+Tab`);
      };
      const change = async (selector, value) => {
        await js(`(() => {
          const select = document.querySelector(${JSON.stringify(selector)});
          select.value = ${JSON.stringify(value)};
          select.dispatchEvent(new Event('change', { bubbles: true }));
        })()`);
        await delay(30);
      };
      try {
        await wait('!!document.querySelector(\'.tree-item[title="Card.md"]\')');
        await js('document.querySelector(\'.tree-item[title="Card.md"]\').click()');
        await wait("!!document.querySelector('.visual-document')");
        const visualActions = await js("[...document.querySelectorAll('[data-editor-action]')].map(el => el.dataset.editorAction)");
        await js("document.querySelector('.ribbon-settings-button').focus(); document.querySelector('.ribbon-settings-button').click()");
        await wait("!!document.querySelector('.settings')");
        await checkTabLoop('.settings');
        assert.equal(await js("!!document.querySelector('.ribbon').closest('[inert]')"), true, 'background is inert');
        await js("document.querySelector('.visual-document').focus()");
        assert.equal(await js("!!document.activeElement.closest('.modal-backdrop')"), true, 'background cannot steal focus');
        wc.debugger.attach('1.3');
        const tree = await wc.debugger.sendCommand('Accessibility.getFullAXTree');
        assert.ok(tree.nodes.some((node) => !node.ignored && node.role?.value === 'dialog'), 'dialog is exposed to assistive technology');
        assert.equal(tree.nodes.some((node) => !node.ignored && node.name?.value === 'Visual note editor'), false,
          'covered editor is absent from the accessibility tree');
        await js('document.querySelector(\'[data-section="appearance"]\').click()');
        await js('document.querySelector(\'.ribbon-settings button[data-direction="down"]\').click()');
        await delay(30);
        assert.deepEqual(await js("[...document.querySelectorAll('.ribbon-settings input[data-ribbon-item]:checked')].map(el => el.dataset.ribbonItem)"),
          await js("[...document.querySelectorAll('.ribbon [data-ribbon-item]')].map(el => el.dataset.ribbonItem)"),
          'settings rows follow the displayed sidebar order');
        await change('[data-setting="theme"]', 'light');
        assert.equal(await js("document.documentElement.classList.contains('theme-transition')"), true, 'theme fade is active');
        await delay(250);
        assert.equal(await js("document.documentElement.classList.contains('theme-transition')"), false, 'theme fade cleans up');
        await wc.debugger.sendCommand('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
        });
        await change('[data-setting="theme"]', 'dark');
        assert.equal(await js("document.documentElement.classList.contains('theme-transition')"), false, 'reduced motion disables fade');
        await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
        await js('document.querySelector(\'[data-setting="themeTransition"]\').click()');
        await change('[data-setting="theme"]', 'light');
        assert.equal(await js("document.documentElement.classList.contains('theme-transition')"), false, 'fade preference is respected');
        assert.equal(await js("JSON.parse(localStorage.getItem('tagline-settings')).themeTransition"), false, 'fade preference persists');
        await key('Escape');
        await wait("!document.querySelector('.settings')");
        assert.equal(await js("document.activeElement.matches('.ribbon-settings-button')"), true, 'closing restores focus');
        assert.equal(await js("document.querySelectorAll('[inert]').length"), 0, 'closing clears inert state');
        await js(`(() => {
          const source = document.querySelector('.ribbon [data-ribbon-item="rightPanel"]');
          const target = document.querySelector('.ribbon [data-ribbon-item]');
          const dataTransfer = new DataTransfer();
          source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
          target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
          source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
        })()`);
        await delay(50);
        assert.equal(await js("document.querySelector('.ribbon [data-ribbon-item]').dataset.ribbonItem"), 'rightPanel',
          'clock shortcut moves to the first position');
        await js("document.querySelector('.note-title').focus()");
        await js(`document.querySelector('.tree-item[title="Card.md"]').dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, clientX: 100, clientY: 100,
        }))`);
        await wait("!!document.querySelector('.context-menu')");
        await checkTabLoop('.context-menu');
        await key('Escape');
        await wait("!document.querySelector('.context-menu')");
        assert.equal(await js("document.activeElement.matches('.note-title')"), true, 'context menu restores focus');
        await key('P', [primary]);
        await wait("!!document.querySelector('.palette')");
        await checkTabLoop('.palette');
        await key('Escape');
        await wait("!document.querySelector('.palette')");
        for (const mode of ['visual', 'edit']) {
          await change('[aria-label="Editor mode"]', mode);
          const editor = mode === 'visual' ? '.visual-document' : '.editor .cm-content';
          await wait(`!!document.querySelector('${editor}')`);
          assert.deepEqual(await js("[...document.querySelectorAll('[data-editor-action]')].map(el => el.dataset.editorAction)"),
            visualActions, 'editors expose the same toolbar actions');
          await js("document.querySelector('[data-editor-action=pocket]').focus()");
          await key('ArrowRight');
          assert.equal(await js("document.activeElement.dataset.editorAction"), 'hat', 'toolbar supports arrow keys');
          await js(`document.querySelector('${editor}').focus()`);
          assert.equal(await js(`document.querySelector('${editor}').getAttribute('aria-multiline')`), 'true');
          await key('F', [primary]);
          await wait("!!document.querySelector('.visual-find')");
          await checkTabLoop('.visual-find');
          await js('document.querySelector(\'.visual-find [aria-label="Find text"]\').focus()');
          const focusStyle = await js(`(() => {
            const style = getComputedStyle(document.activeElement);
            return { outline: style.outlineStyle, shadow: style.boxShadow };
          })()`);
          assert.equal(focusStyle.shadow, 'none', 'find input has no second focus ring');
          assert.equal(focusStyle.outline, 'solid', 'find input retains a visible focus ring');
          await key('Escape');
          await wait("!document.querySelector('.visual-find')");
          assert.equal(await js(`document.activeElement.matches('${editor}')`), true, 'find returns focus to the editor');
          await js("document.querySelector('[data-editor-action=link]').click()");
          await wait("!!document.querySelector('.visual-link-form')");
          await checkTabLoop('.visual-link-form');
          await key('Escape');
          await wait("!document.querySelector('.visual-link-form')");
        }
        assert.equal(await js("document.querySelectorAll('[inert]').length"), 0);
        wc.debugger.detach();
        console.log('PASS accessibility: focus scopes, sidebar ordering, theme fade, and editor parity');
        app.exit(0);
      } catch (error) { console.error(error.stack || error); app.exit(1); }
    });
  });
  require('../electron/main.cjs');
})().catch((error) => { console.error(error); app.exit(1); });
