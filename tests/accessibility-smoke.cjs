if (!process.versions.electron) {
  process.exitCode = require('./helpers/smoke.cjs').runSmoke({
    script: __filename,
    prefix: 'tagline-accessibility-',
    rootEnv: 'TAGLINE_A11Y_ROOT',
  });
  return;
}

const { app } = require('electron');
const fs = require('node:fs/promises'),
  path = require('node:path');
const assert = require('node:assert/strict');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const root = process.env.TAGLINE_A11Y_ROOT;
  const profile = path.join(root, 'profile'),
    vault = path.join(root, 'vault');
  await fs.mkdir(profile, { recursive: true });
  await fs.mkdir(vault);
  await fs.mkdir(path.join(vault, '.tagline'), { recursive: true });
  await fs.writeFile(
    path.join(vault, '.tagline', 'vault.json'),
    JSON.stringify({ version: require('../electron/vaultMigrations.cjs').migrations.length })
  );
  await fs.writeFile(path.join(vault, 'Card.md'), '#### Claim\n\nEvidence to find and replace.\n');
  const importedNote =
    'Imported pocket\n===============\n\nImported hat\n------------\n\nEvidence.\n';
  await fs.writeFile(path.join(vault, 'Imported.md'), importedNote);
  await fs.writeFile(
    path.join(profile, 'config.json'),
    JSON.stringify({ lastVault: vault, modelAutoload: false })
  );
  app.setPath('userData', profile);
  app.on('browser-window-created', (_event, win) => {
    win.webContents.once('did-finish-load', async () => {
      const wc = win.webContents;
      const js = async (code) => {
        try {
          return await wc.executeJavaScript(code);
        } catch (error) {
          throw new Error(`Renderer script failed: ${code}`, { cause: error });
        }
      };
      const wait = require('./helpers/wait.cjs').rendererWait(js, {
        timeout: 5000,
        details: async () => `\nFocus: ${await js('document.activeElement.outerHTML')}`,
      });
      const key = async (keyCode, modifiers = []) => {
        wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
        wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
        await delay(30);
      };
      const primary = process.platform === 'darwin' ? 'meta' : 'control';
      const checkTabLoop = async (selector) => {
        const edge = (index) =>
          js(`(() => {
          const root = document.querySelector(${JSON.stringify(selector)});
          const controls = [...root.querySelectorAll('button, input, select, textarea, [tabindex]')]
            .filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
          return document.activeElement === controls.at(${index});
        })()`);
        await js(`(() => {
          const root = document.querySelector(${JSON.stringify(selector)});
          const controls = [...root.querySelectorAll('button, input, select, textarea, [tabindex]')]
            .filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
          controls.at(-1).focus();
        })()`);
        await key('Tab');
        assert.equal(await edge(0), true, `${selector} wraps Tab`);
        await key('Tab', ['shift']);
        assert.equal(await edge(-1), true, `${selector} wraps Shift+Tab`);
      };
      const checkAccessibleNames = async () => {
        const unnamed = await js(`(() => {
          const controls = [...document.querySelectorAll(
            'button, input, select, textarea, a[href], summary, [role=button], [role=link], [role=option], [role=tab], [contenteditable=true]'
          )].filter(element =>
            element.getClientRects().length &&
            !element.disabled &&
            !element.closest('[hidden], [inert]')
          );
          const hasName = element => {
            const labelledBy = (element.getAttribute('aria-labelledby') || '')
              .split(/\\s+/)
              .map(id => document.getElementById(id)?.textContent || '')
              .join(' ')
              .trim();
            return !!(
              element.getAttribute('aria-label')?.trim() ||
              labelledBy ||
              element.labels?.length ||
              element.getAttribute('title')?.trim() ||
              element.innerText?.trim() ||
              ((element.tagName === 'INPUT' && ['button', 'submit'].includes(element.type)) && element.value)
            );
          };
          const dialogs = [...document.querySelectorAll('[role=dialog], [role=alertdialog]')]
            .filter(element => element.getClientRects().length && !element.closest('[hidden], [inert]'))
            .filter(element => {
              const labelIds = (element.getAttribute('aria-labelledby') || '').split(/\\s+/);
              return !element.getAttribute('aria-label')?.trim() &&
                !labelIds.some(id => document.getElementById(id)?.textContent.trim());
            })
            .map(element => element.outerHTML.slice(0, 240));
          return {
            controls: controls.filter(element => !hasName(element)).map(element => element.outerHTML),
            dialogs,
          };
        })()`);
        assert.deepEqual(
          unnamed.controls,
          [],
          `interactive controls lack accessible names: ${unnamed.controls.join('\\n')}`
        );
        assert.deepEqual(
          unnamed.dialogs,
          [],
          `dialogs lack accessible names: ${unnamed.dialogs.join('\\n')}`
        );
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
        await require('./helpers/smoke.cjs').scenario(
          'onboarding accessibility and dismissal',
          async () => {
            // The tour can briefly appear before the last vault starts loading.
            // Wait for both the vault and the tour before testing its focus scope.
            await wait(
              "!!document.querySelector('.tree-item[title=\"Card.md\"]') && !!document.querySelector('.onboarding-skip')"
            );
            await checkAccessibleNames();
            await checkTabLoop('.onboarding-dialog');
            await key('Escape');
            await wait("!document.querySelector('.onboarding-dialog')");
            await wait('!!document.querySelector(\'.tree-item[title="Card.md"]\')');
          }
        );
        await require('./helpers/smoke.cjs').scenario(
          'deferred dialog failure and focus recovery',
          () => require('./interactions/deferred-dialog.cjs')(win)
        );
        await require('./helpers/smoke.cjs').scenario(
          'imported note outline in both editor modes',
          async () => {
            await wait('!!document.querySelector(\'.tree-item[title="Imported.md"]\')');
            await js('document.querySelector(\'.tree-item[title="Imported.md"]\').click()');
            await wait("!!document.querySelector('.visual-document')");
            await js('document.querySelector(\'.right-panel button[title="Outline"]\').click()');
            await wait("document.querySelectorAll('.outline-item').length === 2");
            const headings = () =>
              js("[...document.querySelectorAll('.outline-item')].map(item => item.textContent)");
            assert.deepEqual(
              await headings(),
              ['Imported pocket', 'Imported hat'],
              'visual editor outline'
            );
            await change('[aria-label="Editor mode"]', 'edit');
            await wait("!!document.querySelector('.editor .cm-content')");
            assert.deepEqual(
              await headings(),
              ['Imported pocket', 'Imported hat'],
              'source editor outline'
            );
            assert.equal(
              await fs.readFile(path.join(vault, 'Imported.md'), 'utf8'),
              importedNote,
              'outline does not rewrite the imported note'
            );
            await change('[aria-label="Editor mode"]', 'visual');
            await wait("!!document.querySelector('.visual-document')");
            await js('document.querySelector(\'.right-panel button[title="Outline"]\').click()');
          }
        );
        await wait('!!document.querySelector(\'.tree-item[title="Card.md"]\')');
        await js('document.querySelector(\'.tree-item[title="Card.md"]\').click()');
        await wait("!!document.querySelector('.visual-document')");
        await checkAccessibleNames();
        await js("document.querySelector('.visual-document').focus()");
        assert.equal(
          await js('getComputedStyle(document.activeElement).outlineStyle'),
          'solid',
          'visual editor has a keyboard focus indicator by default'
        );
        await change('[aria-label="Editor mode"]', 'edit');
        await wait("!!document.querySelector('.editor .cm-content')");
        await wait(
          "document.querySelector('[data-announcement=editor-mode]').textContent.includes('Source')"
        );
        await js("document.querySelector('.editor .cm-content').focus()");
        assert.equal(
          await js('getComputedStyle(document.activeElement).outlineStyle'),
          'solid',
          'source editor has a keyboard focus indicator by default'
        );
        await change('[aria-label="Editor mode"]', 'visual');
        await wait("!!document.querySelector('.visual-document')");
        await wait(
          "document.querySelector('[data-announcement=editor-mode]').textContent.includes('Visual')"
        );
        const visualActions = await js(
          "[...document.querySelectorAll('[data-editor-action]')].map(el => el.dataset.editorAction)"
        );
        await js(
          "document.querySelector('.ribbon-settings-button').focus(); document.querySelector('.ribbon-settings-button').click()"
        );
        await wait("!!document.querySelector('.settings')");
        await checkTabLoop('.settings');
        await checkAccessibleNames();
        await js("document.querySelector('[data-section=accessibility]').click()");
        await js("document.querySelector('[data-setting=editorFocusOutline]').click()");
        assert.equal(
          await js("JSON.parse(localStorage.getItem('tagline-settings')).editorFocusOutline"),
          true
        );
        assert.equal(
          await js("!!document.querySelector('.ribbon').closest('[inert]')"),
          true,
          'background is inert'
        );
        await js("document.querySelector('.visual-document').focus()");
        assert.equal(
          await js("!!document.activeElement.closest('.modal-backdrop')"),
          true,
          'background cannot steal focus'
        );
        wc.debugger.attach('1.3');
        const tree = await wc.debugger.sendCommand('Accessibility.getFullAXTree');
        assert.ok(
          tree.nodes.some((node) => !node.ignored && node.role?.value === 'dialog'),
          'dialog is exposed to assistive technology'
        );
        assert.equal(
          tree.nodes.some((node) => !node.ignored && node.name?.value === 'Visual note editor'),
          false,
          'covered editor is absent from the accessibility tree'
        );
        await js('document.querySelector(\'[data-section="appearance"]\').click()');
        assert.equal(
          await js("getComputedStyle(document.querySelector('[data-setting=theme]')).appearance"),
          'base-select',
          'dropdowns use the themed picker'
        );
        await js("document.querySelector('[data-setting=theme]').focus()");
        await wc.executeJavaScript(
          "document.querySelector('[data-setting=theme]').showPicker()",
          true
        );
        await wait("document.querySelector('[data-setting=theme]').matches(':open')");
        await key('Escape');
        assert.equal(
          await js("!!document.querySelector('.settings')"),
          true,
          'Escape closes the picker before its dialog'
        );
        await js(
          'document.querySelector(\'.ribbon-settings button[data-direction="down"]\').click()'
        );
        await delay(30);
        assert.deepEqual(
          await js(
            "[...document.querySelectorAll('.ribbon-settings input[data-ribbon-item]:checked')].map(el => el.dataset.ribbonItem)"
          ),
          await js(
            "[...document.querySelectorAll('.ribbon [data-ribbon-item]')].map(el => el.dataset.ribbonItem)"
          ),
          'settings rows follow the displayed sidebar order'
        );
        await change('[data-setting="theme"]', 'light');
        assert.equal(
          await js("document.documentElement.classList.contains('theme-transition')"),
          true,
          'theme fade is active'
        );
        await wait("!document.documentElement.classList.contains('theme-transition')");
        assert.equal(
          await js("document.documentElement.classList.contains('theme-transition')"),
          false,
          'theme fade cleans up'
        );
        await wc.debugger.sendCommand('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
        });
        await change('[data-setting="theme"]', 'dark');
        assert.equal(
          await js("document.documentElement.classList.contains('theme-transition')"),
          false,
          'reduced motion disables fade'
        );
        await wc.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
        await js('document.querySelector(\'[data-setting="themeTransition"]\').click()');
        await change('[data-setting="theme"]', 'light');
        assert.equal(
          await js("document.documentElement.classList.contains('theme-transition')"),
          false,
          'fade preference is respected'
        );
        assert.equal(
          await js("JSON.parse(localStorage.getItem('tagline-settings')).themeTransition"),
          false,
          'fade preference persists'
        );
        await key('Escape');
        await wait("!document.querySelector('.settings')");
        assert.equal(
          await js("document.activeElement.matches('.ribbon-settings-button')"),
          true,
          'closing restores focus'
        );
        assert.equal(
          await js("document.querySelectorAll('[inert]').length"),
          0,
          'closing clears inert state'
        );
        await js(`(() => {
          const source = document.querySelector('.ribbon [data-ribbon-item="rightPanel"]');
          const target = document.querySelector('.ribbon [data-ribbon-item]');
          const dataTransfer = new DataTransfer();
          source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
          target.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
          source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
        })()`);
        await delay(50);
        assert.equal(
          await js("document.querySelector('.ribbon [data-ribbon-item]').dataset.ribbonItem"),
          'rightPanel',
          'clock shortcut moves to the first position'
        );
        await js(`(() => {
          const items = document.querySelectorAll('.ribbon [data-ribbon-item]');
          const dataTransfer = new DataTransfer();
          items[0].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
          items[items.length - 1].dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
          items[0].dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
        })()`);
        await delay(50);
        assert.equal(
          await js(
            "[...document.querySelectorAll('.ribbon [data-ribbon-item]')].at(-1).dataset.ribbonItem"
          ),
          'rightPanel',
          'clock shortcut can also move down to the last position'
        );
        await js("document.querySelector('.note-title').focus()");
        await js(`document.querySelector('.tree-item[title="Card.md"]').dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, clientX: 100, clientY: 100,
        }))`);
        await wait("!!document.querySelector('.context-menu')");
        await checkTabLoop('.context-menu');
        await key('Escape');
        await wait("!document.querySelector('.context-menu')");
        assert.equal(
          await js("document.activeElement.matches('.note-title')"),
          true,
          'context menu restores focus'
        );
        await js(`document.querySelector('.tree-item[title="Card.md"]').dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true, clientX: 100, clientY: 100,
        }))`);
        await wait("!!document.querySelector('.context-menu')");
        await js(
          "[...document.querySelectorAll('.context-menu button')].find(button => button.textContent.trim() === 'Delete').click()"
        );
        await wait("!!document.querySelector('.confirm-dialog')");
        await checkTabLoop('.confirm-dialog');
        await checkAccessibleNames();
        await key('Escape');
        await wait("!document.querySelector('.confirm-dialog')");
        await wait("document.activeElement.matches('.note-title')");
        await key('P', [primary]);
        await wait("!!document.querySelector('.palette')");
        await checkTabLoop('.palette');
        await checkAccessibleNames();
        const selectedPaletteOption = await js(
          "document.activeElement.getAttribute('aria-activedescendant')"
        );
        await key('Down');
        assert.notEqual(
          await js("document.activeElement.getAttribute('aria-activedescendant')"),
          selectedPaletteOption,
          'palette arrow navigation updates the active option'
        );
        await key('Escape');
        await wait("!document.querySelector('.palette')");
        for (const mode of ['visual', 'edit']) {
          await change('[aria-label="Editor mode"]', mode);
          const editor = mode === 'visual' ? '.visual-document' : '.editor .cm-content';
          await wait(`!!document.querySelector('${editor}')`);
          if (mode === 'edit') {
            assert.ok(
              await js(
                "document.querySelector('.editor .cm-content').textContent.includes('[[Card#claim|Evidence link]]')"
              ),
              'visual link insertion remains editable as Markdown source'
            );
          }
          assert.deepEqual(
            await js(
              "[...document.querySelectorAll('[data-editor-action]')].map(el => el.dataset.editorAction)"
            ),
            visualActions,
            'editors expose the same toolbar actions'
          );
          await js("document.querySelector('[data-editor-action=pocket]').focus()");
          await key('Right');
          assert.equal(
            await js('document.activeElement.dataset.editorAction'),
            'hat',
            'toolbar supports arrow keys'
          );
          await js(`document.querySelector('${editor}').focus()`);
          await delay(500);
          assert.equal(
            await js('getComputedStyle(document.activeElement).outlineStyle'),
            'solid',
            'editor focus indicator is visible in both modes'
          );
          assert.equal(
            await js('parseFloat(getComputedStyle(document.activeElement).outlineWidth) >= 2'),
            true,
            'the editor focus preference emphasizes the focus indicator'
          );
          assert.equal(
            await js(`document.querySelector('${editor}').getAttribute('aria-multiline')`),
            'true'
          );
          await key('F', [primary]);
          await wait("!!document.querySelector('.visual-find')");
          await checkTabLoop('.visual-find');
          await js('document.querySelector(\'.visual-find [aria-label="Find text"]\').focus()');
          const focusStyle = await js(`(() => {
            const style = getComputedStyle(document.activeElement);
            return { outline: style.outlineStyle, shadow: style.boxShadow,
              element: document.activeElement.outerHTML, visible: document.activeElement.matches(':focus-visible') };
          })()`);
          assert.equal(focusStyle.shadow, 'none', 'find input has no second focus ring');
          assert.equal(
            focusStyle.outline,
            'solid',
            `find input retains a visible focus ring (${mode}): ${JSON.stringify(focusStyle)}`
          );
          await key('Escape');
          await wait("!document.querySelector('.visual-find')");
          await wait(`document.activeElement.matches('${editor}')`);
          assert.equal(
            await js(`document.activeElement.matches('${editor}')`),
            true,
            'find returns focus to the editor'
          );
          await js("document.querySelector('[data-editor-action=link]').click()");
          await wait("!!document.querySelector('.visual-link-form')");
          await checkTabLoop('.visual-link-form');
          await key('Escape');
          await wait("!document.querySelector('.visual-link-form')");
          await js("document.querySelector('[data-editor-action=link]').click()");
          await wait("!!document.querySelector('.visual-link-form input')");
          await js("document.querySelector('.visual-link-form input').focus()");
          await wc.insertText('Card#claim|Evidence link');
          await js("document.querySelector('.visual-link-form button[type=submit]').click()");
          await wait("!document.querySelector('.visual-link-form')");
          if (mode === 'visual') {
            await wait("!!document.querySelector('.visual-document [data-wiki-link]')");
          }
        }
        await change('[aria-label="Editor mode"]', 'visual');
        await wait("document.querySelectorAll('.visual-document [data-wiki-link]').length === 2");
        let saved = '';
        for (
          let i = 0;
          i < 100 && (saved.match(/\[\[Card#claim\|Evidence link\]\]/g) || []).length !== 2;
          i++
        ) {
          await delay(50);
          saved = await fs.readFile(path.join(vault, 'Card.md'), 'utf8');
        }
        assert.equal(
          (saved.match(/\[\[Card#claim\|Evidence link\]\]/g) || []).length,
          2,
          'links inserted in both editing modes survive switching and save to disk'
        );
        assert.equal(await js("document.querySelectorAll('[inert]').length"), 0);
        await js("document.querySelector('.ribbon-settings-button').click()");
        await wait("!!document.querySelector('.settings')");
        await js("document.querySelector('[data-section=accessibility]').click()");
        await js("document.querySelector('[data-setting=editorFocusOutline]').click()");
        await key('Escape');
        await js("document.querySelector('.visual-document').focus()");
        assert.equal(
          await js('getComputedStyle(document.activeElement).outlineStyle'),
          'solid',
          'disabling emphasis preserves the basic keyboard focus indicator'
        );
        assert.ok(
          await js('parseFloat(getComputedStyle(document.activeElement).outlineWidth) < 2.4'),
          'basic focus indicator is thinner when emphasis is disabled'
        );
        assert.equal(
          await js("JSON.parse(localStorage.getItem('tagline-settings')).editorFocusOutline"),
          false
        );
        wc.debugger.detach();
        console.log(
          'PASS accessibility: focus scopes, sidebar ordering, theme fade, and editor parity'
        );
        app.exit(0);
      } catch (error) {
        console.error(require('./helpers/smoke.cjs').formatFailure(error));
        app.exit(1);
      }
    });
  });
  require('../electron/main.cjs');
})().catch((error) => {
  console.error(error);
  app.exit(1);
});
