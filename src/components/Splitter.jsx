import { useRef } from 'react';
import { useI18n } from '../lib/i18n.js';

export const PANEL_LIMITS = {
  sidebarWidth: { min: 160, max: 640, default: 260, variable: '--sidebar-width' },
  rightPanelWidth: { min: 200, max: 720, default: 300, variable: '--right-panel-width' },
};
// Width always left for the note/editor column, so a panel can never squeeze it away.
const MAIN_MIN = 320;
const RIBBON = 44;

export function clampPanel(key, value, otherWidth = 0) {
  const { min, max, default: fallback } = PANEL_LIMITS[key];
  const number = Number.isFinite(value) ? value : fallback;
  const room = typeof window === 'undefined' ? max : window.innerWidth - RIBBON - otherWidth - MAIN_MIN;
  return Math.round(Math.max(min, Math.min(max, room, number)));
}

// side = 'left' resizes a panel on the left of the handle (sidebar); 'right' resizes the right panel.
export default function Splitter({ panel, side, width, otherWidth, onChange, label }) {
  const { t } = useI18n();
  const drag = useRef(null);
  const { min, max, default: fallback, variable } = PANEL_LIMITS[panel];
  const root = () => document.querySelector('.app');
  const live = (value) => {
    const next = clampPanel(panel, value, otherWidth);
    root()?.style.setProperty(variable, `${next}px`);
    return next;
  };
  const finish = (event) => {
    if (!drag.current) return;
    const { current } = drag.current;
    drag.current = null;
    document.body.classList.remove('resizing-panels');
    if (event?.currentTarget?.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    onChange(current);
  };
  const step = (delta) => onChange(clampPanel(panel, width + delta, otherWidth));
  return <div
    className={`panel-splitter panel-splitter-${side}`}
    role="separator"
    aria-orientation="vertical"
    aria-label={t(label)}
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={width}
    tabIndex={0}
    title={t('Drag to resize; double-click to reset')}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { startX: event.clientX, startWidth: width, current: width };
      document.body.classList.add('resizing-panels');
    }}
    onPointerMove={(event) => {
      if (!drag.current) return;
      const delta = event.clientX - drag.current.startX;
      drag.current.current = live(drag.current.startWidth + (side === 'left' ? delta : -delta));
    }}
    onPointerUp={finish}
    onPointerCancel={finish}
    onLostPointerCapture={finish}
    onDoubleClick={() => onChange(clampPanel(panel, fallback, otherWidth))}
    onKeyDown={(event) => {
      const amount = event.shiftKey ? 64 : 16;
      const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
      const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
      if (event.key === grow) step(amount);
      else if (event.key === shrink) step(-amount);
      else if (event.key === 'Home') onChange(clampPanel(panel, min, otherWidth));
      else if (event.key === 'End') onChange(clampPanel(panel, max, otherWidth));
      else if (event.key === 'Enter') onChange(clampPanel(panel, fallback, otherWidth));
      else return;
      event.preventDefault();
    }}
  />;
}
