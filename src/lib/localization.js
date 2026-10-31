export const LANGUAGES = { en: 'English', es: 'Español', fr: 'Français' };

/** 
 * Return the first supported language found among system locale identifiers. 
 * @param {string[]} languages 
 * @returns {string} 
 */
export function systemLanguage(languages = []) {
  for (const locale of languages) {
    if (typeof locale !== 'string') continue;
    const base = locale.toLowerCase().split(/[-_]/)[0];
    if (Object.hasOwn(LANGUAGES, base)) return base;
  }
  return 'en';
}

/** 
 * Choose a supported saved language or fall back to the system preference. 
 * @param {string} saved 
 * @param {string[]} languages 
 * @returns {string} 
 */
export function initialLanguage(saved, languages) {
  return Object.hasOwn(LANGUAGES, saved) ? saved : systemLanguage(languages);
}
