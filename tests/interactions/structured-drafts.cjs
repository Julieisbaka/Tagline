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
  await js(`(() => {
    const input = document.querySelector('[aria-label="Value for count"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
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
