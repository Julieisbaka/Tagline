import { getRuntimeLimits } from '../../electron/customization.mjs';
import { validateSettingDefinitions, validateSettingValue } from '../../electron/extensionSettings.mjs';
import dark from '../themes/dark.json' with { type: 'json' };
import contrastDark from '../themes/high-contrast-dark.json' with { type: 'json' };
import contrastLight from '../themes/high-contrast-light.json' with { type: 'json' };
import light from '../themes/light.json' with { type: 'json' };

/** The built-in dark, light, and high-contrast theme definitions. */
export const BUILTIN_THEMES = [dark, light, contrastDark, contrastLight];
/** CSS color tokens that custom themes may override. */
export const COLOR_TOKENS = Object.freeze(Object.keys(dark.colors));

/** Validate and copy custom CSS variables against runtime size and value limits. @param {object} [value] @param {object} [limits] @returns {object} */
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

/** Validate optional theme attribution and accessibility metadata. @param {object} [metadata] @returns {object} */
function validateMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Theme metadata must be an object.');
  const { author, description, license, tags = [], accessibility = {} } = metadata;
  if (Object.keys(metadata).some((key) => !['author', 'description', 'license', 'tags', 'accessibility'].includes(key)) ||
    [author, description, license].some((value) => value !== undefined && (typeof value !== 'string' || value.length > 500)) ||
    !Array.isArray(tags) || tags.length > 20 || tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 40)) {
    throw new Error('Invalid theme metadata fields.');
  }
  if (!accessibility || typeof accessibility !== 'object' || Array.isArray(accessibility) ||
    Object.keys(accessibility).some((key) => !['contrast', 'colorVision', 'reducedMotion', 'notes'].includes(key)) ||
    (accessibility.contrast !== undefined && !['standard', 'high'].includes(accessibility.contrast)) ||
    (accessibility.reducedMotion !== undefined && typeof accessibility.reducedMotion !== 'boolean') ||
    (accessibility.notes !== undefined && (typeof accessibility.notes !== 'string' || accessibility.notes.length > 1000)) ||
    (accessibility.colorVision !== undefined && (!Array.isArray(accessibility.colorVision) ||
      accessibility.colorVision.length > 4 || accessibility.colorVision.some((value) =>
        !['protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'].includes(value))))) {
    throw new Error('Invalid theme accessibility metadata.');
  }
  return { ...metadata, tags: [...tags], accessibility: { ...accessibility } };
}

/** Validate setting definitions and ensure each targets a declared theme variable. @param {object[]} [definitions] @param {object} theme @param {object} limits @returns {object[]} */
function validateThemeSettings(definitions = [], theme, limits) {
  if (!Array.isArray(definitions) || definitions.length > limits.extensionSettings) {
    throw new Error(`Theme settings must be a list of at most ${limits.extensionSettings}.`);
  }
  const targets = new Set();
  const ids = new Set();
  return definitions.map((definition) => {
    if (!definition || typeof definition !== 'object') throw new Error('Invalid theme setting.');
    const { variable, unit, ...setting } = definition;
    if (typeof variable !== 'string' || targets.has(variable) || ids.has(setting.id) ||
      !(COLOR_TOKENS.includes(variable) || Object.hasOwn(theme.variables, variable)) ||
      (unit !== undefined && (setting.type !== 'number' || !['px', 'em', 'rem', '%', ''].includes(unit)))) {
      throw new Error('Theme settings need unique declared CSS variables and valid numeric units.');
    }
    targets.add(variable);
    ids.add(setting.id);
    const color = COLOR_TOKENS.includes(variable);
    if (color && (setting.type !== 'string' || !/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(setting.default))) {
      throw new Error('Theme color settings require a string with a hex color default.');
    }
    if (!color && !['string', 'number'].includes(setting.type)) throw new Error('Theme variables require string or number settings.');
    const [validated] = validateSettingDefinitions([setting], limits);
    return { ...validated, variable, ...(unit !== undefined ? { unit } : {}) };
  });
}

/** Validate and normalize a version-1 custom theme. @param {object} value @param {object} [limits] @returns {object} */
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
  const theme = {
    version: 1, id: 'custom', name: value.name.trim(), mode: value.mode,
    colors: { ...base.colors, ...value.colors },
    variables: validateVariables(value.variables, limits),
    metadata: validateMetadata(value.metadata),
  };
  theme.settings = validateThemeSettings(value.settings, theme, limits);
  resolveThemeSettings(theme, {}, limits);
  return theme;
}

/** Apply saved theme-setting values to a copied theme definition. @param {object} theme @param {object} [values] @param {object} [limits] @returns {object} */
export function resolveThemeSettings(theme, values = {}, limits = getRuntimeLimits()) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Theme setting values must be an object.');
  const definitions = theme.settings || [];
  if (Object.keys(values).some((id) => !definitions.some((setting) => setting.id === id))) {
    throw new Error('Unknown theme setting.');
  }
  const result = { ...theme, colors: { ...theme.colors }, variables: { ...theme.variables } };
  for (const setting of definitions) {
    const value = validateSettingValue(setting, Object.hasOwn(values, setting.id) ? values[setting.id] : setting.default);
    if (COLOR_TOKENS.includes(setting.variable)) {
      if (typeof value !== 'string' || !/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value)) throw new Error('Theme settings require hex colors.');
      result.colors[setting.variable] = value;
      if (Object.hasOwn(result.variables, setting.variable)) result.variables[setting.variable] = value;
    } else {
      const text = `${value}${setting.unit || ''}`;
      validateVariables({ [setting.variable]: text }, limits);
      result.variables[setting.variable] = text;
    }
  }
  return result;
}

/** Resolve a built-in, extension, or custom theme and its saved settings. @param {string} id @param {object} customTheme @param {object} [themeSettings] @returns {object} */
export function getTheme(id, customTheme, themeSettings = {}) {
  if (id === 'custom') return resolveThemeSettings(validateTheme(customTheme), themeSettings[id]);
  const theme = BUILTIN_THEMES.find((t) => t.id === id) || extensionThemeList.find((t) => t.id === id);
  // Extension themes load asynchronously (or may be disabled); keep the saved choice and show dark meanwhile.
  if (!theme && id?.startsWith('ext:')) return dark;
  if (!theme) throw new Error(`Unknown theme: ${id}`);
  return resolveThemeSettings(theme, themeSettings[id]);
}

let extensionThemeList = [];
/** Return the currently registered extension themes. @returns {object[]} */
export const extensionThemes = () => extensionThemeList;
/** Replace registered extension themes and notify theme consumers. @param {object[]} themes @returns {void} */
export function registerExtensionThemes(themes) {
  extensionThemeList = themes;
  window.dispatchEvent(new Event('extensionthemes'));
}

let appliedVariables = [];
let appliedTheme = '';
let activeTheme;
let transitionTimer;

/** Apply theme colors and variables to the document root. @param {object} theme @param {boolean} [animate] @returns {void} */
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
  activeTheme = theme;
  window.dispatchEvent(new Event('themechange'));
}

/** Read the active theme and computed CSS variables for UI consumers. @returns {object} */
export function themeSnapshot() {
  const root = document.documentElement;
  const computed = getComputedStyle(root);
  const variables = Object.fromEntries([...computed].filter((key) => key.startsWith('--'))
    .map((key) => [key, computed.getPropertyValue(key).trim()]));
  return {
    id: root.dataset.theme, mode: root.style.colorScheme, variables,
    metadata: activeTheme?.metadata || {}, reducedMotion: root.classList.contains('reduce-motion') ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  };
}
