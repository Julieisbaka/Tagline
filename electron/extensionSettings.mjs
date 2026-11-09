import { getRuntimeLimits } from './customization.mjs';

const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;

export function validateSettingValue(setting, value) {
  const fail = () => { throw new Error(`Invalid value for extension setting "${setting.id}".`); };
  if (setting.type === 'boolean') {
    if (typeof value !== 'boolean') fail();
  } else if (setting.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) ||
      (setting.min !== undefined && value < setting.min) ||
      (setting.max !== undefined && value > setting.max)) fail();
  } else if (setting.type === 'string') {
    if (typeof value !== 'string' || value.length > (setting.maxLength ?? 1000) ||
      (setting.enum && !setting.enum.includes(value))) fail();
  } else if (setting.type === 'array' || setting.type === 'object') {
    let text;
    try { text = JSON.stringify(value); } catch { fail(); }
    if (text.length > (setting.maxLength ?? 10000)) fail();
    if (setting.type === 'array' ? !Array.isArray(value) : !value || typeof value !== 'object' || Array.isArray(value)) fail();
    if (setting.schema && !validateJsonSchema(value, setting.schema)) fail();
  } else if (setting.type === 'secret') {
    if (typeof value !== 'string' || value.length > 10000) fail();
  } else if (setting.type === 'path') {
    if (typeof value !== 'string' || value.length > 1000 || value.startsWith('/') || value.includes('\\') || value.includes('..')) fail();
  } else fail();
  return value;
}

function validateJsonSchema(value, schema) {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (Object.keys(value).some((key) => schema.additionalProperties === false && !Object.hasOwn(schema.properties || {}, key))) return false;
    return Object.entries(schema.properties || {}).every(([key, child]) =>
      (value[key] === undefined && !(schema.required || []).includes(key)) || validateJsonSchema(value[key], child));
  }
  if (schema.type === 'array') return Array.isArray(value) && value.length <= (schema.maxItems ?? 100) && value.every((item) => validateJsonSchema(item, schema.items || {}));
  if (schema.type === 'string') return typeof value === 'string' && value.length <= (schema.maxLength ?? 1000);
  if (schema.type === 'number') return typeof value === 'number' && Number.isFinite(value) && (schema.minimum === undefined || value >= schema.minimum) && (schema.maximum === undefined || value <= schema.maximum);
  if (schema.type === 'integer') return Number.isInteger(value) && (schema.minimum === undefined || value >= schema.minimum) && (schema.maximum === undefined || value <= schema.maximum);
  if (schema.type === 'boolean') return typeof value === 'boolean';
  return false;
}

export function validateSettingDefinitions(definitions = [], limits = getRuntimeLimits()) {
  if (!Array.isArray(definitions) || definitions.length > limits.extensionSettings) {
    throw new Error(`contributes.settings must be a list of at most ${limits.extensionSettings} settings.`);
  }
  const seen = new Set();
  return definitions.map((setting) => {
    if (!setting || typeof setting.id !== 'string' || !ID.test(setting.id) || seen.has(setting.id) ||
      typeof setting.title !== 'string' || !setting.title.trim() || setting.title.length > 80 ||
      !['boolean', 'number', 'string', 'secret', 'array', 'object', 'path'].includes(setting.type)) {
      throw new Error('Each extension setting needs a unique id, title, and supported type.');
    }
    seen.add(setting.id);
    const allowed = ['id', 'title', 'description', 'type', 'default',
      ...(['array', 'object'].includes(setting.type) ? ['schema', 'maxLength'] : []),
      ...(setting.type === 'path' ? ['pathKind'] : []),
      ...(setting.type === 'number' ? ['min', 'max'] : []),
      ...(setting.type === 'string' ? ['maxLength', 'enum'] : [])];
    if (Object.keys(setting).some((key) => !allowed.includes(key))) {
      throw new Error(`Unsupported property for extension setting "${setting.id}".`);
    }
    if (setting.description !== undefined &&
      (typeof setting.description !== 'string' || setting.description.length > 500)) {
      throw new Error('Setting descriptions must be text up to 500 characters.');
    }
    for (const key of ['min', 'max']) {
      if (setting[key] !== undefined && !Number.isFinite(setting[key])) {
        throw new Error('Setting number bounds must be finite numbers.');
      }
    }
    if (setting.min !== undefined && setting.max !== undefined && setting.min > setting.max) {
      throw new Error('Setting min must not exceed max.');
    }
    if (setting.maxLength !== undefined &&
      (!Number.isInteger(setting.maxLength) || setting.maxLength < 1 || setting.maxLength > 10000)) {
      throw new Error('Setting maxLength must be an integer from 1 to 10000.');
    }
    if (setting.enum !== undefined && (!Array.isArray(setting.enum) || !setting.enum.length ||
      setting.enum.length > 50 || new Set(setting.enum).size !== setting.enum.length ||
      setting.enum.some((value) => typeof value !== 'string' || value.length > (setting.maxLength ?? 1000)))) {
      throw new Error('Setting enum must contain 1-50 unique string choices.');
    }
    if (['array', 'object'].includes(setting.type)) {
      if (!setting.schema || setting.schema.type !== setting.type || JSON.stringify(setting.schema).length > 4096) {
        throw new Error('Array/object settings require a matching JSON schema up to 4,096 characters.');
      }
    }
    if (setting.type === 'secret' && !setting.default) setting.default = '';
    if (setting.pathKind !== undefined && !['file', 'folder'].includes(setting.pathKind)) throw new Error('pathKind must be file or folder.');
    if (setting.type === 'path' && setting.default === undefined) setting.default = '';
    validateSettingValue(setting, setting.default);
    return { ...setting, title: setting.title.trim() };
  });
}
