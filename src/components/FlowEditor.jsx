import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { redo as redoEditor, undo as undoEditor } from '@codemirror/commands';
import { EMPTY_FLOW, FLOW_PRESETS as PRESETS, flowColumns, parseFlow } from '../../electron/flow.mjs';
import { cellBounds, copyFlowCells, parseFlowCells, pasteFlowCells } from '../lib/flowCells.js';
import { useI18n } from '../lib/i18n.js';
import { binding, displayBinding, matchesBinding } from '../lib/keybindings.js';
import ContextMenu from './dialogs/ContextMenu.jsx';
import Icon from './Icon.jsx';
import { useConfirm } from './dialogs/ConfirmProvider.jsx';
import JsonRecovery from './JsonRecovery.jsx';
import JsonEditor from './JsonEditor.jsx';

const AFF = new Set(['1AC', '2AC', '1AR', '2AR', 'AC', 'AR']);
export { EMPTY_FLOW } from '../../electron/flow.mjs';

const sideOf = (col) => (AFF.has(col.split(' ')[0].toUpperCase()) ? 'aff' : 'neg');

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
      <div className="flow-sheets" ref={sheetTabsRef} role="group" aria-label={t('Flow sheets')}>
        {data.sheets.map((s, i) =>
          renaming === i ? (
            <input
              key={i}
              className="flow-sheet-input"
              autoFocus
              defaultValue={s.name}
              spellCheck={settings.flowSpellcheck !== false}
              onBlur={(e) => {
                save(data.sheets.map((x, j) => (j === i ? { ...x, name: e.target.value || x.name } : x)));
                setRenaming(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
            />
          ) : (
            <div
              key={i}
              className={`flow-sheet-tab${i === idx ? ' active' : ''}${sheetDropIndex === i ? ' drop-before' : ''}${sheetDropIndex === i + 1 ? ' drop-after' : ''}`}
              draggable
              onDragStart={(event) => {
                draggedSheet.current = i;
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/flow-sheet', String(i));
                event.currentTarget.classList.add('dragging');
              }}
              onDragOver={(event) => {
                if (draggedSheet.current === null) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                const rect = event.currentTarget.getBoundingClientRect();
                setSheetDropIndex(i + (event.clientX > rect.left + rect.width / 2 ? 1 : 0));
              }}
              onDrop={(event) => {
                if (draggedSheet.current === null) return;
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                const destination = i + (event.clientX > rect.left + rect.width / 2 ? 1 : 0);
                reorderSheet(draggedSheet.current, destination > draggedSheet.current ? destination - 1 : destination);
                draggedSheet.current = null;
                setSheetDropIndex(null);
              }}
              onDragEnd={(event) => {
                event.currentTarget.classList.remove('dragging');
                draggedSheet.current = null;
                setSheetDropIndex(null);
              }}
              onContextMenu={(e) => context(e, [
                { label: 'Rename sheet', run: () => setRenaming(i) },
                { label: 'Delete sheet', run: () => removeSheet(i), disabled: data.sheets.length === 1, danger: true },
              ])}
            >
              <button type="button" className="flow-sheet-select" aria-pressed={i === idx}
                onClick={() => { setActive(i); setSelection(null); }}
                onKeyDown={(event) => {
                  if (event.altKey && event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
                    event.preventDefault();
                    const destination = i + (event.key === 'ArrowLeft' ? -1 : 1);
                    if (destination < 0 || destination >= data.sheets.length) return;
                    reorderSheet(i, destination);
                    requestAnimationFrame(() => sheetTabsRef.current?.querySelectorAll('.flow-sheet-select')[destination]?.focus());
                  }
                }}
                onDoubleClick={() => setRenaming(i)} title={t('Double-click to rename; Alt+Shift+Left/Right to reorder')}>
                {s.name}
              </button>
              {data.sheets.length > 1 && (
                <button type="button" className="flow-sheet-close"
                  aria-label={t('Delete sheet "{name}"?', { name: s.name })}
                  title={t('Delete sheet')}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSheet(i);
                  }}
                >
                  <Icon name="x" size={10} />
                </button>
              )}
            </div>
          ),
        )}
        <select className="flow-add" value="" onChange={(e) => e.target.value && addSheet(e.target.value)}>
          <option value="">{t('+ Sheet')}</option>
          {Object.keys(PRESETS).map((p) => (
            <option key={p} value={p}>
              {t(p)}
            </option>
          ))}
        </select>
      </div>

      <div className="flow-grid-wrap" ref={gridRef}>
        <table className="flow-grid" aria-label={t('Flow cells')} style={{ minWidth: `${sheet.columns.length * 160 + 32}px` }}>
          <thead>
            <tr>
              {sheet.columns.map((col, c) => (
                <th key={c} className={`side-${sideOf(col)}`} onContextMenu={(e) => context(e, [
                  { label: 'Add column', run: addColumn },
                  { label: 'Remove column', run: () => removeColumn(c), disabled: sheet.columns.length === 1, danger: true },
                ])}>
                  <input spellCheck={settings.flowSpellcheck !== false} value={col}
                    onChange={(e) => renameColumn(c, e.target.value)} />
                  <button className="mini" title={t('Remove column')} onClick={() => removeColumn(c)}>
                    <Icon name="x" size={10} />
                  </button>
                </th>
              ))}
              <th className="flow-actions">
                <button className="mini" title={`${t('Add column')}${binding('flow-add-column', keybindings)
                  ? ` (${displayBinding(binding('flow-add-column', keybindings))})` : ''}`} onClick={addColumn}>
                  +
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className={`side-${sideOf(sheet.columns[c] || '')}${inside(r, c) ? ' cell-selected' : ''}`}
                    onContextMenu={(e) => {
                      if (!multi && e.target instanceof HTMLTextAreaElement &&
                        e.target.selectionStart !== e.target.selectionEnd) return;
                      const area = inside(r, c) ? bounds : cellBounds({ row: r, column: c }, { row: r, column: c });
                      if (!inside(r, c)) choose(r, c);
                      e.currentTarget.querySelector('textarea')?.focus({ preventScroll: true });
                      context(e, [
                        { label: 'Copy cells', run: () => copy(area) },
                        { label: 'Cut cells', run: () => copy(area, true) },
                        { label: 'Paste cells', run: async () => paste(await navigator.clipboard.readText(), area.top, area.left) },
                        { label: 'Clear selected cells', run: () => clear(area) },
                        { label: 'Select all cells', run: liveActions.current['flow-select-all'] },
                        { label: 'Insert row above', run: () => insertRowAbove(r, c) },
                        { label: 'Insert row below', run: () => addRow(r, c) },
                        { label: 'Clear cell', run: () => setCell(r, c, '') },
                        { label: 'Remove row', run: () => removeRow(r), danger: true },
                      ]);
                    }}>
                    <textarea
                      data-row={r}
                      data-column={c}
                      aria-label={t('Row {row}, {column}', { row: r + 1, column: sheet.columns[c] })}
                      spellCheck={settings.flowSpellcheck !== false}
                      value={cell}
                      onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        if (event.shiftKey) { event.preventDefault(); choose(r, c, true); }
                        else choose(r, c);
                      }}
                      onFocus={() => {
                        if (keepSelection.current) { keepSelection.current = false; return; }
                        if (!inside(r, c)) choose(r, c);
                      }}
                      onCopy={(event) => {
                        if (!multi && event.currentTarget.selectionStart !== event.currentTarget.selectionEnd) return;
                        event.preventDefault();
                        event.clipboardData.setData('text/plain', copyFlowCells(sheet.rows, bounds || cellBounds({ row: r, column: c }, { row: r, column: c })));
                      }}
                      onCut={(event) => {
                        if (!multi && event.currentTarget.selectionStart !== event.currentTarget.selectionEnd) return;
                        event.preventDefault();
                        const area = bounds || cellBounds({ row: r, column: c }, { row: r, column: c });
                        event.clipboardData.setData('text/plain', copyFlowCells(sheet.rows, area));
                        clear(area);
                      }}
                      onPaste={(event) => {
                        const text = event.clipboardData.getData('text/plain');
                        const quotedCell = event.currentTarget.value === '' && /^"(?:[^"]|"")*"$/s.test(text);
                        if (!multi && !quotedCell && !/[\t\r\n]/.test(text)) return;
                        event.preventDefault();
                        try { paste(text, multi ? bounds.top : r, multi ? bounds.left : c); }
                        catch (error) { clipboardError(error); }
                      }}
                      placeholder="…"
                      onChange={(e) => { choose(r, c); setCell(r, c, e.target.value); }}
                      onKeyDown={(e) => {
                        const extend = [
                          ['flow-extend-up', -1, 0], ['flow-extend-down', 1, 0],
                          ['flow-extend-left', 0, -1], ['flow-extend-right', 0, 1],
                        ].find(([id]) => matchesBinding(e, binding(id, keybindings)));
                        if (extend) {
                          e.preventDefault();
                          const head = selected?.head || { row: r, column: c };
                          const row = Math.max(0, Math.min(sheet.rows.length - 1, head.row + extend[1]));
                          const column = Math.max(0, Math.min(sheet.columns.length - 1, head.column + extend[2]));
                          choose(row, column, true);
                          const target = gridRef.current.querySelector(`[data-row="${row}"][data-column="${column}"]`);
                          if (target && target !== document.activeElement) {
                            keepSelection.current = true;
                            target.focus();
                            target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                          }
                          return;
                        }
                        if (matchesBinding(e, binding('flow-deselect', keybindings))) {
                          e.preventDefault(); setSelection(null); return;
                        }
                        if (multi && ['Delete', 'Backspace'].includes(e.key)) { e.preventDefault(); clear(); return; }
                        if (matchesBinding(e, binding('flow-select-all', keybindings))) {
                          e.preventDefault(); liveActions.current['flow-select-all'](); return;
                        }
                        if (matchesBinding(e, binding('flow-clear-selection', keybindings))) { e.preventDefault(); clear(); return; }
                        if (matchesBinding(e, binding('flow-add-column', keybindings))) { e.preventDefault(); addColumn(); return; }
                        const nextCell = matchesBinding(e, binding('flow-next-cell', keybindings));
                        const previousCell = matchesBinding(e, binding('flow-previous-cell', keybindings));
                        if (nextCell || previousCell) {
                          const direction = previousCell ? -1 : 1;
                          let nextRow = r;
                          let nextColumn = c + direction;
                          if (nextColumn < 0) {
                            nextRow -= 1;
                            nextColumn = sheet.columns.length - 1;
                          } else if (nextColumn >= sheet.columns.length) {
                            nextRow += 1;
                            nextColumn = 0;
                          }
                          const nextCell = gridRef.current?.querySelector(
                            `[data-row="${nextRow}"][data-column="${nextColumn}"]`,
                          );
                          if (nextCell) {
                            e.preventDefault();
                            choose(nextRow, nextColumn);
                            nextCell.focus();
                            nextCell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                          }
                          return;
                        }
                        if (matchesBinding(e, binding('flow-row-above', keybindings))) {
                          e.preventDefault();
                          insertRowAbove(r, c);
                          return;
                        }
                        if (matchesBinding(e, binding('flow-row', keybindings))) {
                          e.preventDefault();
                          addRow(r, c);
                        }
                      }}
                    />
                  </td>
                ))}
                <td className="flow-actions">
                  <button className="mini" title={t('Remove row')} onClick={() => removeRow(r)}>
                    <Icon name="x" size={10} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flow-footer">
          <button className="flow-add-row" onClick={() => addRow()}>
            {t('+ Add argument row')} {shortcutFor('flow-row') && <span className="hint">{shortcutFor('flow-row')}</span>}
          </button>
          {shortcutHints.map(({ id, text }) => <span className="flow-keyboard-hint" key={id}>{text}</span>)}
        </div>
      </div>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
