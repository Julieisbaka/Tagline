import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { setLanguage } from './i18n.js';
import { applyTheme, getTheme } from './themes.js';
import { configureVisualCache } from './visualCache.js';

const DEFAULTS = {
  wpm: 250,
  speechDoc: 'Speech Docs/Speech.md',
  fontSize: 16,
  format: 'policy',
  readableWidth: true,
  theme: 'dark',
  editorMode: 'visual',
  focusNewFlowRow: true,
  language: 'en',
  customTheme: null,
  visualCacheEntries: 16,
  visualCacheCharacters: 4_000_000,
  searchMaxResults: 200,
  underscoreFolders: true,
  hideFlowExtension: true,
  fontFamily: '',
  importedFont: false,
  keybindings: {},
};

const KEY = 'tagline-settings';

function load() {
  try {
    const saved = localStorage.getItem(KEY);
    return { ...DEFAULTS, ...JSON.parse(saved || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function useSettings() {
  const [settings, setSettings] = useState(load);
  const [themeRevision, setThemeRevision] = useState(0);
  useEffect(() => {
    const onThemes = () => setThemeRevision((n) => n + 1);
    window.addEventListener('extensionthemes', onThemes);
    return () => window.removeEventListener('extensionthemes', onThemes);
  }, []);
  useLayoutEffect(() => {
    applyTheme(getTheme(settings.theme, settings.customTheme));
    setLanguage(settings.language);
  }, [settings.theme, settings.customTheme, settings.language, themeRevision]);
  useLayoutEffect(() => {
    configureVisualCache(settings.visualCacheEntries, settings.visualCacheCharacters);
  }, [settings.visualCacheEntries, settings.visualCacheCharacters]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--font-text', settings.importedFont ? '"Tagline Custom"' :
      settings.fontFamily.trim() ? `${JSON.stringify(settings.fontFamily.trim())}, system-ui, sans-serif` : 'system-ui, sans-serif');
  }, [settings.fontFamily, settings.importedFont]);
  useEffect(() => {
    if (!settings.importedFont) return;
    let disposed = false;
    let face;
    window.api.readFont().then(async (data) => {
      if (!data) throw new Error('The imported font is missing. Import it again in Settings.');
      face = new FontFace('Tagline Custom', `url("${data}")`);
      await face.load();
      if (!disposed) document.fonts.add(face);
    }).catch((e) => window.dispatchEvent(new CustomEvent('app-error', { detail: e.message })));
    return () => { disposed = true; if (face) document.fonts.delete(face); };
  }, [settings.importedFont]);
  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(settings));
    document.documentElement.style.setProperty('--editor-font-size', `${settings.fontSize}px`);
  }, [settings]);
  const update = useCallback((patch) => setSettings((s) => ({ ...s, ...patch })), []);
  return [settings, update];
}
