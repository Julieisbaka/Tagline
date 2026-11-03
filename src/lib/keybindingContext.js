import { createContext, useContext } from 'react';
import { binding } from './keybindings.js';

/** Supplies the user's shortcut overrides and extension commands to context menus. */
export const KeybindingsContext = createContext({ overrides: {}, extra: [] });

/** Resolve the configured shortcut for each menu item's `command` id, or '' when unassigned. @returns {(command?: string) => string} */
export function useShortcutLookup() {
  const { overrides, extra } = useContext(KeybindingsContext);
  return (command) => (command ? binding(command, overrides, extra) : '');
}
