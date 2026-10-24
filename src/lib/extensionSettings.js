import { validateSettingValue } from '../../electron/extensionSettings.mjs';
import { getRuntimeLimits } from '../../electron/customization.mjs';

function definition(manifest, key) {
  const setting = manifest.contributes.settings?.find((item) => item.id === key);
  if (!setting) throw new Error(`Extension setting "${key}" is not declared.`);
  return setting;
}

function saved(manifest) {
  // TODO: Handle malformed stored JSON so one corrupt extension setting can be reset without surfacing a parse error.
  const data = JSON.parse(localStorage.getItem(`tagline-extension-settings:${manifest.id}`) || '{}');
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`Invalid stored settings for extension "${manifest.id}". Reset its settings.`);
  }
  return data;
}

export function getExtensionSetting(manifest, key) {
  const setting = definition(manifest, key);
  const data = saved(manifest);
  return validateSettingValue(setting, Object.hasOwn(data, key) ? data[key] : setting.default);
}

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

export function resetExtensionSettings(manifest) {
  localStorage.removeItem(`tagline-extension-settings:${manifest.id}`);
  window.dispatchEvent(new CustomEvent('extension-settings-changed'));
}
