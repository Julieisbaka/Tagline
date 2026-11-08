import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { binding, displayBinding, matchesBinding } from '../../lib/keybindings.js';
import { cellBounds, copyFlowCells } from '../../lib/flowCells.js';
import { renderMarkdown } from '../../lib/markdown.js';
import Icon from '../Icon.jsx';

const AFF = new Set(['1AC', '2AC', '1AR', '2AR', 'AC', 'AR']);
const sideOf = (col) => (AFF.has(col.split(' ')[0].toUpperCase()) ? 'aff' : 'neg');

export default function FlowGrid({
  gridRef,
  sheet,
  settings,
  keybindings,
  selection,
  actions,
  t,
  context,
  shortcutFor,
  shortcutHints,
}) {
  const [editing, setEditing] = useState(() =>
    sheet.rows.length && sheet.columns.length ? { row: 0, column: 0 } : null
  );
  useEffect(() => {
    if (!sheet.rows.length || !sheet.columns.length) {
      setEditing(null);
      return;
    }
    setEditing((current) => {
      if (
        current &&
        current.row < sheet.rows.length &&
        current.column < sheet.columns.length
      ) {
        return current;
      }
      return { row: 0, column: 0 };
    });
  }, [sheet.rows.length, sheet.columns.length]);
  const markdownCache = useRef(new Map());
  const previewHtml = (text) => {
    if (!text) {
      return '';
    }
    if (markdownCache.current.has(text)) {
      return markdownCache.current.get(text);
    }
    const html = renderMarkdown(text);
    if (markdownCache.current.size > 500) {
      markdownCache.current.clear();
    }
    markdownCache.current.set(text, html);
    return html;
  };
  useEffect(() => {
    if (!editing) {
      return;
    }
    const target = gridRef.current?.querySelector(
      `textarea[data-row="${editing.row}"][data-column="${editing.column}"]`
    );
    if (target && target !== document.activeElement) {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [editing, gridRef]);
  const { selected, bounds, multi, inside, choose, keepSelection, setSelection } = selection;
  const {
    addColumn,
    removeColumn,
    renameColumn,
    addRow,
    insertRowAbove,
    removeRow,
    setCell,
    clear,
    copy,
    paste,
    clipboardError,
    selectAll,
  } = actions;

  useLayoutEffect(() => {
    const table = gridRef.current?.querySelector('table');
    if (!table) {
      return;
    }
    const sizeRows = () => {
      const rows = [...table.querySelectorAll('tbody tr')].map((row) => [
        ...row.querySelectorAll('textarea, .flow-cell-preview'),
      ]);
      // Reset every cell before measuring so formerly tall rows can shrink.
      rows.flat().forEach((cell) => {
        cell.style.height = '0px';
      });
      const heights = rows.map((cells) =>
        Math.max(
          0,
          ...cells.map((cell) => {
            const style = getComputedStyle(cell);
            return (
              cell.scrollHeight +
              parseFloat(style.borderTopWidth) +
              parseFloat(style.borderBottomWidth)
            );
          })
        )
      );
      rows.forEach((cells, index) => {
        cells.forEach((cell) => {
          cell.style.height = `${heights[index]}px`;
        });
      });
    };
    sizeRows();
    let width = table.getBoundingClientRect().width;
    let frame;
    const observer = new ResizeObserver(() => {
      const nextWidth = table.getBoundingClientRect().width;
      if (nextWidth !== width) {
        width = nextWidth;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(sizeRows);
      }
    });
    observer.observe(table);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [gridRef, sheet.rows, sheet.columns, settings]);

  return (
    <div className='flow-grid-wrap' ref={gridRef}>
      <table
        className='flow-grid'
        aria-label={t('Flow cells')}
        style={{ minWidth: `${sheet.columns.length * 160 + 32}px` }}
      >
        <thead>
          <tr>
            {sheet.columns.map((col, c) => (
              <th
                key={c}
                className={`side-${sideOf(col)}`}
                onContextMenu={(e) =>
                  context(e, [
                    { label: 'Add column', command: 'flow-add-column', run: addColumn },
                    {
                      label: 'Remove column',
                      run: () => removeColumn(c),
                      disabled: sheet.columns.length === 1,
                      danger: true,
                    },
                  ])
                }
              >
                <input
                  spellCheck={settings.flowSpellcheck !== false}
                  value={col}
                  onChange={(e) => renameColumn(c, e.target.value)}
                />
                <button className='mini' title={t('Remove column')} onClick={() => removeColumn(c)}>
                  <Icon name='x' size={10} />
                </button>
              </th>
            ))}
            <th className='flow-actions'>
              <button
                className='mini'
                title={`${t('Add column')}${
                  binding('flow-add-column', keybindings)
                    ? ` (${displayBinding(binding('flow-add-column', keybindings))})`
                    : ''
                }`}
                onClick={addColumn}
              >
                +
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {sheet.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => (
                <td
                  key={c}
                  className={`side-${sideOf(sheet.columns[c] || '')}${inside(r, c) ? ' cell-selected' : ''}`}
                  onContextMenu={(e) => {
                    if (
                      !multi &&
                      e.target instanceof HTMLTextAreaElement &&
                      e.target.selectionStart !== e.target.selectionEnd
                    ) {
                      return;
                    }
                    const area = inside(r, c)
                      ? bounds
                      : cellBounds({ row: r, column: c }, { row: r, column: c });
                    if (!inside(r, c)) {
                      choose(r, c);
                    }
                    setEditing({ row: r, column: c });
                    context(e, [
                      { label: 'Copy cells', run: () => copy(area) },
                      { label: 'Cut cells', run: () => copy(area, true) },
                      {
                        label: 'Paste cells',
                        run: async () =>
                          paste(await navigator.clipboard.readText(), area.top, area.left),
                      },
                      {
                        label: 'Clear selected cells',
                        command: 'flow-clear-selection',
                        run: () => clear(area),
                      },
                      { label: 'Select all cells', command: 'flow-select-all', run: selectAll },
                      {
                        label: 'Insert row above',
                        command: 'flow-row-above',
                        run: () => insertRowAbove(r, c),
                      },
                      { label: 'Insert row below', command: 'flow-row', run: () => addRow(r, c) },
                      { label: 'Clear cell', run: () => setCell(r, c, '') },
                      { label: 'Remove row', run: () => removeRow(r), danger: true },
                    ]);
                  }}
                >
                  {editing?.row === r && editing?.column === c ? (
                    <textarea
                      data-row={r}
                      data-column={c}
                      aria-label={t('Row {row}, {column}', {
                        row: r + 1,
                        column: sheet.columns[c],
                      })}
                      spellCheck={settings.flowSpellcheck !== false}
                      value={cell}
                      onBlur={(event) => {
                        if (!event.relatedTarget?.closest?.('.flow-grid-wrap')) {
                          setEditing(null);
                        }
                      }}
                      onPointerDown={(event) => {
                        if (event.button !== 0) {
                          return;
                        }
                        if (event.shiftKey) {
                          event.preventDefault();
                          choose(r, c, true);
                        } else {
                          choose(r, c);
                        }
                      }}
                      onFocus={() => {
                        if (keepSelection.current) {
                          keepSelection.current = false;
                          return;
                        }
                        if (!inside(r, c)) {
                          choose(r, c);
                        }
                      }}
                      onCopy={(event) => {
                        if (
                          !multi &&
                          event.currentTarget.selectionStart !== event.currentTarget.selectionEnd
                        ) {
                          return;
                        }
                        event.preventDefault();
                        event.clipboardData.setData(
                          'text/plain',
                          copyFlowCells(
                            sheet.rows,
                            bounds || cellBounds({ row: r, column: c }, { row: r, column: c })
                          )
                        );
                      }}
                      onCut={(event) => {
                        if (
                          !multi &&
                          event.currentTarget.selectionStart !== event.currentTarget.selectionEnd
                        ) {
                          return;
                        }
                        event.preventDefault();
                        const area =
                          bounds || cellBounds({ row: r, column: c }, { row: r, column: c });
                        event.clipboardData.setData('text/plain', copyFlowCells(sheet.rows, area));
                        clear(area);
                      }}
                      onPaste={(event) => {
                        const text = event.clipboardData.getData('text/plain');
                        const quotedCell =
                          event.currentTarget.value === '' && /^"(?:[^"]|"")*"$/s.test(text);
                        if (!multi && !quotedCell && !/[\t\r\n]/.test(text)) {
                          return;
                        }
                        event.preventDefault();
                        try {
                          paste(text, multi ? bounds.top : r, multi ? bounds.left : c);
                        } catch (error) {
                          clipboardError(error);
                        }
                      }}
                      placeholder='…'
                      onChange={(e) => {
                        choose(r, c);
                        setCell(r, c, e.target.value);
                      }}
                      onKeyDown={(e) => {
                        const extend = [
                          ['flow-extend-up', -1, 0],
                          ['flow-extend-down', 1, 0],
                          ['flow-extend-left', 0, -1],
                          ['flow-extend-right', 0, 1],
                        ].find(([id]) => matchesBinding(e, binding(id, keybindings)));
                        if (extend) {
                          e.preventDefault();
                          const head = selected?.head || { row: r, column: c };
                          const row = Math.max(
                            0,
                            Math.min(sheet.rows.length - 1, head.row + extend[1])
                          );
                          const column = Math.max(
                            0,
                            Math.min(sheet.columns.length - 1, head.column + extend[2])
                          );
                          choose(row, column, true);
                          const target = gridRef.current.querySelector(
                            `[data-row="${row}"][data-column="${column}"]`
                          );
                          if (target && target !== document.activeElement) {
                            keepSelection.current = true;
                            target.focus();
                            target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                          }
                          return;
                        }
                        if (matchesBinding(e, binding('flow-deselect', keybindings))) {
                          e.preventDefault();
                          setSelection(null);
                          return;
                        }
                        if (multi && ['Delete', 'Backspace'].includes(e.key)) {
                          e.preventDefault();
                          clear();
                          return;
                        }
                        if (matchesBinding(e, binding('flow-select-all', keybindings))) {
                          e.preventDefault();
                          selectAll();
                          return;
                        }
                        if (matchesBinding(e, binding('flow-clear-selection', keybindings))) {
                          e.preventDefault();
                          clear();
                          return;
                        }
                        if (matchesBinding(e, binding('flow-add-column', keybindings))) {
                          e.preventDefault();
                          addColumn();
                          return;
                        }
                        const cellDown = matchesBinding(e, binding('flow-cell-down', keybindings));
                        const cellUp = matchesBinding(e, binding('flow-cell-up', keybindings));
                        if (cellDown || cellUp) {
                          const nextRow = r + (cellDown ? 1 : -1);
                          if (nextRow < 0 || nextRow >= sheet.rows.length) {
                            return;
                          }
                          const target = gridRef.current?.querySelector(
                            `[data-row="${nextRow}"][data-column="${c}"]`
                          );
                          if (!target) {
                            return;
                          }
                          e.preventDefault();
                          choose(nextRow, c);
                          target.focus();
                          target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                          return;
                        }
                        const nextCell = matchesBinding(e, binding('flow-next-cell', keybindings));
                        const previousCell = matchesBinding(
                          e,
                          binding('flow-previous-cell', keybindings)
                        );
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
                            `[data-row="${nextRow}"][data-column="${nextColumn}"]`
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
                  ) : (
                    <div
                      className='flow-cell-preview markdown-body'
                      data-row={r}
                      data-column={c}
                      tabIndex={-1}
                      aria-label={t('Row {row}, {column}', {
                        row: r + 1,
                        column: sheet.columns[c],
                      })}
                      onFocus={() => {
                        if (keepSelection.current) {
                          keepSelection.current = false;
                        } else if (!inside(r, c)) {
                          choose(r, c);
                        }
                        setEditing({ row: r, column: c });
                      }}
                      onPointerDown={(event) => {
                        if (event.button !== 0) {
                          return;
                        }
                        if (event.shiftKey) {
                          event.preventDefault();
                          choose(r, c, true);
                        } else {
                          choose(r, c);
                        }
                        setEditing({ row: r, column: c });
                      }}
                      dangerouslySetInnerHTML={{
                        __html: cell ? previewHtml(cell) : '…',
                      }}
                    />
                  )}
                </td>
              ))}
              <td className='flow-actions'>
                <button className='mini' title={t('Remove row')} onClick={() => removeRow(r)}>
                  <Icon name='x' size={10} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className='flow-footer'>
        <button className='flow-add-row' onClick={() => addRow()}>
          {t('+ Add argument row')}{' '}
          {shortcutFor('flow-row') && <span className='hint'>{shortcutFor('flow-row')}</span>}
        </button>
        {shortcutHints.map(({ id, text }) => (
          <span className='flow-keyboard-hint' key={id}>
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}
