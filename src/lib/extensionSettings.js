import { getRuntimeLimits } from '../../electron/customization.mjs';
import { validateSettingValue } from '../../electron/extensionSettings.mjs';
import { readStoredJson } from './storedJson.js';

/** Find a declared settings schema entry by key. @param {object} manifest @param {string} key @returns {object|undefined} */
function definition(manifest, key) {
  const setting = manifest.contributes.settings?.find((item) => item.id === key);
  if (!setting) throw new Error(`Extension setting "${key}" is not declared.`);
  return setting;
}

/** Read the saved setting object for an extension from profile storage. @param {object} manifest @returns {object} */
function saved(manifest) {
  return readStoredJson(`tagline-extension-settings:${manifest.id}`, {},
    (value) => !!value && typeof value === 'object' && !Array.isArray(value));
}

/** Read a validated extension setting or its declared default. @param {object} manifest @param {string} key @returns {*} */
export function getExtensionSetting(manifest, key) {
  const setting = definition(manifest, key);
  const data = saved(manifest);
  return validateSettingValue(setting, Object.hasOwn(data, key) ? data[key] : setting.default);
}

/** Validate and persist a complete set of values for declared extension settings. @param {object} manifest @param {object} values @returns {boolean} */
export function setExtensionSettings(manifest, values) {
  const data = saved(manifest);
  for (const [key, value] of Object.entries(values)) {
    data[key] = validateSettingValue(definition(manifest, key), value);
  }
  const text = JSON.stringify(data);
  if (text.length > getRuntimeLimits().extensionStorageCharacters) throw new Error('Extension settings exceed the configured storage limit.');
  localStorage.setItem(`tagline-extension-settings:${manifest.id}`, text);
  window.dispatchEvent(new CustomEvent('extension-settings-changed'));
  return true;
}

/** Remove all saved values for one extension's declared settings. @param {object} manifest @returns {boolean} */
export function resetExtensionSettings(manifest) {
  localStorage.removeItem(`tagline-extension-settings:${manifest.id}`);
  window.dispatchEvent(new CustomEvent('extension-settings-changed'));
}
