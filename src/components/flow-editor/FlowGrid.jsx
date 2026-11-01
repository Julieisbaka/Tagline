import { binding, displayBinding, matchesBinding } from '../../lib/keybindings.js';
import { cellBounds, copyFlowCells } from '../../lib/flowCells.js';
import Icon from '../Icon.jsx';

const AFF = new Set(['1AC', '2AC', '1AR', '2AR', 'AC', 'AR']);
const sideOf = (col) => (AFF.has(col.split(' ')[0].toUpperCase()) ? 'aff' : 'neg');

export default function FlowGrid({
  gridRef, sheet, settings, keybindings, selection, actions, t, context, shortcutFor, shortcutHints,
}) {
  const { selected, bounds, multi, inside, choose, keepSelection, setSelection } = selection;
  const {
    addColumn, removeColumn, renameColumn, addRow, insertRowAbove, removeRow,
    setCell, clear, copy, paste, clipboardError, selectAll,
  } = actions;

  return (
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
                      { label: 'Select all cells', run: selectAll },
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
                        e.preventDefault(); selectAll(); return;
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
  );
}
