import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.js';
import ContextMenu from './ContextMenu.jsx';
import Icon from './Icon.jsx';
import { binding, displayBinding, matchesBinding } from '../lib/keybindings.js';

const AFF = new Set(['1AC', '2AC', '1AR', '2AR', 'AC', 'AR']);
const PRESETS = {
  'On-case (Aff)': ['1AC', '1NC', '2AC', 'Block', '1AR', '2NR', '2AR'],
  'Off-case (Neg)': ['1NC', '2AC', 'Block', '1AR', '2NR', '2AR'],
  'CX notes': ['1AC CX', '1NC CX', '2AC CX', '2NC CX'],
};

export const EMPTY_FLOW = JSON.stringify(
  { version: 1, sheets: [{ name: 'Case', columns: PRESETS['On-case (Aff)'], rows: [Array(7).fill('')] }] },
  null,
  2,
);

const sideOf = (col) => (AFF.has(col.split(' ')[0].toUpperCase()) ? 'aff' : 'neg');

export default function FlowEditor({ content, onChange, focusNewFlowRow = true, keybindings }) {
  const { t } = useI18n();
  const [active, setActive] = useState(0);
  const [renaming, setRenaming] = useState(null);
  const [menu, setMenu] = useState(null);
  const gridRef = useRef(null);
  const focusTarget = useRef(null);
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

  const parsed = useMemo(() => {
    try {
      const data = JSON.parse(content || '{}');
      if (!Array.isArray(data.sheets) || !data.sheets.length || data.sheets.some((s) =>
        typeof s.name !== 'string' || !Array.isArray(s.columns) || !s.columns.length ||
        s.columns.some((c) => typeof c !== 'string') || !Array.isArray(s.rows) ||
        s.rows.some((r) => !Array.isArray(r) || r.length !== s.columns.length ||
          r.some((c) => typeof c !== 'string')))) throw new Error('Invalid flow structure');
      return { data };
    } catch (e) {
      return { error: e.message };
    }
  }, [content]);

  if (parsed.error) {
    return (
      <div className="flow-error">
        <p>{t('This flow file could not be parsed ({error}).', { error: parsed.error })}</p>
        <button onClick={() => onChange(EMPTY_FLOW)}>{t('Reset to an empty flow')}</button>
      </div>
    );
  }

  const { data } = parsed;
  const idx = Math.min(active, data.sheets.length - 1);
  const sheet = data.sheets[idx];
  const save = (sheets) => onChange(JSON.stringify({ ...data, sheets }, null, 2));
  const updateSheet = (patch) => save(data.sheets.map((s, i) => (i === idx ? { ...s, ...patch } : s)));

  const addSheet = (preset) => {
    const columns = PRESETS[preset];
    const name = preset.startsWith('Off') ? 'Off-case' : preset.startsWith('CX') ? 'CX' : 'Case';
    save([...data.sheets, { name, columns, rows: [Array(columns.length).fill('')] }]);
    setActive(data.sheets.length);
  };

  const removeSheet = (i) => {
    if (data.sheets.length === 1) return;
    if (!window.confirm(t('Delete sheet "{name}"?', { name: data.sheets[i].name }))) return;
    save(data.sheets.filter((_, j) => j !== i));
    setActive(Math.max(0, i - 1));
  };

  const setCell = (r, c, value) =>
    updateSheet({ rows: sheet.rows.map((row, i) => (i === r ? row.map((v, j) => (j === c ? value : v)) : row)) });

  const addRow = (after = sheet.rows.length - 1, column = null) => {
    const rows = [...sheet.rows];
    rows.splice(after + 1, 0, Array(sheet.columns.length).fill(''));
    if (column !== null && focusNewFlowRow) focusTarget.current = { row: after + 1, column };
    updateSheet({ rows });
  };

  const removeRow = (r) => updateSheet({ rows: sheet.rows.filter((_, i) => i !== r) });

  const renameColumn = (c, name) => updateSheet({ columns: sheet.columns.map((v, i) => (i === c ? name : v)) });

  const addColumn = () =>
    updateSheet({ columns: [...sheet.columns, 'New'], rows: sheet.rows.map((row) => [...row, '']) });

  const removeColumn = (c) => {
    if (sheet.columns.length === 1) return;
    updateSheet({
      columns: sheet.columns.filter((_, i) => i !== c),
      rows: sheet.rows.map((row) => row.filter((_, i) => i !== c)),
    });
  };

  return (
    <div className="flow">
      <div className="flow-sheets">
        {data.sheets.map((s, i) =>
          renaming === i ? (
            <input
              key={i}
              className="flow-sheet-input"
              autoFocus
              defaultValue={s.name}
              onBlur={(e) => {
                save(data.sheets.map((x, j) => (j === i ? { ...x, name: e.target.value || x.name } : x)));
                setRenaming(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
            />
          ) : (
            <div
              key={i}
              className={`flow-sheet-tab${i === idx ? ' active' : ''}`}
              tabIndex={0}
              role="button"
              aria-pressed={i === idx}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActive(i); }
              }}
              onClick={() => setActive(i)}
              onDoubleClick={() => setRenaming(i)}
              onContextMenu={(e) => context(e, [
                { label: 'Rename sheet', run: () => setRenaming(i) },
                { label: 'Delete sheet', run: () => removeSheet(i), disabled: data.sheets.length === 1, danger: true },
              ])}
              title={t('Double-click to rename')}
            >
              {s.name}
              {data.sheets.length > 1 && (
                <span
                  className="flow-sheet-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSheet(i);
                  }}
                >
                  <Icon name="x" size={10} />
                </span>
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
        <table className="flow-grid">
          <thead>
            <tr>
              {sheet.columns.map((col, c) => (
                <th key={c} className={`side-${sideOf(col)}`} onContextMenu={(e) => context(e, [
                  { label: 'Add column', run: addColumn },
                  { label: 'Remove column', run: () => removeColumn(c), disabled: sheet.columns.length === 1, danger: true },
                ])}>
                  <input value={col} onChange={(e) => renameColumn(c, e.target.value)} />
                  <button className="mini" title={t('Remove column')} onClick={() => removeColumn(c)}>
                    <Icon name="x" size={10} />
                  </button>
                </th>
              ))}
              <th className="flow-actions">
                <button className="mini" title={t('Add column')} onClick={addColumn}>
                  +
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className={`side-${sideOf(sheet.columns[c] || '')}`}
                    onContextMenu={(e) => context(e, [
                      { label: 'Insert row below', run: () => addRow(r, c) },
                      { label: 'Clear cell', run: () => setCell(r, c, '') },
                      { label: 'Remove row', run: () => removeRow(r), danger: true },
                    ])}>
                    <textarea
                      data-row={r}
                      data-column={c}
                      aria-label={t('Row {row}, {column}', { row: r + 1, column: sheet.columns[c] })}
                      value={cell}
                      placeholder="…"
                      onChange={(e) => setCell(r, c, e.target.value)}
                      onKeyDown={(e) => {
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
        <button className="flow-add-row" onClick={() => addRow()}>
          {t('+ Add argument row')} <span className="hint">{displayBinding(binding('flow-row', keybindings))}</span>
        </button>
      </div>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
