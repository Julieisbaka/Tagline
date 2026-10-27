export const REFRESH_TURN_MS = 600;

/** 
 * Return the number of complete animation turns for a nonnegative elapsed duration.
 * This function calculates how many full animation cycles have occurred based on the elapsed time and the defined turn duration.
 * @param {number} elapsed - The elapsed time in milliseconds.
 * @returns {number} - The number of complete animation turns, with a minimum of 1.
 */
export function refreshTurns(elapsed) {
  return Math.max(1, Math.ceil(elapsed / REFRESH_TURN_MS));
}
