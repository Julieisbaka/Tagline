import dark from '../themes/dark.json';
import light from '../themes/light.json';
import contrastDark from '../themes/high-contrast-dark.json';
import contrastLight from '../themes/high-contrast-light.json';

export const BUILTIN_THEMES = [dark, light, contrastDark, contrastLight];
export const COLOR_TOKENS = Object.freeze(Object.keys(dark.colors));

export function validateTheme(value) {
  if (!value || value.version !== 1 || typeof value.name !== 'string' ||
      !value.name.trim() || value.name.length > 80 || !['dark', 'light'].includes(value.mode) ||
      !value.colors || typeof value.colors !== 'object' || Array.isArray(value.colors)) {
    throw new Error('Invalid theme. Expected version 1, name, mode, and colors.');
  }
  for (const [key, color] of Object.entries(value.colors)) {
    if (!COLOR_TOKENS.includes(key)) throw new Error(`Unknown theme color: ${key}`);
    if (typeof color !== 'string' || !/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) {
      throw new Error(`Invalid color for ${key}. Use #RRGGBB or #RRGGBBAA.`);
    }
  }
  const base = value.mode === 'light' ? light : dark;
  return {
    version: 1, id: 'custom', name: value.name.trim(), mode: value.mode,
    colors: { ...base.colors, ...value.colors },
  };
}

export function getTheme(id, customTheme) {
  if (id === 'custom') return validateTheme(customTheme);
  const theme = BUILTIN_THEMES.find((t) => t.id === id);
  if (!theme) throw new Error(`Unknown theme: ${id}`);
  return theme;
}

export function applyTheme(theme) {
  const root = document.documentElement;
  for (const key of COLOR_TOKENS) root.style.setProperty(`--${key}`, theme.colors[key]);
  root.dataset.theme = theme.id;
  root.style.colorScheme = theme.mode;
  window.dispatchEvent(new Event('themechange'));
}

// TODO: Support unrestricted custom CSS with explicit opt-in and documented isolation risks.
