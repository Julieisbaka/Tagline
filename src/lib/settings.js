import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { setRuntimeLimits } from '../../electron/customization.mjs';
import DEFAULTS from './defaultSettings.json' with { type: 'json' };
import { setLanguage } from './i18n.js';
import { initialLanguage } from './localization.js';
import { applyTheme, getTheme } from './themes.js';
import { configureVisualCache } from './visualCache.js';

const KEY = 'tagline-settings';

function load() {
  try {
    const saved = localStorage.getItem(KEY);
    const parsed = JSON.parse(saved || '{}');
    return { ...DEFAULTS, ...parsed, language: initialLanguage(parsed?.language, window.api.systemLanguages),
      internalFlags: { ...DEFAULTS.internalFlags, ...parsed?.internalFlags } };
  } catch {
    return { ...DEFAULTS, language: initialLanguage(undefined, window.api.systemLanguages) };
  }
}

export function useSettings() {
  const [settings, setSettings] = useState(load);
  const [themeRevision, setThemeRevision] = useState(0);
  useEffect(() => {
    const onThemes = () => setThemeRevision((n) => n + 1);
    window.addEventListener('extensionthemes', onThemes);
    window.addEventListener('customizationlimits', onThemes);
    window.api.getCustomizationLimits().then((limits) => {
      setRuntimeLimits(limits);
      onThemes();
    }).catch((error) => window.dispatchEvent(new CustomEvent('app-error', { detail: error.message })));
    return () => {
      window.removeEventListener('extensionthemes', onThemes);
      window.removeEventListener('customizationlimits', onThemes);
    };
  }, []);
  useLayoutEffect(() => {
    try { applyTheme(getTheme(settings.theme, settings.customTheme, settings.themeSettings), settings.themeTransition); }
    catch (error) { window.dispatchEvent(new CustomEvent('app-error', { detail: error.message })); }
    setLanguage(settings.language);
  }, [settings.theme, settings.customTheme, settings.themeSettings, settings.themeTransition, settings.language, themeRevision]);
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
    let variables;
    try { variables = getTheme(settings.theme, settings.customTheme, settings.themeSettings).variables || {}; }
    catch (error) { window.dispatchEvent(new CustomEvent('app-error', { detail: error.message })); return; }
    root.style.setProperty('--font-text', variables['font-text'] ?? (settings.importedFont ? '"Tagline Custom"' :
      settings.fontFamily.trim() ? `${JSON.stringify(settings.fontFamily.trim())}, system-ui, sans-serif` : 'system-ui, sans-serif'));
    root.style.setProperty('--editor-font-size', variables['editor-font-size'] ?? `${settings.fontSize}px`);
    const lineHeight = Number(settings.visualLineHeight);
    root.style.setProperty('--visual-line-height',
      Number.isFinite(lineHeight) && lineHeight >= 1 && lineHeight <= 2.5 ? String(lineHeight) : '1.65');
  }, [settings.fontFamily, settings.importedFont, settings.fontSize, settings.visualLineHeight,
  settings.theme, settings.customTheme, settings.themeSettings, themeRevision]);
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
