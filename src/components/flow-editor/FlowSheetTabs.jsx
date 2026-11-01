import { FLOW_PRESETS as PRESETS } from '../../../electron/flow.mjs';
import Icon from '../Icon.jsx';

export default function FlowSheetTabs({
  data, idx, renaming, setRenaming, settings, sheetDropIndex, setSheetDropIndex,
  draggedSheet, reorderSheet, removeSheet, setActive, setSelection, sheetTabsRef,
  addSheet, save, t, context,
}) {
  return (
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
  );
}
