export const REFRESH_TURN_MS = 600;

/** Return the number of complete animation turns for a nonnegative elapsed duration. @param {number} elapsed @returns {number} */
export function refreshTurns(elapsed) {
  return Math.max(1, Math.ceil(elapsed / REFRESH_TURN_MS));
}
