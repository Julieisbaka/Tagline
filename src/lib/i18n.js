import { useSyncExternalStore } from 'react';
import es from '../locales/es.json';
import fr from '../locales/fr.json';

export const LANGUAGES = { en: 'English', es: 'Español', fr: 'Français' };
const catalogs = { en: {}, es, fr };
let language = 'en';
const listeners = new Set();
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export function setLanguage(next) {
  if (!Object.hasOwn(catalogs, next)) throw new Error(`Unsupported language: ${next}`);
  document.documentElement.lang = next;
  if (language === next) return;
  language = next;
  listeners.forEach((fn) => fn());
}
export function translate(message, values = {}) {
  const text = catalogs[language][message] || message;
  return text.replace(/\{(\w+)\}/g, (match, key) => values[key] === undefined ? match : String(values[key]));
}
export function useI18n() {
  const locale = useSyncExternalStore(subscribe, () => language);
  return { t: translate, locale };
}
