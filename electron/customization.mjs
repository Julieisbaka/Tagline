export const LIMIT_DEFINITIONS = Object.freeze({
  themeFileBytes: { label: 'Theme file bytes', default: 65536, min: 1024, max: 1048576 },
  themeVariables: { label: 'Theme CSS variable count', default: 256, min: 1, max: 2048 },
  themeValueLength: { label: 'Theme CSS value characters', default: 2048, min: 32, max: 16384 },
  extensionSourceBytes: { label: 'Extension script bytes', default: 1048576, min: 1024, max: 8388608 },
  extensionCommands: { label: 'Commands per extension', default: 50, min: 1, max: 500 },
  extensionThemes: { label: 'Themes per extension', default: 20, min: 1, max: 200 },
  extensionSettings: { label: 'Settings per extension', default: 32, min: 1, max: 256 },
  extensionWatches: { label: 'Listeners per event type per extension', default: 32, min: 1, max: 256 },
  extensionPendingCalls: { label: 'Pending calls per extension', default: 32, min: 1, max: 256 },
  extensionMessagesPerSecond: { label: 'Messages per second per extension', default: 200, min: 10, max: 2000 },
  extensionStorageCharacters: { label: 'Storage characters per extension store', default: 100000, min: 1000, max: 1000000 },
  extensionStartupMs: { label: 'Extension startup timeout (ms)', default: 10000, min: 1000, max: 60000 },
  extensionHeartbeatMs: { label: 'Extension heartbeat timeout (ms)', default: 5000, min: 1000, max: 30000 },
});

export const DEFAULT_LIMITS = Object.freeze(Object.fromEntries(
  Object.entries(LIMIT_DEFINITIONS).map(([key, definition]) => [key, definition.default]),
));

export function validateLimits(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid customization limits.');
  const limits = { ...DEFAULT_LIMITS };
  for (const [key, number] of Object.entries(value)) {
    const definition = LIMIT_DEFINITIONS[key];
    if (!Object.hasOwn(LIMIT_DEFINITIONS, key) || !Number.isInteger(number) ||
      number < definition.min || number > definition.max) {
      throw new Error(`Invalid customization limit: ${key}.`);
    }
    limits[key] = number;
  }
  return limits;
}

let runtimeLimits = DEFAULT_LIMITS;
export const getRuntimeLimits = () => runtimeLimits;
export function setRuntimeLimits(value) {
  runtimeLimits = Object.freeze(validateLimits(value));
  return runtimeLimits;
}
