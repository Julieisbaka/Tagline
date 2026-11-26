/**
 * Registry of callbacks that commit in-component drafts before the vault saves.
 *
 * Editors that keep a local draft (to avoid serializing the whole canvas on
 * every keystroke) register a flush here. The vault calls {@link flushPendingEdits}
 * when the app is asked to close, so drafts are persisted just like committed
 * edits.
 *
 * @type {Set<() => (boolean|void)>}
 */
const flushers = new Set();

/**
 * Register a flush callback.
 * @param {() => (boolean|void)} callback - Commits any local draft, or returns false if invalid.
 * @returns {() => void} Unregister function.
 */
export function registerPendingFlush(callback) {
  flushers.add(callback);
  return () => flushers.delete(callback);
}

/**
 * Commit all registered drafts. Safe to call repeatedly; each callback is
 * responsible for doing nothing when there is no pending draft.
 * @returns {boolean} False if any draft could not be committed.
 */
export function flushPendingEdits() {
  let valid = true;
  flushers.forEach((callback) => {
    if (callback() === false) {
      valid = false;
    }
  });
  return valid;
}
