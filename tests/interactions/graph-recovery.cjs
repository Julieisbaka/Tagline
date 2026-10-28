module.exports = async function runScenario({ win, wc, vault, fs, path, assert, delay, js, wait, click, button, open, point, press, drag, context, saved }) {
  await click('.ribbon [data-ribbon-item=graph]');
  await wait("!!document.querySelector('.graph canvas')");
  await js(`(() => {
    const ctx = document.querySelector('.graph canvas').getContext('2d');
    for (const name of ['clearRect', 'translate', 'scale', 'arc']) {
      const method = ctx[name].bind(ctx);
      ctx[name] = (...values) => {
        if (name === 'clearRect') window.graphPaint = { nodes: [] };
        if (name === 'translate') window.graphPaint.offset = values;
        if (name === 'scale') window.graphPaint.scale = values[0];
        if (name === 'arc') window.graphPaint.nodes.push({ x: values[0], y: values[1], r: values[2] });
        return method(...values);
      };
    }
  })()`);
  await wait("window.graphPaint?.nodes.length === 2");
  await delay(1000);
  const originalNode = await js("window.graphPaint.nodes[0]");
  const gp = await js(`(() => { const r = document.querySelector('.graph canvas').getBoundingClientRect();
    const p = window.graphPaint, n = p.nodes[0];
    return { x: Math.round(r.left + p.offset[0] + n.x * p.scale),
      y: Math.round(r.top + p.offset[1] + n.y * p.scale) }; })()`);
  let held;
  await drag(gp, 80, 50, async () => {
    held = await js("window.graphPaint.nodes[0]");
  });
  const dropped = await js("window.graphPaint.nodes[0]");
  assert.ok(Math.abs(held.x - originalNode.x - 80) < 8 && Math.abs(held.y - originalNode.y - 50) < 8,
    'graph drag moves the node, rather than just panning');
  assert.ok(Math.hypot(dropped.x - held.x, dropped.y - held.y) < 20,
    'release resumes physics without snapping to the original layout');
  await delay(1200);
  const settled = await js("window.graphPaint.nodes[0]");
  assert.ok(Math.hypot(dropped.x - settled.x, dropped.y - settled.y) > 1,
    'released graph nodes resume the force simulation rather than staying pinned');
  await click('.sidebar-header [aria-label="Refresh"]');
  await wait("document.querySelector('.sidebar-header [aria-label=\"Refresh\"]').getAttribute('aria-busy') === 'false'");
  const refreshed = await js("window.graphPaint.nodes[0]");
  assert.ok(Math.hypot(refreshed.x - settled.x, refreshed.y - settled.y) < 25,
    'refreshing preserves the graph layout while physics continues');
  await js(`(() => { const canvas = document.querySelector('.graph canvas'), r = canvas.getBoundingClientRect();
    for (let index = 0; index < 30; index++) canvas.dispatchEvent(new WheelEvent('wheel', {
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, deltaY: -100, bubbles: true, cancelable: true
    })); })()`);
  await wait("window.graphPaint.scale === 4");
  const zoomOffset = await js("window.graphPaint.offset");
  await js(`(() => { const canvas = document.querySelector('.graph canvas'), r = canvas.getBoundingClientRect();
    for (let index = 0; index < 20; index++) canvas.dispatchEvent(new WheelEvent('wheel', {
      clientX: r.left + 40 + index * 8, clientY: r.top + 40, deltaY: -100, bubbles: true, cancelable: true
    })); })()`);
  await delay(100);
  assert.deepEqual(await js("window.graphPaint.offset"), zoomOffset, 'zooming at maximum scale never shifts the camera');
  await js(`(() => { const canvas = document.querySelector('.graph canvas'), r = canvas.getBoundingClientRect();
    for (let index = 0; index < 60; index++) canvas.dispatchEvent(new WheelEvent('wheel', {
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, deltaY: 100, bubbles: true, cancelable: true
    })); })()`);
  await wait("window.graphPaint.scale === 0.2");
  const minOffset = await js("window.graphPaint.offset");
  await js("document.querySelector('.graph canvas').dispatchEvent(new WheelEvent('wheel', {clientX: 100, clientY: 200, deltaY: 100, bubbles: true, cancelable: true}))");
  await delay(100);
  assert.deepEqual(await js("window.graphPaint.offset"), minOffset, 'zooming at minimum scale is also stable');
  for (const file of ['Round.flow', 'Map.canvas']) {
    const valid = await fs.readFile(path.join(vault, file), 'utf8');
    await js(`window.api.write(${JSON.stringify(file)}, '{broken')`);
    await js(`window.api.write(${JSON.stringify(file)}, '{"nodes":{}}')`);
    await click('.sidebar-header [aria-label="Refresh"]');
    await wait("document.querySelector('.sidebar-header [aria-label=\"Refresh\"]').getAttribute('aria-busy') === 'false'");
    await open(file);
    await wait("!!document.querySelector('.json-recovery button')");
    await click('.json-recovery button');
    await wait("!!document.querySelector('.confirm-dialog')");
    await button('.confirm-dialog button', 'Cancel');
    assert.equal(await fs.readFile(path.join(vault, file), 'utf8'), '{"nodes":{}}');
    await click('.json-recovery button');
    await wait("!!document.querySelector('.confirm-dialog')");
    await button('.confirm-dialog button', 'Confirm');
    await wait("!document.querySelector('.json-recovery button')");
    await wait("document.querySelector('.toast')?.textContent === 'Working save restored.'");
    for (let i = 0; i < 40 && await fs.readFile(path.join(vault, file), 'utf8') !== valid; i++) await delay(50);
    assert.equal(await fs.readFile(path.join(vault, file), 'utf8'), valid);
    const latest = await js(`window.api.listHistory(${JSON.stringify(file)})`);
    assert.equal(await js(`window.api.readHistory(${JSON.stringify(file)}, ${JSON.stringify(latest[0].id)})`), '{"nodes":{}}');
    if (file.endsWith('flow')) {
      await js(`(() => { const el = document.querySelector('[aria-label="Flow mode"]');
        el.value = 'source'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    } else {
      await js(`(() => { const el = document.querySelector('[aria-label="Canvas mode"]');
        el.value = 'source'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    }
    await wait("!!document.querySelector('.canvas-json-editor .cm-content')");
    await js("document.querySelector('.canvas-json-editor .cm-content').focus()");
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] });
    await wc.insertText('{invalid source');
    await wait("!!document.querySelector('.json-recovery button')");
    await click('.json-recovery button');
    await wait("!!document.querySelector('.confirm-dialog')");
    await button('.confirm-dialog button', 'Confirm');
    await wait("!document.querySelector('.json-recovery button')");
    for (let i = 0; i < 40 && await fs.readFile(path.join(vault, file), 'utf8') !== valid; i++) await delay(50);
    assert.equal(await fs.readFile(path.join(vault, file), 'utf8'), valid, 'source mode can recover too');
  }
  const previewCanvas = {
    nodes: [
      { id: 'embedded', type: 'file', file: 'Alpha.md', x: 0, y: 0, width: 280, height: 240 },
      { id: 'linked', type: 'link', url: '[[Round.flow|Open round]]', x: 320, y: 0, width: 240, height: 180 },
    ], edges: [],
  };
  await js(`window.api.write('Map.canvas', ${JSON.stringify(JSON.stringify(previewCanvas))})`);
  await click('.sidebar-header [aria-label="Refresh"]');
  await wait("document.querySelector('.sidebar-header [aria-label=\"Refresh\"]').getAttribute('aria-busy') === 'false'");
  await js(`(() => { const el = document.querySelector('[aria-label="Canvas mode"]');
    el.value = 'visual'; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await wait("document.querySelector('[data-node-id=embedded] .canvas-node-preview')?.textContent.includes('Evidence text')");
  assert.equal(await js("document.querySelector('[data-node-id=linked] .canvas-open-file').disabled"), false);
  for (const [file, selector] of [['Round.flow', '.canvas-file-flow table'], ['Map.canvas', '.canvas-file-map']]) {
    await js(`(() => { const el = document.querySelector('[data-node-id=embedded] [aria-label="File path"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(file)});
      el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await wait(`!!document.querySelector('[data-node-id=embedded] ${selector}')`);
  }
  await click('[data-node-id=linked] .canvas-open-file');
  await wait("document.querySelector('.tab.active')?.title === 'Round.flow'");
  await button('.note-actions button', 'History');
  await wait("!!document.querySelector('.history-json-preview .cm-content')");
  await button('.history-dialog button', 'Close');
  await click('.ribbon-settings-button');
  await wait("!!document.querySelector('.settings')");
  await click('[data-section=advanced]');
  const spacing = await js(`(() => {
    const limits = document.querySelector('.customization-limits').getBoundingClientRect();
    const flags = document.querySelector('.internal-flags').getBoundingClientRect();
    return { gap: flags.top - limits.bottom,
      headingMargin: getComputedStyle(document.querySelector('.internal-flags h4')).marginTop,
      rangeDisplay: getComputedStyle(document.querySelector('.customization-limits .setting-row small')).display };
  })()`);
  assert.ok(Math.abs(spacing.gap - 24) < 1, 'settings groups use consistent 24px separation');
  assert.equal(spacing.headingMargin, '0px', 'section headings do not double their top spacing');
  assert.equal(spacing.rangeDisplay, 'block', 'advanced ranges are distinct helper text, not cramped inline labels');
  assert.equal(await js("document.querySelector('[data-flag=hasSeenOnboarding]').checked"), true);
  assert.equal(await js("JSON.parse(localStorage.getItem('tagline-settings')).internalFlags.hasSeenOnboarding"), true);
  assert.equal(await js("JSON.parse(localStorage.getItem('tagline-settings')).internalFlags.visualNoticeDismissed"), false);
  await button('.settings-footer button', 'Done');
  await delay(1200);
  await new Promise((resolve) => { wc.once('did-finish-load', resolve); wc.reload(); });
  await wait("!!document.querySelector('.ribbon-settings-button')");
  assert.equal(await js("JSON.parse(localStorage.getItem('tagline-settings')).internalFlags.hasSeenOnboarding"), true);
  assert.equal(await js("!!document.querySelector('.onboarding-dialog')"), false, 'onboarding stays dismissed after reload');
  await click('.ribbon-settings-button');
  await wait("!!document.querySelector('.settings')");
  await click('[data-section=advanced]');
  await button('.internal-flags button', 'Show onboarding again');
  await wait("!!document.querySelector('.onboarding-dialog')");
  await button('.onboarding-dialog button', 'Skip tour');
  await wait("!document.querySelector('.onboarding-dialog')");
};
