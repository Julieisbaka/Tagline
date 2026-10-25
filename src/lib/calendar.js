export function dateValue(date) {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  return dateValue(date) === value ? date : null;
}

export function moveMonth(date, amount) {
  const next = new Date(date);
  const day = date.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + amount);
  const last = new Date(next);
  last.setMonth(last.getMonth() + 1, 0);
  next.setDate(Math.min(day, last.getDate()));
  return next.getFullYear() >= 1 && next.getFullYear() <= 9999 ? next : date;
}

export function monthDays(date) {
  const start = new Date(date);
  start.setDate(1);
  const offset = start.getDay();
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1, 0);
  return Array.from({ length: Math.ceil((offset + end.getDate()) / 7) * 7 }, (_, index) => {
    const day = index - offset + 1;
    if (day < 1 || day > end.getDate()) return null;
    const result = new Date(start);
    result.setDate(day);
    return result;
  });
}
