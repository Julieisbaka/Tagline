module.exports = async function runScenario({ vault, fs, path, assert, delay, js, wait, open, click }) {
  await fs.mkdir(path.join(vault, 'Nested'));
  await fs.writeFile(path.join(vault, 'Nested', 'Beta.md'), '# Nested Beta\n');
  await click('.sidebar-header [aria-label="Refresh"]');
  await wait("document.querySelector('.sidebar-header [aria-label=\"Refresh\"]').getAttribute('aria-busy') === 'false'");
  await click('.tree-item[title="Nested"]');
  await wait("!!document.querySelector('.tree-item[title=\"Nested/Beta.md\"]')");
  await open('Alpha.md');
  await js(`(() => { const select = document.querySelector('[aria-label="Editor mode"]');
    select.value = 'edit'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await wait("!!document.querySelector('.source-editor .cm-content')");

  const drop = (from, target) => js(`(() => {
    const source = document.querySelector(${JSON.stringify(from)});
    const destination = document.querySelector(${JSON.stringify(target)});
    if (!source || !destination) throw new Error('Missing drag source or editor');
    const rect = destination.getBoundingClientRect();
    const transfer = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    const options = { bubbles: true, cancelable: true, dataTransfer: transfer,
      clientX: rect.left + 12, clientY: rect.top + Math.min(rect.height / 2, 8) };
    destination.dispatchEvent(new DragEvent('dragover', options));
    destination.dispatchEvent(new DragEvent('drop', options));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
  })()`);

  await drop('.tree-item[title="Nested/Beta.md"]', '.source-editor .cm-line');
  await wait("document.querySelector('.cm-content').textContent.includes('[[Nested/Beta.md]]')");
  const sourceText = await js("document.querySelector('.cm-content').textContent");
  assert.ok(sourceText.indexOf('[[Nested/Beta.md]]') < sourceText.indexOf('Claim'),
    'source links are inserted at the drop position, not at a previous selection');
  await drop('.tree-item[title="Nested"]', '.source-editor .cm-line');
  assert.equal(await js("document.querySelector('.cm-content').textContent"), sourceText, 'folder drags do not insert links');

  await js(`document.querySelector('.tree-item[title="Beta.md"]').dispatchEvent(
    new MouseEvent('click', { bubbles: true, ctrlKey: true }))`);
  await wait("!!document.querySelector('.tab[title=\"Beta.md\"]')");
  await click('.tab[title="Alpha.md"]');
  await js(`(() => { const select = document.querySelector('[aria-label="Editor mode"]');
    select.value = 'visual'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await wait("!!document.querySelector('.visual-document p')");
  await drop('.tab[title="Beta.md"]', '.visual-document p');
  await wait("!!document.querySelector('.visual-document p [data-wiki-link][data-target=\"Beta.md\"]')");
  assert.equal(await js("document.querySelector('.visual-document').textContent.includes('Evidence text')"), true,
    'the visual drop preserves existing evidence');
  for (let i = 0; i < 80; i++) {
    const text = await fs.readFile(path.join(vault, 'Alpha.md'), 'utf8');
    if (text.includes('[[Nested/Beta.md]]') && text.includes('[[Beta.md]]')) return;
    await delay(50);
  }
  assert.fail('dragged links were not saved in the note');
};
