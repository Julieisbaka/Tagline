import { getRuntimeLimits } from '../../electron/customization.mjs';
import { validateSettingValue } from '../../electron/extensionSettings.mjs';
import { readStoredJson } from './storedJson.js';

/** 
 * Find a declared settings schema entry by key.
 * This function searches the extension manifest for a settings schema entry that matches the specified key. If the entry is not found, it throws an error to indicate that the setting is not declared in the manifest.
 * @param {object} manifest - The extension manifest object containing the settings schema.
 * @param {string} key - The key of the setting to look up.
 * @returns {object|undefined} - The settings schema entry corresponding to the key, or undefined if not found.
 */
function definition(manifest, key) {
  const setting = manifest.contributes.settings?.find((item) => item.id === key);
  if (!setting) throw new Error(`Extension setting "${key}" is not declared.`);
  return setting;
}

/** 
 * Read the saved setting object for an extension from profile storage.
 * This function retrieves the persisted settings for a given extension from the profile's local storage. It ensures that the returned value is a valid object and not an array.
 * @param {object} manifest - The extension manifest object used to identify the storage key.
 * @returns {object} - The saved settings object for the extension, or an empty object if none are found.
 */
function saved(manifest) {
  return readStoredJson(`tagline-extension-settings:${manifest.id}`, {},
    (value) => !!value && typeof value === 'object' && !Array.isArray(value));
}

/** 
 * Read a validated extension setting or its declared default.
 * This function retrieves the value of a specific extension setting, ensuring that it conforms to the declared schema. If the setting is not explicitly saved, the function falls back to the declared default value.
 * @param {object} manifest - The extension manifest object containing the settings schema.
 * @param {string} key - The key of the setting to retrieve.
 * @returns {*} - The validated value of the setting, either from saved data or the declared default.
 */
export function getExtensionSetting(manifest, key) {
  const setting = definition(manifest, key);
  const data = saved(manifest);
  return validateSettingValue(setting, Object.hasOwn(data, key) ? data[key] : setting.default);
}

/** 
 * Validate and persist a complete set of values for declared extension settings.
 * This function takes an object containing key-value pairs for extension settings, validates each value against the declared schema, and persists the validated settings to local storage. It also ensures that the total storage size does not exceed the configured runtime limits.
 * @param {object} manifest - The extension manifest object containing the settings schema.
 * @param {object} values - An object containing key-value pairs for the settings to be saved.
 * @returns {boolean} - Returns true if the settings were successfully validated and persisted.
 */
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

/** 
 * Remove all saved values for one extension's declared settings.
 * This function clears all persisted settings for the specified extension from local storage and notifies listeners of the change.
 * @param {object} manifest - The extension manifest object used to identify the storage key.
 * @returns {boolean} - Returns true if the settings were successfully removed.
 */
export function resetExtensionSettings(manifest) {
  localStorage.removeItem(`tagline-extension-settings:${manifest.id}`);
  window.dispatchEvent(new CustomEvent('extension-settings-changed'));
}
