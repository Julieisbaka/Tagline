module.exports = async function runScenario({
  assert,
  js,
  wait,
  open,
  point,
  press,
  delay,
  context,
  button,
}) {
  await open('Sizing.flow');
  await wait("!!document.querySelector('.flow-grid textarea')");
  const firstRow = '.flow-grid tbody tr:first-child';
  const blankCell = `${firstRow} [data-column="1"]`;
  const height = () =>
    js("document.querySelector('.flow-grid tbody tr:first-child').getBoundingClientRect().height");
  const initialHeight = await height();
  await press(await point(blankCell));
  await wait(
    "document.querySelector('.flow-grid tbody tr:first-child [data-column=\"1\"]').tagName === 'TEXTAREA'"
  );
  await delay(200);
  assert.ok(Math.abs((await height()) - initialHeight) < 3, 'blank lines must not expand the row');
  assert.equal(
    await js('document.querySelector(\'.flow-grid tbody tr:first-child [data-column="1"]\').value'),
    '\n'.repeat(40)
  );
  assert.equal(
    await js(
      'getComputedStyle(document.querySelector(\'.flow-grid tbody tr:first-child [data-column="1"]\')).outlineStyle'
    ),
    'none'
  );
  assert.notEqual(
    await js(
      "getComputedStyle(document.querySelector('.flow-grid tbody tr:first-child [data-column=\"1\"]').closest('td')).boxShadow"
    ),
    'none'
  );

  const longCell = '.flow-grid tbody tr:nth-child(2) [data-column="0"]';
  await press(await point(longCell));
  await wait(
    "document.querySelector('.flow-grid tbody tr:nth-child(2) [data-column=\"0\"]').tagName === 'TEXTAREA'"
  );
  const metrics = await js(
    '(() => { const el = document.querySelector(\'.flow-grid tbody tr:nth-child(2) [data-column="0"]\'); return { height: el.getBoundingClientRect().height, scrollHeight: el.scrollHeight, value: el.value }; })()'
  );
  assert.ok(metrics.height <= 321, 'long cells must remain bounded');
  assert.ok(metrics.scrollHeight > metrics.height, 'long text must remain scrollable');
  assert.equal(metrics.value, 'long\n'.repeat(80));

  await context(longCell);
  assert.ok(
    await js(
      "[...document.querySelectorAll('.context-menu button')].some(el => el.textContent.trim() === 'Link card here')"
    ),
    'flow actions must own the textarea context menu'
  );
  await button('.context-menu button', 'Link card here');
  await wait("!!document.querySelector('.flow-card-picker')");
  assert.equal(await js("document.querySelectorAll('.context-menu').length"), 0);
  await button('.flow-card-picker button', 'Cancel');
  await wait("!document.querySelector('.flow-card-picker')");
};
