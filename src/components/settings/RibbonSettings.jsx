import { useI18n } from '../../lib/i18n.js';
import { DEFAULT_RIBBON_ITEMS, normalizeRibbonItems, RIBBON_ITEMS } from '../../lib/ribbonItems.js';

export default function RibbonSettings({ settings, update }) {
  const { t } = useI18n();
  const visibleItems = normalizeRibbonItems(settings.ribbonItems);
  const move = (id, offset) => {
    const index = visibleItems.indexOf(id);
    const destination = index + offset;
    if (index < 0 || destination < 0 || destination >= visibleItems.length) return;
    const next = [...visibleItems];
    [next[index], next[destination]] = [next[destination], next[index]];
    update({ ribbonItems: next });
  };
  const toggle = (id, checked) => {
    update({
      ribbonItems: checked
        ? [...visibleItems, id]
        : visibleItems.filter((item) => item !== id),
    });
  };

  return (
    <div className="ribbon-settings">
      <h3>{t('Sidebar shortcuts')}</h3>
      <p>{t('Choose which shortcuts appear and change their order. Drag icons on the sidebar to reorder them. Settings stays available.')}</p>
      <ol>
        {RIBBON_ITEMS.map(({ id, title }) => {
          const index = visibleItems.indexOf(id);
          const checked = index >= 0;
          return (
            <li key={id} className={checked ? '' : 'hidden'}>
              <label>
                <input type="checkbox" data-ribbon-item={id} checked={checked}
                  onChange={(event) => toggle(id, event.target.checked)} />
                <span>{t(title)}</span>
              </label>
              {checked && <span className="ribbon-order">
                <button type="button" aria-label={t('Move {name} up', { name: t(title) })}
                  data-direction="up" disabled={index === 0} onClick={() => move(id, -1)}>↑</button>
                <button type="button" aria-label={t('Move {name} down', { name: t(title) })}
                  data-direction="down" disabled={index === visibleItems.length - 1}
                  onClick={() => move(id, 1)}>↓</button>
              </span>}
            </li>
          );
        })}
      </ol>
      <button type="button" data-ribbon-reset onClick={() => update({ ribbonItems: [...DEFAULT_RIBBON_ITEMS] })}>
        {t('Restore default shortcuts')}
      </button>
    </div>
  );
}
