import { useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../lib/i18n.js';
import { containFocus, trapTabKey } from '../../lib/focusScope.js';
import { useNativeUi } from '../../lib/nativeUi.js';

export default function ContextMenu({ x, y, items, onClose }) {
  const native = useNativeUi();
  return native ? <NativeContextMenu items={items} onClose={onClose} />
    : <AppContextMenu x={x} y={y} items={items} onClose={onClose} />;
}

function NativeContextMenu({ items, onClose }) {
  const { t } = useI18n();
  const initial = useRef({ items, onClose, t });
  useEffect(() => {
    let active = true;
    const { items, onClose, t } = initial.current;
    window.api.nativeContextMenu(items.map((item) => ({ label: t(item.label), disabled: !!item.disabled })))
      .then(async (index) => {
        if (!active) return;
        onClose();
        if (index !== null) await items[index].run();
      }).catch((error) => {
        if (active) {
          onClose();
          window.dispatchEvent(new CustomEvent('app-error', { detail: error.message }));
        }
      });
    return () => { active = false; };
  }, []);
  return null;
}

function AppContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const previousFocus = useRef(document.activeElement);
  const { t } = useI18n();
  useLayoutEffect(() => containFocus(ref.current, previousFocus.current, false), []);
  useLayoutEffect(() => {
    const el = ref.current;
    el.style.left = `${Math.max(4, Math.min(x, innerWidth - el.offsetWidth - 4))}px`;
    el.style.top = `${Math.max(4, Math.min(y, innerHeight - el.offsetHeight - 4))}px`;
    el.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [x, y]);
  useEffect(() => {
    const outside = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const escape = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', escape);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);
  return createPortal(
    <div ref={ref} className="context-menu" role="menu" tabIndex={-1} style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }} onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
        if (e.key === 'Tab') { trapTabKey(e, ref.current); return; }
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
          onClick={async () => {
            onClose();
            try { await run(); }
            catch (error) { window.dispatchEvent(new CustomEvent('app-error', { detail: error.message })); }
          }}>{t(label)}</button>
      ))}
    </div>, document.body
  );
}
