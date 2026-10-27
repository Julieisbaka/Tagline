/** 
 * Load JSON from local storage, validate it, and reset invalid data to a cloned fallback.
 * @param {string} key - The localStorage key to read the JSON from.
 * @param {*} fallback - The fallback value to use if the stored JSON is missing or invalid.
 * @param {function} validate - A function that takes the parsed JSON and returns true if it is valid.
 * @returns {*} - The parsed and validated JSON, or a cloned fallback if invalid.
 */
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
