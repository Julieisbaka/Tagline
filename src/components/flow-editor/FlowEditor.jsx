import { redo as redoEditor, undo as undoEditor } from '@codemirror/commands';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EMPTY_FLOW, flowColumns, parseFlow } from '../../../electron/flow.mjs';
import { cellBounds, copyFlowCells, parseFlowCells, pasteFlowCells } from '../../lib/flowCells.js';
import { useI18n } from '../../lib/i18n.js';
import { binding, displayBinding, matchesBinding } from '../../lib/keybindings.js';
import { useConfirm } from '../dialogs/ConfirmProvider.jsx';
import ContextMenu from '../dialogs/ContextMenu.jsx';
import FlowGrid from './FlowGrid.jsx';
import FlowSheetTabs from './FlowSheetTabs.jsx';
import JsonEditor from '../JsonEditor.jsx';
import JsonRecovery from '../JsonRecovery.jsx';

export { EMPTY_FLOW } from '../../../electron/flow.mjs';

export default function FlowEditor({ path, content, mode, onChange, onRestore, focusNewFlowRow = true, keybindings, settings }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [active, setActive] = useState(0);
  const [renaming, setRenaming] = useState(null);
  const [menu, setMenu] = useState(null);
  const draggedSheet = useRef(null);
  const [sheetDropIndex, setSheetDropIndex] = useState(null);
  const gridRef = useRef(null);
  const sheetTabsRef = useRef(null);
  const focusTarget = useRef(null);
  const [selection, setSelection] = useState(null);
  const keepSelection = useRef(false);
  const liveActions = useRef({});
  const sourceEditor = useRef(null);
  const flowHistory = useRef({ path, undo: [], redo: [], expected: content });
  const currentContent = useRef(content);
  if (flowHistory.current.path !== path) {
    flowHistory.current = { path, undo: [], redo: [], expected: content };
  }
  currentContent.current = content;
  useEffect(() => {
    const history = flowHistory.current;
    if (history.expected === content) {
      history.expected = null;
      return;
    }
    history.undo = [];
    history.redo = [];
    history.expected = null;
  }, [path, content]);
  useEffect(() => {
    const action = (event) => liveActions.current[event.detail]?.();
    window.addEventListener('workspace-action', action);
    return () => window.removeEventListener('workspace-action', action);
  }, []);
  useLayoutEffect(() => {
    if (!focusTarget.current) return;
    const { row, column } = focusTarget.current;
    gridRef.current?.querySelector(`[data-row="${row}"][data-column="${column}"]`)?.focus();
    focusTarget.current = null;
  }, [content]);
  const context = (e, items) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };
  const applyFlowContent = (next) => {
    flowHistory.current.expected = next;
    currentContent.current = next;
    onChange(next);
  };
  const saveFlowContent = (next) => {
    const history = flowHistory.current;
    const previous = currentContent.current;
    if (previous === next) return;
    history.undo.push({ content: previous, active });
    if (history.undo.length > 100) history.undo.shift();
    history.redo = [];
    applyFlowContent(next);
  };
  const focusFlowContentCell = (next, sheetIndex = active) => {
    const nextData = parseFlow(next);
    const sheet = nextData.sheets[Math.min(sheetIndex, nextData.sheets.length - 1)];
    if (!sheet?.rows.length || !sheet.columns.length) return;
    const focused = document.activeElement?.matches('.flow-grid textarea') ? document.activeElement.dataset : null;
    const row = Number(focused?.row ?? selection?.head.row ?? 0);
    const column = Number(focused?.column ?? selection?.head.column ?? 0);
    focusTarget.current = {
      row: Math.max(0, Math.min(sheet.rows.length - 1, row)),
      column: Math.max(0, Math.min(sheet.columns.length - 1, column)),
    };
  };
  const undoFlow = () => {
    const history = flowHistory.current;
    const previous = history.undo.pop();
    if (previous === undefined) return;
    history.redo.push({ content: currentContent.current, active });
    focusFlowContentCell(previous.content, previous.active);
    setActive(previous.active);
    setSelection(null);
    applyFlowContent(previous.content);
  };
  const redoFlow = () => {
    const history = flowHistory.current;
    const next = history.redo.pop();
    if (next === undefined) return;
    history.undo.push({ content: currentContent.current, active });
    if (history.undo.length > 100) history.undo.shift();
    focusFlowContentCell(next.content, next.active);
    setActive(next.active);
    setSelection(null);
    applyFlowContent(next.content);
  };
  const handleHistoryShortcut = (event) => {
    if (matchesBinding(event, binding('flow-undo', keybindings))) {
      event.preventDefault();
      event.stopPropagation();
      if (mode === 'edit') {
        if (sourceEditor.current) undoEditor(sourceEditor.current);
      } else undoFlow();
    } else if (matchesBinding(event, binding('flow-redo', keybindings))) {
      event.preventDefault();
      event.stopPropagation();
      if (mode === 'edit') {
        if (sourceEditor.current) redoEditor(sourceEditor.current);
      } else redoFlow();
    }
  };

  const parsed = useMemo(() => {
    try {
      const data = parseFlow(content || '{}');
      return { data };
    } catch (e) {
      return { error: e.message };
    }
  }, [content]);
  liveActions.current = {};

  if (mode === 'edit') return <div className="flow" onKeyDownCapture={handleHistoryShortcut}>
    {parsed.error && <div className="editor-notice" role="alert">{parsed.error}
      <JsonRecovery path={path} content={content} onRestore={onRestore} />
    </div>}
    <JsonEditor className="canvas-json-editor" label={t('Flow JSON')} value={content} onChange={onChange}
      onCreateEditor={(view) => { sourceEditor.current = view; }} height="100%" settings={settings} />
  </div>;

  if (parsed.error) {
    return (
      <div className="flow-error">
        <p>{t('This flow file could not be parsed ({error}).', { error: parsed.error })}</p>
        <JsonRecovery path={path} content={content} onRestore={onRestore} />
        <button onClick={async () => {
          if (await confirm(t('Reset to an empty flow?'))) onChange(EMPTY_FLOW);
        }}>{t('Reset to an empty flow')}</button>
      </div>
    );
  }

  const { data } = parsed;
  const idx = Math.min(active, data.sheets.length - 1);
  const sheet = data.sheets[idx];
  const save = (sheets) => saveFlowContent(JSON.stringify({ ...data, sheets }, null, 2));
  const updateSheet = (patch) => save(data.sheets.map((s, i) => (i === idx ? { ...s, ...patch } : s)));

  const reorderSheet = (from, to) => {
    if (from === to || from < 0 || to < 0 || from >= data.sheets.length || to >= data.sheets.length) return;
    const sheets = [...data.sheets];
    const [moved] = sheets.splice(from, 1);
    sheets.splice(to, 0, moved);
    save(sheets);
    setActive(idx === from ? to : idx > from && idx <= to ? idx - 1 : idx < from && idx >= to ? idx + 1 : idx);
    setSelection(null);
  };

  const addSheet = (preset) => {
    const columns = flowColumns(preset, data.sheets.some((item) => item.columns.includes('2NC') && item.columns.includes('1NR')));
    const name = preset.startsWith('Off') ? 'Off-case' : preset.startsWith('CX') ? 'CX' : 'Case';
    save([...data.sheets, { name, columns, rows: [Array(columns.length).fill('')] }]);
    setActive(data.sheets.length);
    setSelection(null);
  };

  const removeSheet = async (i) => {
    if (data.sheets.length === 1) return;
    if (!await confirm(t('Delete sheet "{name}"?', { name: data.sheets[i].name }))) return;
    save(data.sheets.filter((_, j) => j !== i));
    setActive(Math.max(0, i - 1));
  };

  const setCell = (r, c, value) =>
    updateSheet({ rows: sheet.rows.map((row, i) => (i === r ? row.map((v, j) => (j === c ? value : v)) : row)) });

  const addRow = (after = sheet.rows.length - 1, column = null) => {
    setSelection(null);
    const rows = [...sheet.rows];
    rows.splice(after + 1, 0, Array(sheet.columns.length).fill(''));
    if (column !== null && focusNewFlowRow) focusTarget.current = { row: after + 1, column };
    updateSheet({ rows });
  };
  const insertRowAbove = (row, column) => addRow(row - 1, column);

  const removeRow = (r) => {
    setSelection(null);
    updateSheet({ rows: sheet.rows.filter((_, i) => i !== r) });
  };

  const renameColumn = (c, name) => updateSheet({ columns: sheet.columns.map((v, i) => (i === c ? name : v)) });

  const addColumn = () =>
    updateSheet({ columns: [...sheet.columns, 'New'], rows: sheet.rows.map((row) => [...row, '']) });

  const removeColumn = async (c) => {
    if (sheet.columns.length === 1) return;
    if (!await confirm(t('Delete column "{name}" and its contents?', { name: sheet.columns[c] }))) return;
    setSelection(null);
    updateSheet({
      columns: sheet.columns.filter((_, i) => i !== c),
      rows: sheet.rows.map((row) => row.filter((_, i) => i !== c)),
    });
  };
  const selected = selection?.sheet === idx &&
    Math.max(selection.anchor.row, selection.head.row) < sheet.rows.length &&
    Math.max(selection.anchor.column, selection.head.column) < sheet.columns.length ? selection : null;
  const bounds = selected && cellBounds(selected.anchor, selected.head);
  const multi = bounds && (bounds.top !== bounds.bottom || bounds.left !== bounds.right);
  const inside = (r, c) => bounds && r >= bounds.top && r <= bounds.bottom && c >= bounds.left && c <= bounds.right;
  const choose = (row, column, extend = false) => {
    const focused = document.activeElement?.matches('.flow-grid textarea') ? document.activeElement.dataset : null;
    const anchor = extend ? selected?.anchor || (focused ? { row: Number(focused.row), column: Number(focused.column) } : { row, column }) : { row, column };
    setSelection({ sheet: idx, anchor, head: { row, column } });
  };
  const clear = (area = bounds) => {
    if (!area) return;
    updateSheet({
      rows: sheet.rows.map((row, r) => row.map((value, c) =>
        r >= area.top && r <= area.bottom && c >= area.left && c <= area.right ? '' : value))
    });
  };
  const clipboardError = (error) => window.dispatchEvent(new CustomEvent('app-error', { detail: error.message }));
  const copy = async (area = bounds, cut = false) => {
    if (!area) return;
    await navigator.clipboard.writeText(copyFlowCells(sheet.rows, area));
    if (cut) clear(area);
  };
  const paste = (text, row, column) => {
    const cells = parseFlowCells(text);
    updateSheet(pasteFlowCells(sheet, row, column, cells));
    setSelection({
      sheet: idx, anchor: { row, column },
      head: { row: row + cells.length - 1, column: column + Math.max(...cells.map((item) => item.length)) - 1 }
    });
  };
  liveActions.current = {
    'flow-row': () => addRow(selected?.head.row, selected?.head.column ?? 0),
    'flow-row-above': () => insertRowAbove(selected?.head.row ?? 0, selected?.head.column ?? 0),
    'flow-add-column': addColumn,
    'flow-clear-selection': () => clear(),
    'flow-select-all': () => setSelection({
      sheet: idx, anchor: { row: 0, column: 0 },
      head: { row: Math.max(0, sheet.rows.length - 1), column: sheet.columns.length - 1 }
    }),
  };
  const shortcutFor = (id) => displayBinding(binding(id, keybindings));
  const shortcutHints = [
    ['flow-row-above', 'Insert row above'], ['flow-add-column', 'Add column'],
    ['flow-select-all', 'Select all cells'], ['flow-clear-selection', 'Clear selected cells'],
    ['flow-undo', 'Undo'], ['flow-redo', 'Redo'],
    ['flow-next-cell', 'Next cell'], ['flow-previous-cell', 'Previous cell'],
    ['flow-extend-up', 'Extend selection up'], ['flow-extend-down', 'Extend selection down'],
    ['flow-extend-left', 'Extend selection left'], ['flow-extend-right', 'Extend selection right'],
    ['flow-deselect', 'Clear cell selection'],
  ].map(([id, label]) => {
    const shortcut = shortcutFor(id);
    return shortcut ? { id, text: t('{action}: {shortcut}', { action: t(label), shortcut }) } : null;
  }).filter(Boolean);

  return (
    <div className="flow" onKeyDownCapture={handleHistoryShortcut}>
      <FlowSheetTabs
        data={data} idx={idx} renaming={renaming} setRenaming={setRenaming}
        settings={settings} sheetDropIndex={sheetDropIndex} setSheetDropIndex={setSheetDropIndex}
        draggedSheet={draggedSheet} reorderSheet={reorderSheet} removeSheet={removeSheet}
        setActive={setActive} setSelection={setSelection} sheetTabsRef={sheetTabsRef}
        addSheet={addSheet} save={save} t={t} context={context}
      />
      <FlowGrid
        gridRef={gridRef} sheet={sheet} settings={settings} keybindings={keybindings}
        selection={{ selected, bounds, multi, inside, choose, keepSelection, setSelection }}
        actions={{
          addColumn, removeColumn, renameColumn, addRow, insertRowAbove, removeRow,
          setCell, clear, copy, paste, clipboardError,
          selectAll: liveActions.current['flow-select-all'],
        }}
        t={t} context={context} shortcutFor={shortcutFor} shortcutHints={shortcutHints}
      />
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
