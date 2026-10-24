import { useEffect, useLayoutEffect, useRef } from 'react';
import { containFocus } from '../../lib/focusScope.js';
import { useI18n } from '../../lib/i18n.js';

export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const previousFocus = useRef(document.activeElement);
  const { t } = useI18n();
  useLayoutEffect(() => containFocus(ref.current, previousFocus.current), []);
  useLayoutEffect(() => {
    const el = ref.current;
    el.style.left = `${Math.max(4, Math.min(x, innerWidth - el.offsetWidth - 4))}px`;
    el.style.top = `${Math.max(4, Math.min(y, innerHeight - el.offsetHeight - 4))}px`;
    el.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [x, y]);
  useEffect(() => {
    const outside = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const escape = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('mousedown', outside);
    window.addEventListener('keydown', escape);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', outside);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="context-menu" role="menu" tabIndex={-1} style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()} onKeyDown={(e) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        const buttons = [...ref.current.querySelectorAll('button:not(:disabled)')];
        const i = buttons.indexOf(document.activeElement);
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1
          : (i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}>
      {items.map(({ label, run, disabled, danger }, i) => (
        <button key={i} role="menuitem" disabled={disabled}
          className={`context-item${danger ? ' danger' : ''}`}
          onClick={() => { onClose(); run(); }}>{t(label)}</button>
      ))}
    </div>
  );
}
