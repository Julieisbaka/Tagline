import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { setLanguage } from './i18n.js';
import { applyTheme, getTheme } from './themes.js';
import { configureVisualCache } from './visualCache.js';
import DEFAULTS from './defaultSettings.json' with { type: 'json' };

const KEY = 'tagline-settings';

function load() {
  try {
    const saved = localStorage.getItem(KEY);
    const parsed = JSON.parse(saved || '{}');
    return { ...DEFAULTS, ...parsed, internalFlags: { ...DEFAULTS.internalFlags, ...parsed?.internalFlags } };
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
    if (!settings.customCssEnabled || !settings.customCss) return;
    const style = document.createElement('style');
    style.id = 'tagline-custom-css';
    style.textContent = settings.customCss;
    document.head.append(style);
    return () => style.remove();
  }, [settings.customCssEnabled, settings.customCss]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const variables = getTheme(settings.theme, settings.customTheme).variables || {};
    root.style.setProperty('--font-text', variables['font-text'] ?? (settings.importedFont ? '"Tagline Custom"' :
      settings.fontFamily.trim() ? `${JSON.stringify(settings.fontFamily.trim())}, system-ui, sans-serif` : 'system-ui, sans-serif'));
    root.style.setProperty('--editor-font-size', variables['editor-font-size'] ?? `${settings.fontSize}px`);
  }, [settings.fontFamily, settings.importedFont, settings.fontSize, settings.theme, settings.customTheme, themeRevision]);
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
    try { localStorage.setItem(KEY, JSON.stringify(settings)); }
    catch (error) {
      console.error('Could not save settings:', error);
      window.dispatchEvent(new CustomEvent('app-error', { detail: `Could not save settings: ${error.message}` }));
    }
  }, [settings]);
  const update = useCallback((patch) => setSettings((s) => ({ ...s, ...patch })), []);
  return [settings, update];
}
