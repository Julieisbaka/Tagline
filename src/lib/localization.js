export const LANGUAGES = { en: 'English', es: 'Español', fr: 'Français' };

export function systemLanguage(languages = []) {
  for (const locale of languages) {
    if (typeof locale !== 'string') continue;
    const base = locale.toLowerCase().split(/[-_]/)[0];
    if (Object.hasOwn(LANGUAGES, base)) return base;
  }
  return 'en';
}

export function initialLanguage(saved, languages) {
  return Object.hasOwn(LANGUAGES, saved) ? saved : systemLanguage(languages);
}
