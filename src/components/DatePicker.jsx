import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { dateValue, monthDays, moveMonth, parseDate } from '../lib/calendar.js';
import { useI18n } from '../lib/i18n.js';

export default function DatePicker({ name, label, value, onChange }) {
  const { t, locale } = useI18n();
  const id = useId();
  const root = useRef(null);
  const toggle = useRef(null);
  const input = useRef(null);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(() => parseDate(value) || new Date());
  const focusDay = useRef(false);
  const days = monthDays(focused);
  const today = dateValue(new Date());
  const close = () => { setOpen(false); toggle.current.focus({ preventScroll: true }); };
  useEffect(() => {
    input.current.setCustomValidity(value && !parseDate(value) ? t('Enter a valid date in YYYY-MM-DD format.') : '');
  }, [value, t, locale]);
  useEffect(() => {
    if (!open) return;
    const outside = (event) => { if (!root.current.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);
  useLayoutEffect(() => {
    if (open && focusDay.current) {
      root.current.querySelector(`[data-date="${dateValue(focused)}"]`)?.focus({ preventScroll: true });
      focusDay.current = false;
    }
  }, [open, focused]);
  const move = (date) => { focusDay.current = true; setFocused(date); };
  const select = (date) => { onChange(dateValue(date)); close(); };
  const monthLabel = focused.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  return <div className="date-picker" ref={root} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={(event) => {
    if (open && event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); close();
    }
  }}>
    <div className="date-picker-field">
      <input ref={input} id={id} name={name} type="text" aria-label={label} value={value}
        placeholder="YYYY-MM-DD" pattern="\d{4}-\d{2}-\d{2}" maxLength={10}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && event.altKey) {
            event.preventDefault(); focusDay.current = true;
            setFocused(parseDate(value) || new Date()); setOpen(true);
          }
        }} />
      <button ref={toggle} type="button" aria-label={t('Choose date')} aria-expanded={open}
        aria-controls={`${id}-calendar`} onClick={() => {
          if (open) return close();
          focusDay.current = true; setFocused(parseDate(value) || new Date()); setOpen(true);
        }}>{t('Calendar')}</button>
    </div>
    {open && <div id={`${id}-calendar`} className="date-picker-calendar" role="group" aria-label={t('Choose date')}>
      <div className="date-picker-navigation">
        <button type="button" aria-label={t('Previous month')} onClick={() => setFocused(moveMonth(focused, -1))}>&lt;</button>
        <span aria-live="polite">{monthLabel}</span>
        <button type="button" aria-label={t('Next month')} onClick={() => setFocused(moveMonth(focused, 1))}>&gt;</button>
      </div>
      <table role="grid" aria-label={monthLabel}>
        <thead><tr>{Array.from({ length: 7 }, (_, day) => {
          const date = new Date(2024, 0, 7 + day);
          return <th key={day} scope="col" abbr={date.toLocaleDateString(locale, { weekday: 'long' })}>{weekday.format(date)}</th>;
        })}</tr></thead>
        <tbody>{Array.from({ length: days.length / 7 }, (_, week) => <tr key={week}>
          {days.slice(week * 7, week * 7 + 7).map((date, day) => <td key={day}
            aria-selected={date ? dateValue(date) === value : undefined}>
            {date && <button type="button" data-date={dateValue(date)}
              className={dateValue(date) === value ? 'selected' : ''}
              tabIndex={dateValue(date) === dateValue(focused) ? 0 : -1}
              aria-current={dateValue(date) === today ? 'date' : undefined}
              aria-label={date.toLocaleDateString(locale, { dateStyle: 'full' })}
              onFocus={() => setFocused(date)} onClick={() => select(date)}
              onKeyDown={(event) => {
                let next = new Date(date);
                if (event.key === 'ArrowLeft') next.setDate(next.getDate() - 1);
                else if (event.key === 'ArrowRight') next.setDate(next.getDate() + 1);
                else if (event.key === 'ArrowUp') next.setDate(next.getDate() - 7);
                else if (event.key === 'ArrowDown') next.setDate(next.getDate() + 7);
                else if (event.key === 'Home') next.setDate(next.getDate() - next.getDay());
                else if (event.key === 'End') next.setDate(next.getDate() + 6 - next.getDay());
                else if (event.key === 'PageUp') next = moveMonth(date, event.shiftKey ? -12 : -1);
                else if (event.key === 'PageDown') next = moveMonth(date, event.shiftKey ? 12 : 1);
                else return;
                event.preventDefault(); event.stopPropagation();
                if (next.getFullYear() >= 1 && next.getFullYear() <= 9999) move(next);
              }}>{date.getDate()}</button>}
          </td>)}
        </tr>)}</tbody>
      </table>
      <div className="date-picker-actions">
        <button type="button" onClick={() => select(new Date())}>{t('Today')}</button>
        <button type="button" onClick={() => { onChange(''); close(); }}>{t('Clear')}</button>
      </div>
    </div>}
  </div>;
}
