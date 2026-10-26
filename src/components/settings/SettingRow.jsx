import { cloneElement, useId, useState } from 'react';
import { useI18n } from '../../lib/i18n.js';

export default function SettingRow({ label, description, children }) {
  const { t } = useI18n();
  const id = useId();
  const controlId = children.props.id || id;
  const helpId = `${id}-help`;
  const [open, setOpen] = useState(false);
  return <div className="setting-row">
    <div className="setting-label">
      <label htmlFor={controlId}>{label}</label>
      <span className="setting-help" onMouseEnter={() => setOpen(true)}
        onMouseLeave={(event) => {
          if (!event.currentTarget.contains(document.activeElement)) setOpen(false);
        }}>
        <button type="button" className="setting-help-button" aria-label={t('About {setting}', { setting: label })}
          aria-describedby={helpId} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
          onClick={() => setOpen(true)} onKeyDown={(event) => {
            if (event.key === 'Escape' && open) {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
            }
          }}>?</button>
        <span className="setting-tooltip" id={helpId} role="tooltip" hidden={!open}>{description}</span>
      </span>
    </div>
    {cloneElement(children, {
      id: controlId,
      'aria-describedby': [children.props['aria-describedby'], helpId].filter(Boolean).join(' '),
    })}
  </div>;
}
