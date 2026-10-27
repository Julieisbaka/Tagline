import { useSyncExternalStore } from 'react';

let enabled = false;
const listeners = new Set();

/** 
 * Enable or disable the application's native editor UI affordances.
 * This function updates the internal state and toggles the corresponding CSS class on the document element, notifying all subscribed listeners of the change.
 * @param {boolean} value - True to enable the native UI, false to disable it.
 * @returns {void}
 */
export function setNativeUi(value) {
  if (enabled === value) return;
  enabled = value;
  document.documentElement.classList.toggle('native-ui', value);
  listeners.forEach((listener) => listener());
}

/** 
 * Read the current native UI setting for external-store subscribers.
 * This function returns the current state of the native UI setting, allowing external-store subscribers to access it.
 * @returns {boolean} - True if the native UI is enabled, false otherwise.
 */
export const nativeUiEnabled = () => enabled;

/** 
 * Subscribe to native UI setting changes.
 * This function allows external components to listen for changes to the native UI setting.
 * @param {function} listener - The callback function to invoke when the native UI setting changes.
 * @returns {function} - A function to unsubscribe the listener.
 */
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };

/** 
 * React hook returning the current native UI setting.
 * This hook subscribes to changes in the native UI setting and provides the current state to the component.
 * @returns {boolean} - True if the native UI is enabled, false otherwise.
 */
export const useNativeUi = () => useSyncExternalStore(subscribe, nativeUiEnabled);
