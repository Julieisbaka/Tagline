import { useState } from 'react';
import { useI18n } from '../lib/i18n.js';
import { binding, displayBinding } from '../lib/keybindings.js';

const ACTIONS = [
  ['pocket', 'Pocket'], ['hat', 'Hat'], ['block', 'Block'], ['tag', 'Tag'],
  ['cite', 'Cite / Bold'], ['underline', 'Underline'], ['emphasis', 'Emphasis'],
  ['highlight', 'Highlight'], ['clear-format', 'Clear formatting'],
  ['link', 'Link'], ['find', 'Find and replace'], ['send-card', 'Send card'],
];

export default function EditorToolbar({ actions, active = {}, keybindings }) {
  const { t } = useI18n();
  const [focused, setFocused] = useState(0);
  return <div className="visual-toolbar" role="toolbar" aria-label={t('Card formatting')}
    onKeyDown={(event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const buttons = [...event.currentTarget.querySelectorAll('button')];
      const index = buttons.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }}>
    {ACTIONS.map(([id, label], index) => <button key={id} type="button" data-editor-action={id}
      title={`${t(label)} ${displayBinding(binding(id, keybindings))}`.trim()}
      className={active[id] ? 'active' : ''} aria-pressed={active[id]}
      tabIndex={focused === index ? 0 : -1} onFocus={() => setFocused(index)}
      onMouseDown={(event) => event.preventDefault()} onClick={actions[id]}>{t(label)}</button>)}
  </div>;
}
