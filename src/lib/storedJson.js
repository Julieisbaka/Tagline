export function readStoredJson(key, fallback, validate) {
  const text = localStorage.getItem(key);
  if (text === null) return structuredClone(fallback);
  let value;
  try { value = JSON.parse(text); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  if (validate(value)) return value;
  console.warn(`Reset invalid stored data: ${key}`);
  localStorage.removeItem(key);
  queueMicrotask(() => window.dispatchEvent(new CustomEvent('app-error', {
    detail: `Invalid saved data for ${key} was reset to defaults.`,
  })));
  return structuredClone(fallback);
}
