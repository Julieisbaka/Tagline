import definitions from './keybindings.json' with { type: 'json' };

export const KEYBINDINGS = definitions;
/** Resolve a command's configured binding or its built-in default. @param {string} id @param {object} [overrides] @param {object[]} [extra] @returns {string} */
export const binding = (id, overrides = {}, extra = []) => overrides[id] ??
  [...definitions, ...extra].find((item) => item.id === id)?.key ?? '';
/** Format a Mod shortcut for the selected operating system. @param {string} key @param {string} [platform] @returns {string} */
export const displayBinding = (key, platform = window.api.platform) => key.replace(/\bMod\b/g, platform === 'darwin' ? 'Cmd' : 'Ctrl');
/** Test whether a shortcut string uses the supported key syntax. @param {string} key @returns {boolean} */
export const validBinding = (key) => /^(?:(?:Mod|Ctrl|Meta|Alt|Shift)\+)*(?:[A-Z0-9,.;/[\]'=\\`-]|F(?:[1-9]|1\d|2[0-4])|Enter|Tab|Space|Arrow(?:Up|Down|Left|Right)|Home|End|PageUp|PageDown|Escape)$/.test(key);
/** Return whether a shortcut is reserved for an editor or platform command. @param {string} key @returns {boolean} */
export function reservedBinding(key, id = '') {
  if (id === 'flow-undo' && key === 'Mod+Z') return false;
  if (id === 'flow-redo' && ['Mod+Shift+Z', 'Mod+Y'].includes(key)) return false;
  return ['Mod+A', 'Mod+C', 'Mod+X', 'Mod+V', 'Mod+Shift+V', 'Mod+Z', 'Mod+Shift+Z',
    'Mod+Y', 'Mod+Q', 'Mod+M', 'Mod+H', 'Mod+Alt+H', 'Mod+Shift+W', 'Mod+Shift+I',
    'Mod+R', 'Mod+Shift+R', 'Mod+0', 'Mod+-', 'Mod+=', 'Alt+F4', 'Mod+Space'].includes(key);
}

/** Convert a keyboard event into Tagline's normalized shortcut syntax. @param {KeyboardEvent} event @param {string} [platform] @returns {string} */
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
  if ((event.ctrlKey || event.metaKey) && /^Digit[0-9]$/.test(event.code)) key = event.code.slice(5);
  return [...modifiers, key].join('+');
}

/** Test whether a keyboard event matches a configured shortcut. @param {KeyboardEvent} event @param {string} shortcut @param {string} [platform] @returns {boolean} */
export function matchesBinding(event, shortcut, platform = window.api.platform) {
  if (!shortcut) return false;
  // Explicit Ctrl remains Ctrl on macOS; Mod follows the platform primary modifier.
  /** Normalize platform-specific Mod syntax for shortcut comparison. @param {string} value @returns {string} */
  const normalize = (value) => value.replace(/\bMod\b/g, platform === 'darwin' ? 'Meta' : 'Ctrl');
  return normalize(eventBinding(event, platform)) === normalize(shortcut);
}

// `extra` holds extension command definitions, which always use the app scope.
/** Find conflicts for a proposed binding in built-in and contributed commands. @param {string} id @param {string} key @param {object} overrides @param {object[]} [extra] @returns {object|null} */
export function bindingConflict(id, key, overrides, extra = []) {
  if (!key) return null;
  const all = [...definitions, ...extra];
  const target = all.find((item) => item.id === id);
  return all.find((item) => item.id !== id &&
    (item.scope === target.scope || item.scope === 'app' || target.scope === 'app') &&
    displayBinding(binding(item.id, overrides, extra)) === displayBinding(key));
}

/** Translate a shortcut to the editor library's key name. @param {string} key @returns {string} */
export function editorBinding(key) {
  const parts = key.split('+');
  const last = parts.pop();
  return [...parts, last?.length === 1 ? last.toLowerCase() : last === 'Space' ? ' ' : last].join('-');
}
