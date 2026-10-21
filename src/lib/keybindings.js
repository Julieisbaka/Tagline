import definitions from './keybindings.json';

export const KEYBINDINGS = definitions;
export const binding = (id, overrides = {}) => overrides[id] ?? definitions.find((item) => item.id === id)?.key ?? '';
export const displayBinding = (key, platform = window.api.platform) => key.replace(/\bMod\b/g, platform === 'darwin' ? 'Cmd' : 'Ctrl');

export function eventBinding(event, platform = window.api.platform) {
  if (['Control', 'Meta', 'Alt', 'Shift', 'Dead', 'Unidentified'].includes(event.key)) return '';
  const modifiers = [];
  if (platform === 'darwin' ? event.metaKey : event.ctrlKey) modifiers.push('Mod');
  if (platform === 'darwin' && event.ctrlKey) modifiers.push('Ctrl');
  if (platform !== 'darwin' && event.metaKey) modifiers.push('Meta');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  let key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  if (event.altKey && /^Key[A-Z]$/.test(event.code)) key = event.code.slice(3);
  return [...modifiers, key].join('+');
}

export function matchesBinding(event, shortcut, platform = window.api.platform) {
  if (!shortcut) return false;
  // Explicit Ctrl remains Ctrl on macOS; Mod follows the platform primary modifier.
  const normalize = (value) => value.replace(/\bMod\b/g, platform === 'darwin' ? 'Meta' : 'Ctrl');
  return normalize(eventBinding(event, platform)) === normalize(shortcut);
}

export function bindingConflict(id, key, overrides) {
  if (!key) return null;
  const target = definitions.find((item) => item.id === id);
  return definitions.find((item) => item.id !== id &&
    (item.scope === target.scope || item.scope === 'app' || target.scope === 'app') &&
    displayBinding(binding(item.id, overrides)) === displayBinding(key));
}

export function editorBinding(key) {
  const parts = key.split('+');
  const last = parts.pop();
  return [...parts, last?.length === 1 ? last.toLowerCase() : last === 'Space' ? ' ' : last].join('-');
}
