const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const fsAsync = require('node:fs/promises');
const os = require('node:os');
const { promisify } = require('node:util');

test('new flow block separation preserves existing files and preset constants', async () => {
  const { createFlow, flowColumns, EMPTY_FLOW, FLOW_PRESETS, parseFlow } = await import('../electron/flow.mjs');
  assert.equal(createFlow(false), EMPTY_FLOW);
  const combined = parseFlow(EMPTY_FLOW);
  const split = parseFlow(createFlow(true));
  assert.deepEqual(split.sheets[0].columns, ['1AC', '1NC', '2AC', '2NC', '1NR', '1AR', '2NR', '2AR']);
  assert.equal(split.sheets[0].rows[0].length, 8);
  assert.ok(combined.sheets[0].columns.includes('Block'));
  assert.ok(FLOW_PRESETS['On-case (Aff)'].includes('Block'));
  assert.deepEqual(flowColumns('Off-case (Neg)', true), ['1NC', '2AC', '2NC', '1NR', '1AR', '2NR', '2AR']);
  assert.deepEqual(flowColumns('CX notes', true), FLOW_PRESETS['CX notes']);
  assert.throws(() => createFlow('true'), /Invalid flow creation/);
});

test('flow rectangular clipboard data round-trips and expands without overwriting other cells', async () => {
  const { cellBounds, copyFlowCells, parseFlowCells, pasteFlowCells } = await import('../src/lib/flowCells.js');
  const rows = [['a', 'b\tc', 'd\nmore'], ['"quoted"', 'two', 'three']];
  const bounds = cellBounds({ row: 1, column: 2 }, { row: 0, column: 0 });
  assert.deepEqual(bounds, { top: 0, bottom: 1, left: 0, right: 2 });
  assert.deepEqual(parseFlowCells(copyFlowCells(rows, bounds)), rows);
  assert.deepEqual(parseFlowCells('a\tb\r\nc\td\r\n'), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(parseFlowCells('a\t\n'), [['a', '']]);
  assert.deepEqual(parseFlowCells(''), [['']]);
  assert.throws(() => parseFlowCells('"not closed'), /unclosed/);
  const sheet = { columns: ['1AC', '1NC'], rows: [['keep', 'old']] };
  const pasted = pasteFlowCells(sheet, 0, 1, [['new', 'extra'], ['next']]);
  assert.deepEqual(pasted, { columns: ['1AC', '1NC', 'New'], rows: [['keep', 'new', 'extra'], ['', 'next', '']] });
  assert.deepEqual(sheet.rows, [['keep', 'old']]);
  assert.throws(() => pasteFlowCells(sheet, 100000, 0, [['too much']]), /100,000/);
});

test('palette exposes configured workspace actions only in the matching editor', async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' });
  global.window = { api: { platform: 'win32' } };
  try {
    const { buildCommands } = await server.ssrLoadModule('/src/lib/commands.js');
    const { KEYBINDINGS } = await server.ssrLoadModule('/src/lib/keybindings.js');
    const calls = [];
    const ctx = { hasNote: true, isMarkdown: false, canCanvas: true, workspaceAction: (id) => calls.push(id) };
    let commands = buildCommands(ctx, { 'canvas-fit': 'Mod+Shift+9' });
    const fit = commands.find((item) => item.id === 'canvas-fit');
    assert.equal(fit.hotkey, 'Ctrl+Shift+9');
    fit.run();
    assert.deepEqual(calls, ['canvas-fit']);
    assert.ok(!commands.some((item) => item.id === 'flow-select-all' || item.id === 'export-note'));
    commands = buildCommands({ ...ctx, canCanvas: false, canFlow: true });
    assert.ok(commands.some((item) => item.id === 'flow-select-all'));
    assert.ok(!commands.some((item) => item.id === 'canvas-fit'));
    const appIds = new Set(KEYBINDINGS.filter((item) => item.scope === 'app').map((item) => item.id));
    const all = buildCommands({ hasNote: true, isMarkdown: true });
    for (const command of all) assert.ok(appIds.has(command.id), `${command.id} must be configurable`);
  } finally { delete global.window; await server.close(); }
});

test('template placeholders use literal target paths, Markdown bodies and raw YAML properties', async () => {
  const { fillTemplate } = await import('../src/lib/template.js');
  const prefix = '---\r\n# Keep this\r\ntitle: "Speech"\r\nspeech: true\r\n---\r\n';
  const body = '# Evidence\n\nLiteral {{title}} and $& and {{path}}.\n';
  assert.equal(fillTemplate('{{path}}\n{{properties}}{{content}}', 'Target',
    { path: 'Cards/Target.md', content: prefix + body }),
    'Cards/Target.md\n# Keep this\r\ntitle: "Speech"\r\nspeech: true\r\n' + body);
  assert.equal(fillTemplate('{{path}}|{{content}}|{{properties}}', 'New', { path: 'New.md' }), 'New.md||');
  assert.equal(fillTemplate('{{content}}|{{properties}}', 'Plain', { content: '# Plain' }), '# Plain|');
  assert.equal(fillTemplate('{{title}} {{title}} {{unknown}}', '$& {{path}}'), '$& {{path}} $& {{path}} {{unknown}}');
  assert.match(fillTemplate('{{date}} {{time}}', ''), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.equal(fillTemplate('{{path}}{{content}}{{properties}}', 'Legacy'), '');
  const invalid = '---\nbroken: [\n---\n# Body';
  assert.equal(fillTemplate('{{properties}}{{content}}', '', { content: invalid }), 'broken: [\n# Body',
    'raw properties are not parsed or rewritten');
});

test('sidebar shortcut order is normalized and drag reordering is stable', async () => {
  const { DEFAULT_RIBBON_ITEMS, moveRibbonItem, normalizeRibbonItems } =
    await import('../src/lib/ribbonItems.js');
  assert.deepEqual(normalizeRibbonItems(['search', 'search', 'unknown']), ['search']);
  assert.deepEqual(normalizeRibbonItems(null), DEFAULT_RIBBON_ITEMS);
  assert.deepEqual(moveRibbonItem(['a', 'b', 'c'], 'a', 'c'), ['b', 'c', 'a']);
  assert.deepEqual(moveRibbonItem(['a', 'b', 'c'], 'a', 'b'), ['b', 'a', 'c']);
  assert.deepEqual(moveRibbonItem(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b']);
  assert.deepEqual(moveRibbonItem(['rightPanel', 'search', 'graph'], 'rightPanel', 'graph'), ['search', 'graph', 'rightPanel']);
  assert.deepEqual(moveRibbonItem(['a', 'b'], 'missing', 'b'), ['a', 'b']);
});

