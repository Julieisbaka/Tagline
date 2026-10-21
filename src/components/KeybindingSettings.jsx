import { useState } from 'react';
import { binding, bindingConflict, displayBinding, eventBinding, KEYBINDINGS, reservedBinding, validBinding } from '../lib/keybindings.js';
import { useI18n } from '../lib/i18n.js';

export default function KeybindingSettings({ settings, update }) {
  const { t } = useI18n();
  const [recording, setRecording] = useState(null);
  const [error, setError] = useState('');
  const overrides = settings.keybindings;
  const save = (id, key) => {
    if (key && (!validBinding(key) || reservedBinding(key))) {
      setError(t('This shortcut is unsupported or reserved for standard system commands.'));
      return;
    }
    const conflict = bindingConflict(id, key, overrides);
    if (conflict) { setError(t('Shortcut already assigned to: {command}', { command: t(conflict.label) })); return; }
    setError('');
    update({ keybindings: { ...overrides, [id]: key } });
    setRecording(null);
  };
  return <section className="keybinding-settings">
    <p>{t('Select a shortcut and press a key combination. Escape cancels; Delete removes it. Changes save automatically.')}</p>
    <button onClick={() => { update({ keybindings: {} }); setError(''); setRecording(null); }}>{t('Reset all shortcuts')}</button>
    {error && <p role="alert" className="error-text">{error}</p>}
    {['app', 'editor', 'flow'].map((scope) => <section key={scope}>
      <h4>{t({ app: 'Application', editor: 'Note editing', flow: 'Flow editing' }[scope])}</h4>
      {KEYBINDINGS.filter((item) => item.scope === scope).map((item) => <div className="setting-row keybinding-row" key={item.id}>
        <span>{t(item.label)}</span>
        <button className={recording === item.id ? 'recording' : ''} data-binding={item.id}
          aria-label={t('Shortcut for {command}', { command: t(item.label) })}
          onBlur={() => setRecording(null)}
          onClick={() => { setRecording(item.id); setError(''); }}
          onKeyDown={(event) => {
            if (recording !== item.id) return;
            event.preventDefault(); event.stopPropagation();
            if (event.key === 'Escape') { setRecording(null); return; }
            if (event.key === 'Delete' || event.key === 'Backspace') { save(item.id, ''); return; }
            const key = eventBinding(event);
            if (!key) return;
            if (!event.ctrlKey && !event.metaKey && !event.altKey && !/^F\d{1,2}$/.test(event.key)) {
              setError(t('Use a modifier key or a function key to avoid replacing normal typing.')); return;
            }
            save(item.id, key);
          }}>
          {recording === item.id ? t('Press shortcut...') : displayBinding(binding(item.id, overrides)) || t('Not assigned')}
        </button>
        <button className="mini" aria-label={t('Remove shortcut for {command}', { command: t(item.label) })}
          onClick={() => save(item.id, '')}>{t('Clear')}</button>
      </div>)}
    </section>)}
  </section>;
}
