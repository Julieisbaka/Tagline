import { useSyncExternalStore } from 'react';

let enabled = false;
const listeners = new Set();
/** Enable or disable the application's native editor UI affordances. @param {boolean} value @returns {void} */
export function setNativeUi(value) {
  if (enabled === value) return;
  enabled = value;
  document.documentElement.classList.toggle('native-ui', value);
  listeners.forEach((listener) => listener());
}
/** Read the current native UI setting for external-store subscribers. @returns {boolean} */
export const nativeUiEnabled = () => enabled;
/** Subscribe to native UI setting changes. @param {function} listener @returns {function} */
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
/** React hook returning the current native UI setting. @returns {boolean} */
export const useNativeUi = () => useSyncExternalStore(subscribe, nativeUiEnabled);
