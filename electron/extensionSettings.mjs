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
  } else fail();
  return value;
}

export function validateSettingDefinitions(definitions = []) {
  if (!Array.isArray(definitions) || definitions.length > 32) {
    throw new Error('contributes.settings must be a list of at most 32 settings.');
  }
  const seen = new Set();
  return definitions.map((setting) => {
    if (!setting || !ID.test(setting.id) || seen.has(setting.id) ||
      typeof setting.title !== 'string' || !setting.title.trim() || setting.title.length > 80 ||
      !['boolean', 'number', 'string'].includes(setting.type)) {
      throw new Error('Each extension setting needs a unique id, title, and boolean/number/string type.');
    }
    seen.add(setting.id);
    const allowed = ['id', 'title', 'description', 'type', 'default',
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
    validateSettingValue(setting, setting.default);
    return { ...setting, title: setting.title.trim() };
  });
}
