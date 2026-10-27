import { useSyncExternalStore } from 'react';
import es from '../locales/es.json';
import fr from '../locales/fr.json';
import { LANGUAGES, systemLanguage } from './localization.js';

export { LANGUAGES };
const catalogs = { en: {}, es, fr };
let language = systemLanguage(globalThis.window?.api?.systemLanguages);
const listeners = new Set();
/** 
 * Subscribe to locale changes and return an unsubscribe callback. 
 * @param {function} fn 
 * @returns {function} 
 */
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
/** 
 * Change the active language and notify subscribers. 
 * @param {string} next 
 * @returns {void} 
 */
export function setLanguage(next) {
  if (!Object.hasOwn(catalogs, next)) throw new Error(`Unsupported language: ${next}`);
  document.documentElement.lang = next;
  if (language === next) return;
  language = next;
  listeners.forEach((fn) => fn());
}
/** 
 * Translate a message key and interpolate named values. 
 * @param {string} message 
 * @param {object} [values] 
 * @returns {string} 
 */
export function translate(message, values = {}) {
  const text = catalogs[language][message] || message;
  return text.replace(/\{(\w+)\}/g, (match, key) => values[key] === undefined ? match : String(values[key]));
}
/** 
 * React hook returning the translator and active locale. 
 * @returns {{t:function,locale:string}} 
 */
export function useI18n() {
  const locale = useSyncExternalStore(subscribe, () => language);
  return { t: translate, locale };
}
