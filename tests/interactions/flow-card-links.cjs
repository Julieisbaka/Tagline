module.exports = async function runScenario({ vault, fs, path, assert, delay, js, wait, open, context, button, click }) {
  await open('Round.flow');
  await wait("!!document.querySelector('.flow-grid textarea')");
  await js(`(() => {
    const cell = document.querySelector('.flow-grid textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(cell, 'Draft argument');
    cell.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await context('.flow-grid tbody tr:first-child td:first-child');
  await button('.context-menu button', 'Link card here');
  await wait("!!document.querySelector('.flow-card-picker')");
  await button('.flow-card-results button', 'Nested/Beta.md');
  await wait(`!!document.querySelector('.flow-cell-preview a.internal-link') ||
    [...document.querySelectorAll('.flow-grid textarea')].some((cell) => cell.value.includes('[[Nested/Beta.md|Beta]]'))`);
  await js(`(() => {
    const cell = [...document.querySelectorAll('.flow-grid textarea')]
      .find((item) => item.value.includes('[[Nested/Beta.md|Beta]]'));
    if (cell) { cell.focus(); cell.blur(); }
  })()`);
  await wait("!!document.querySelector('.flow-cell-preview a.internal-link')");
  assert.equal(await js("document.querySelector('.flow-cell-preview a.internal-link').getAttribute('title')"), 'Nested/Beta.md');
  assert.equal(await js("document.querySelector('.flow-cell-preview a.internal-link').textContent"), 'Beta');
  for (let i = 0; i < 80; i++) {
    const flow = JSON.parse(await fs.readFile(path.join(vault, 'Round.flow'), 'utf8'));
    if (flow.sheets.some((sheet) => sheet.rows.some((row) => row.some((cell) => cell.includes('[[Nested/Beta.md|Beta]]'))))) {
      assert.equal(flow.version, 2);
      assert.ok(flow.sheets.some((sheet) => sheet.rows.some((row) => row.some((cell) => cell.includes('Draft argument\n[[Nested/Beta.md|Beta]]')))));
      break;
    }
    if (i === 79) {
      assert.fail('Card link was not saved');
    }
    await delay(50);
  }
  await click('.flow-cell-preview a.internal-link');
  await wait("document.querySelector('.tab.active')?.title === 'Nested/Beta.md'");
  await click('.right-panel [aria-label="Backlinks"]');
  await wait("!!document.querySelector('.right-panel .flow-backlink[title=\"Round.flow\"]')");
  assert.ok(await js("document.querySelector('.right-panel').textContent.includes('Used in this round (1)')"));
  await click('.right-panel .flow-backlink[title="Round.flow"]');
  await wait("document.querySelector('.tab.active')?.title === 'Round.flow'");
};
