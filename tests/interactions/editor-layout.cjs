module.exports = async function runScenario({
  _win,
  wc,
  assert,
  delay,
  js,
  wait,
  click,
  button,
  open,
  context,
  saved,
}) {
  await open('Alpha.md');
  await wait("!!document.querySelector('.status-bar [data-bar-item=words]')");
  await wait("!!document.querySelector('.visual-document')");
  await js(`(() => {
    const editor = document.querySelector('.visual-document').editor;
    window.originalLinkTestMarkdown = editor.getMarkdown();
    editor.commands.setContent({
      type: 'doc', content: [
        { type: 'paragraph', content: [
          { type: 'text', text: 'underlined link', marks: [
            { type: 'underline' }, { type: 'link', attrs: { href: 'https://example.com' } }
          ] }
        ] },
        { type: 'paragraph', content: [
          { type: 'wikiLink', attrs: { target: 'Beta' }, marks: [{ type: 'underline' }] }
        ] }
      ]
    }, { emitUpdate: false });
    document.documentElement.classList.add('underline-links');
  })()`);
  const underlineLayers = (selector) =>
    js(`(() => {
      const root = document.querySelector(${JSON.stringify(selector)});
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const counts = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent.trim() || !node.parentElement.closest('a, [data-wiki-link], .cm-link, .cm-url, .cm-wikilink')) continue;
        let count = 0;
        for (let el = node.parentElement; el && el !== root; el = el.parentElement) {
          if (getComputedStyle(el).textDecorationLine.includes('underline')) count++;
        }
        counts.push(count);
      }
      return counts;
    })()`);
  await wait("!!document.querySelector('.visual-document u')");
  await js(`(() => {
    const link = document.querySelector('.visual-document a');
    const range = document.createRange(); range.selectNodeContents(link);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  })()`);
  const visualUnderlines = await underlineLayers('.visual-document');
  assert.ok(visualUnderlines.length > 0);
  assert.ok(
    visualUnderlines.every((count) => count === 1),
    'selected visual links have one underline layer'
  );
  await js(`(() => {
    const select = document.querySelector('[aria-label="Editor mode"]');
    select.value = 'edit'; select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait("!!document.querySelector('.source-editor .cm-wikilink')");
  await js("document.querySelector('.source-editor .cm-content').focus()");
  const modifiers = [process.platform === 'darwin' ? 'meta' : 'control'];
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers });
  await wc.insertText('++[[Beta]]++\n\n[external link](https://example.com)');
  await wait("!!document.querySelector('.source-editor .cm-debate-underline')");
  assert.equal(
    await js(
      "!!document.querySelector('.cm-debate-underline .cm-wikilink, .cm-wikilink .cm-debate-underline')"
    ),
    true,
    'fixture uses actual overlapping CodeMirror decorations'
  );
  await js(`(() => {
    const link = document.querySelector('.source-editor .cm-wikilink');
    const range = document.createRange(); range.selectNodeContents(link);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  })()`);
  const sourceUnderlines = await underlineLayers('.source-editor .cm-content');
  assert.ok(sourceUnderlines.length > 0);
  assert.ok(
    sourceUnderlines.every((count) => count === 1),
    'nested CodeMirror link marks draw one underline layer'
  );
  await js(`(() => {
    document.documentElement.classList.remove('underline-links');
    const select = document.querySelector('[aria-label="Editor mode"]');
    select.value = 'visual'; select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait("!!document.querySelector('.visual-document')");
  await js(
    "document.querySelector('.visual-document').editor.commands.setContent(window.originalLinkTestMarkdown, { contentType: 'markdown' })"
  );
  await wait("!!document.querySelector('.visual-document mark')");
  const chromeStyles = () =>
    js(`['.visual-toolbar button', '.ribbon button', '.note-title'].map(selector => {
      const style = getComputedStyle(document.querySelector(selector));
      return [style.backgroundColor, style.color, style.borderWidth, style.borderRadius];
    })`);
  const themedChrome = await chromeStyles();
  await js("document.documentElement.classList.add('native-ui')");
  assert.deepEqual(
    await chromeStyles(),
    themedChrome,
    'native forms preserve toolbar and title styling'
  );
  assert.equal(
    await js("getComputedStyle(document.querySelector('.visual-toolbar button')).appearance"),
    'none'
  );
  assert.equal(
    await js('getComputedStyle(document.querySelector(\'[aria-label="Editor mode"]\')).appearance'),
    'auto'
  );
  assert.equal(
    await js(
      "getComputedStyle(document.querySelector('[aria-label=\"Editor mode\"]'), '::picker-icon').display"
    ),
    'none',
    'native selects do not retain the custom picker arrow'
  );
  await js("document.documentElement.classList.remove('native-ui')");
  await js(`(() => {
    const editor = document.querySelector('.visual-document');
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor.querySelector('mark'));
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    window.expectedTextCopy = selection.toString();
  })()`);
  await context('.visual-document p');
  await button('.context-menu button', 'Copy');
  await delay(100);
  assert.equal(await require('electron').clipboard.readText(), await js('window.expectedTextCopy'));
  await js(`(() => {
    const select = document.querySelector('[aria-label="Editor mode"]');
    select.value = 'edit'; select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait("!!document.querySelector('.source-editor .cm-content')");
  await js(`(() => {
    const editor = document.querySelector('.source-editor .cm-content');
    editor.focus();
    const node = editor.querySelector('.cm-line').firstChild;
    const range = document.createRange(); range.selectNodeContents(node);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    window.focus();
    window.expectedTextCopy = selection.toString();
  })()`);
  await delay(150);
  await context('.source-editor .cm-content');
  for (let attempt = 0; attempt < 5; attempt++) {
    await button('.context-menu button', 'Copy');
    await delay(100);
    const clip = await require('electron').clipboard.readText();
    if (clip === (await js('window.expectedTextCopy'))) {
      break;
    }
    // re-select and re-open context menu
    await js(`(() => {
      const editor = document.querySelector('.source-editor .cm-content');
      editor.focus();
      const node = editor.querySelector('.cm-line').firstChild;
      const range = document.createRange(); range.selectNodeContents(node);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      window.expectedTextCopy = selection.toString();
    })()`);
    await delay(100);
    await context('.source-editor .cm-content');
  }
  assert.equal(await require('electron').clipboard.readText(), await js('window.expectedTextCopy'));
  await js(`(() => {
    const select = document.querySelector('[aria-label="Editor mode"]');
    select.value = 'visual'; select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait("!!document.querySelector('.visual-document')");
  await context('.status-bar [data-bar-item=words]');
  await button('.context-menu button', 'Move left');
  assert.ok(
    (await saved('statusBarItems')).indexOf('words') <
      (await saved('statusBarItems')).indexOf('cards')
  );
  await context('.status-bar [data-bar-item=words]');
  await button('.context-menu button', 'Hide Word count');
  assert.equal((await saved('statusBarItems')).includes('words'), false);
  await context('.status-bar');
  await button('.context-menu button', 'Show Word count');
  assert.equal((await saved('statusBarItems')).at(-1), 'words');
  await context('.sidebar-header [data-bar-item=newCanvas]');
  await button('.context-menu button', 'Move left');
  assert.deepEqual((await saved('fileManagerItems')).slice(0, 3), [
    'newNote',
    'newCanvas',
    'newFlow',
  ]);
  await context('.sidebar-header [data-bar-item=newCanvas]');
  await button('.context-menu button', 'Hide New canvas');
  assert.equal(
    await js('!!document.querySelector(\'.sidebar-header [aria-label="New canvas"]\')'),
    false
  );
  await delay(1200);
  await new Promise((resolve) => {
    wc.once('did-finish-load', resolve);
    wc.reload();
  });
  await wait("!!document.querySelector('.sidebar-header')");
  assert.equal(
    await js('!!document.querySelector(\'.sidebar-header [aria-label="New canvas"]\')'),
    false
  );
  assert.equal((await saved('statusBarItems')).at(-1), 'words');
  await js(`(() => { const value = JSON.parse(localStorage.getItem('tagline-settings'));
    value.fileManagerItems = []; value.statusBarItems = [];
    localStorage.setItem('tagline-settings', JSON.stringify(value)); })()`);
  await new Promise((resolve) => {
    wc.once('did-finish-load', resolve);
    wc.reload();
  });
  await wait("!!document.querySelector('.sidebar-header')");
  assert.equal(await js("document.querySelectorAll('.configurable-bar-item').length"), 0);
  assert.equal(
    await js("document.querySelector('.status-bar').getBoundingClientRect().height >= 28"),
    true
  );
  assert.equal(
    await js("document.querySelector('.sidebar-header').getBoundingClientRect().height >= 40"),
    true
  );
  await context('.sidebar-header');
  await button('.context-menu button', 'Restore default items');
  assert.equal(
    await js('!!document.querySelector(\'.sidebar-header [aria-label="New canvas"]\')'),
    true
  );
  await context('.status-bar');
  await button('.context-menu button', 'Restore default items');
  await open('Alpha.md');
  await wait("!!document.querySelector('[data-editor-action=link]')");
  await click('[data-editor-action=link]');
  await wait("!!document.querySelector('.wiki-link-options')");
  assert.equal(
    await js("document.querySelector('.visual-link-form input').hasAttribute('list')"),
    false
  );
  await button('.wiki-link-options button', 'Beta');
  assert.equal(await js("document.querySelector('.visual-link-form input').value"), 'Beta');
  await js(`(() => { const el = document.querySelector('.visual-link-form input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'Al#Claim|Evidence');
    el.dispatchEvent(new Event('input', { bubbles: true })); el.focus(); })()`);
  await wait("document.querySelectorAll('.wiki-link-options button').length === 1");
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Down' });
  wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  await wait("document.querySelector('.visual-link-form input').value === 'Alpha#Claim|Evidence'");
  assert.equal(
    await js("!!document.querySelector('.visual-link-form')"),
    true,
    'choosing a suggestion does not submit prematurely'
  );
  await button('.visual-link-form button', 'Insert link');
  await wait("!document.querySelector('.visual-link-form')");
};
