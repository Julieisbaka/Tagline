import { useSyncExternalStore } from 'react';

let enabled = false;
const listeners = new Set();
export function setNativeUi(value) {
  if (enabled === value) return;
  enabled = value;
  document.documentElement.classList.toggle('native-ui', value);
  listeners.forEach((listener) => listener());
}
export const nativeUiEnabled = () => enabled;
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
export const useNativeUi = () => useSyncExternalStore(subscribe, nativeUiEnabled);
