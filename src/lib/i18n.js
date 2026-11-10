import { useSyncExternalStore } from 'react';
import es from '../locales/es.json' with { type: 'json' };
import fr from '../locales/fr.json' with { type: 'json' };
import { LANGUAGES, systemLanguage } from './localization.js';

export { LANGUAGES };
const catalogs = { en: {}, es, fr };
let language = systemLanguage(globalThis.window?.api?.systemLanguages);
const listeners = new Set();
const extensionCatalogs = new Map();
let revision = 0;
const notify = () => {
  revision += 1;
  listeners.forEach((fn) => fn());
};

function interpolate(text, values) {
  return text.replace(/\{(\w+)\}/g, (match, key) =>
    values[key] === undefined ? match : String(values[key])
  );
}

function extensionText(extensionId, key) {
  const catalogs = extensionCatalogs.get(extensionId);
  for (const locale of [language, 'en']) {
    const catalog = catalogs?.[locale];
    if (catalog && Object.hasOwn(catalog, key)) {
      return catalog[key];
    }
  }
  return undefined;
}

/** Replace all active extension translation catalogs. Keys stay namespaced by extension ID. */
export function registerExtensionTranslations(extensions = []) {
  extensionCatalogs.clear();
  for (const { id, translations } of extensions) {
    if (
      !/^[a-z0-9][a-z0-9-]{1,63}$/.test(id) ||
      !translations ||
      typeof translations !== 'object'
    ) {
      continue;
    }
    extensionCatalogs.set(id, translations);
  }
  notify();
}

/** Translate one extension-owned key, falling back to English and then the key itself. */
export function translateExtension(extensionId, key, values = {}) {
  return interpolate(extensionText(extensionId, key) ?? key, values);
}
/**
 * Subscribe to locale changes and return an unsubscribe callback.
 * @param {function} fn
 * @returns {function}
 */
const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
/**
 * Change the active language and notify subscribers.
 * @param {string} next
 * @returns {void}
 */
export function setLanguage(next) {
  if (!Object.hasOwn(catalogs, next)) {
    throw new Error(`Unsupported language: ${next}`);
  }
  document.documentElement.lang = next;
  if (language === next) {
    return;
  }
  language = next;
  notify();
}
/**
 * Translate a message key and interpolate named values.
 * @param {string} message
 * @param {object} [values]
 * @returns {string}
 */
export function translate(message, values = {}) {
  const extensionKey = /^ext\.([a-z0-9][a-z0-9-]{1,63})\.(.+)$/.exec(message);
  const text = extensionKey
    ? (extensionText(extensionKey[1], extensionKey[2]) ?? message)
    : catalogs[language][message] || message;
  return interpolate(text, values);
}
/**
 * React hook returning the translator and active locale.
 * @returns {{t:function,locale:string}}
 */
export function useI18n() {
  useSyncExternalStore(subscribe, () => revision);
  const locale = language;
  return { t: translate, locale };
}
