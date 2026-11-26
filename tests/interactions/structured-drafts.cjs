module.exports = async function runScenario({
  assert,
  js,
  wait,
  open,
  click,
  button,
  delay,
  fs,
  path,
  vault,
}) {
  await open('Drafts.flow');
  await wait("!!document.querySelector('.flow-grid th input')");
  await js(`(() => {
    const input = document.querySelector('.flow-grid th input');
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Edited'); input.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(input, 'Edited column'); input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  })()`);
  await wait("document.querySelector('.flow-grid th input').value === '1AC'");
  await js(`document.querySelector('.flow-grid th input').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }))`);
  await wait("document.querySelector('.flow-grid th input').value === 'Edited column'");

  await js(`(() => {
    const cell = document.querySelector('.flow-grid textarea');
    cell.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(cell, 'First draft');
    cell.dispatchEvent(new Event('input', { bubbles: true }));
    cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
  })()`);
  await wait("document.querySelectorAll('.flow-grid tbody tr').length === 2");
  assert.ok(
    await js(
      "document.querySelector('.flow-grid tbody tr:first-child').textContent.includes('First draft')"
    )
  );
  await js(`(() => {
    const input = document.querySelector('.flow-grid th input');
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Column draft');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const button = document.querySelector('.flow-grid th[ class="flow-actions"] button');
    button.focus(); button.click();
  })()`);
  await wait("document.querySelectorAll('.flow-grid th input').length === 2");
  assert.equal(await js("document.querySelector('.flow-grid th input').value"), 'Column draft');
  await click('.flow-grid tbody tr:nth-child(2) [data-column="0"]');
  await wait("!!document.querySelector('.flow-grid tbody tr:nth-child(2) textarea')");
  await js(`(() => {
    const cell = document.querySelector('.flow-grid tbody tr:nth-child(2) textarea');
    cell.focus();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(cell, 'Kept row');
    cell.dispatchEvent(new Event('input', { bubbles: true }));
    const button = document.querySelector('.flow-grid tbody tr:first-child [title="Remove row"]');
    button.focus(); button.click();
  })()`);
  await wait("document.querySelectorAll('.flow-grid tbody tr').length === 1");
  assert.equal(await js("document.querySelector('.flow-grid textarea').value"), 'Kept row');
  await js(`(() => {
    const input = document.querySelectorAll('.flow-grid th input')[1];
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Kept column');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const button = document.querySelector('.flow-grid th [title="Remove column"]');
    button.focus(); button.click();
  })()`);
  await wait("!!document.querySelector('.confirm-dialog')");
  await button('.confirm-dialog button', 'Confirm');
  await wait("document.querySelectorAll('.flow-grid th input').length === 1");
  assert.equal(await js("document.querySelector('.flow-grid th input').value"), 'Kept column');

  await open('Drafts.canvas');
  await wait('!!document.querySelector(\'[data-node-id="group"] [aria-label="Group label"]\')');
  await js(`(() => {
    const input = document.querySelector('[data-node-id="group"] input');
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Edited'); input.dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(input, 'Edited group'); input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  })()`);
  await wait("document.querySelector('[data-node-id=\"group\"] input').value === 'Original'");
  await js(`document.querySelector('[data-node-id="group"] input').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }))`);
  await wait("document.querySelector('[data-node-id=\"group\"] input').value === 'Edited group'");

  await js(`(() => {
    const input = document.querySelector('[data-node-id="file"] input');
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Alpha.md');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait('!document.querySelector(\'[data-node-id="file"] .canvas-open-file\').disabled');
  await js(`(() => {
    const button = document.querySelector('[data-node-id="file"] .canvas-open-file');
    button.focus(); button.click();
  })()`);
  await wait("document.querySelector('.tab.active').title === 'Alpha.md'");
  await open('Drafts.canvas');
  await js(`(() => {
    const input = document.querySelector('[data-node-id="file"] [aria-label="File subpath"]');
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '#Claim');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await js(`(() => {
    const button = document.querySelector('[data-node-id="file"] .canvas-open-file');
    button.focus(); button.click();
  })()`);
  await wait("document.querySelector('.tab.active').title === 'Alpha.md'");
  await wait(
    "document.querySelector('.visual-document')?.editor?.state.selection.$from.parent.textContent === 'Claim'"
  );
  await open('Drafts.canvas');
  await js(`(() => {
    const input = document.querySelector('[data-node-id="file"] input');
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Beta.md');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(
    "document.querySelector('[data-node-id=\"file\"] .canvas-open-file').textContent === 'Beta.md'"
  );
  await js(`(() => {
    const button = document.querySelector('[data-node-id="file"] .canvas-open-file');
    button.focus(); button.click();
  })()`);
  await wait("document.querySelector('.tab.active').title === 'Beta.md'");
  await open('Drafts.canvas');
  await js(`(() => {
    const input = document.querySelector('[data-node-id="link"] input');
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '[[Alpha#Claim|Current]]');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(
    "document.querySelector('[data-node-id=\"link\"] .canvas-open-file').textContent === 'Current'"
  );
  await js(`(() => {
    const button = document.querySelector('[data-node-id="link"] .canvas-open-file');
    button.focus(); button.click();
  })()`);
  await wait("document.querySelector('.tab.active').title === 'Alpha.md'");
  await open('Drafts.canvas');
  await js(`(() => {
    const input = document.querySelector('[data-node-id="link"] input');
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'https://example.com/new');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(
    "document.querySelector('[data-node-id=\"link\"] .canvas-open-file').textContent === 'https://example.com/new'"
  );
  assert.equal(
    await js('document.querySelector(\'[data-node-id="link"] .canvas-open-file\').disabled'),
    false
  );

  await open('Drafts.md');
  await wait('!!document.querySelector(\'[aria-label="Value for title"]\')');
  await js(`(() => {
    const input = document.querySelector('[aria-label="Value for title"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Cancelled');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await button('.note-property button', 'Cancel');
  assert.equal(
    await js('document.querySelector(\'[aria-label="Value for title"]\').value'),
    'Before'
  );
  await js(`(() => {
    const input = document.querySelector('[aria-label="Value for title"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'After');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await button('.note-property button', 'Apply');
  await delay(50);
  await js("document.querySelector('.visual-document').editor.commands.undo()");
  await wait("document.querySelector('[aria-label=\"Value for title\"]').value === 'Before'");
  assert.ok(await js("document.querySelector('.visual-document').textContent.includes('Body')"));
  await js("document.querySelector('.visual-document').editor.commands.redo()");
  await wait("document.querySelector('[aria-label=\"Value for title\"]').value === 'After'");
  await js(`(() => {
    const input = document.querySelector('[aria-label="Value for title"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Pending');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await open('Drafts.flow');
  await open('Drafts.md');
  await wait("document.querySelector('[aria-label=\"Value for title\"]')?.value === 'Pending'");
  await delay(800);
  await js(`(() => {
    const input = document.querySelector('[aria-label="Value for title"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Unload draft');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  assert.equal(
    await js("!window.dispatchEvent(new Event('beforeunload', { cancelable: true }))"),
    true
  );
  await delay(800);
  assert.match(await fs.readFile(path.join(vault, 'Drafts.md'), 'utf8'), /title: Unload draft/);
  await js(`(() => {
    const input = document.querySelector('[aria-label="Value for count"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  assert.equal(
    await js("!window.dispatchEvent(new Event('beforeunload', { cancelable: true }))"),
    true
  );
  await js(`document.querySelector('[aria-label="Value for count"]').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, bubbles: true }))`);
  assert.equal(await js('document.querySelector(\'[aria-label="Editor mode"]\').value'), 'visual');
  await wait('!!document.querySelector(\'.note-property-number [role="alert"]\')');
  await click('.tree-item[title="Drafts.flow"]');
  await delay(100);
  assert.equal(await js("document.querySelector('.tab.active').title"), 'Drafts.md');
  await wait('!!document.querySelector(\'.note-property-number [role="alert"]\')');
  await click('.note-property-number button:last-of-type');
  await js(`(() => {
    const input = document.querySelector('.note-property-add input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'temporary');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await click('.note-property-add button');
  await wait('!!document.querySelector(\'[aria-label="Value for temporary"]\')');
  await js(`(() => {
    const input = document.querySelector('[aria-label="Value for temporary"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'draft');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await js("document.querySelector('.visual-document').editor.commands.undo()");
  await wait('!document.querySelector(\'[aria-label="Value for temporary"]\')');
  await delay(100);
  assert.equal(await js('!!document.querySelector(\'[aria-label="Value for temporary"]\')'), false);
  await open('Alpha.md');
  await delay(500);
  for (const name of ['Drafts.md', 'Drafts.canvas', 'Drafts.flow']) {
    await fs.unlink(path.join(vault, name));
  }
  await click('.sidebar-header [aria-label="Refresh"]');
  await wait('!document.querySelector(\'.tree-item[title="Drafts.md"]\')');
};
