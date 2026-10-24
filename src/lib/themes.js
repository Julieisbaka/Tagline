import { getRuntimeLimits } from '../../electron/customization.mjs';
import dark from '../themes/dark.json' with { type: 'json' };
import contrastDark from '../themes/high-contrast-dark.json' with { type: 'json' };
import contrastLight from '../themes/high-contrast-light.json' with { type: 'json' };
import light from '../themes/light.json' with { type: 'json' };

export const BUILTIN_THEMES = [dark, light, contrastDark, contrastLight];
export const COLOR_TOKENS = Object.freeze(Object.keys(dark.colors));

function validateVariables(value = {}, limits = getRuntimeLimits()) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > limits.themeVariables) {
    throw new Error(`Theme variables must be an object with at most ${limits.themeVariables} CSS custom properties.`);
  }
  for (const [key, text] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9-]{0,99}$/.test(key) || typeof text !== 'string' || !text.trim() ||
      text.length > limits.themeValueLength || /[;{}\0]|url\s*\(|@import/i.test(text)) {
      throw new Error(`Invalid theme variable: ${key}. Use a property name without -- and a CSS value without URLs or declarations.`);
    }
  }
  return { ...value };
}

export function validateTheme(value, limits = getRuntimeLimits()) {
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
    variables: validateVariables(value.variables, limits),
  };
}

export function getTheme(id, customTheme) {
  if (id === 'custom') return validateTheme(customTheme);
  const theme = BUILTIN_THEMES.find((t) => t.id === id) || extensionThemeList.find((t) => t.id === id);
  // Extension themes load asynchronously (or may be disabled); keep the saved choice and show dark meanwhile.
  if (!theme && id?.startsWith('ext:')) return dark;
  if (!theme) throw new Error(`Unknown theme: ${id}`);
  return theme;
}

let extensionThemeList = [];
export const extensionThemes = () => extensionThemeList;
export function registerExtensionThemes(themes) {
  extensionThemeList = themes;
  window.dispatchEvent(new Event('extensionthemes'));
}

let appliedVariables = [];
let appliedTheme = '';
let transitionTimer;

export function applyTheme(theme, animate = true) {
  const root = document.documentElement;
  const signature = JSON.stringify(theme);
  const changed = signature !== appliedTheme;
  clearTimeout(transitionTimer);
  root.classList.toggle('theme-transition', !!(animate && appliedTheme && changed &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches));
  if (root.classList.contains('theme-transition')) {
    // Commit the old colors before applying the new theme variables.
    root.getBoundingClientRect();
    transitionTimer = setTimeout(() => root.classList.remove('theme-transition'), 220);
  }
  for (const key of appliedVariables) root.style.removeProperty(`--${key}`);
  for (const key of COLOR_TOKENS) root.style.setProperty(`--${key}`, theme.colors[key]);
  appliedVariables = Object.keys(theme.variables || {});
  for (const key of appliedVariables) root.style.setProperty(`--${key}`, theme.variables[key]);
  root.dataset.theme = theme.id;
  root.style.colorScheme = theme.mode;
  appliedTheme = signature;
  window.dispatchEvent(new Event('themechange'));
}
