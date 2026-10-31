/** 
 * Return nonnegative seconds remaining between a deadline and a clock value.
 * @param {number} deadline - The target time in milliseconds since the Unix epoch.
 * @param {number} [now] - The current time in milliseconds since the Unix epoch. Defaults to Date.now().
 * @returns {number} - The number of seconds remaining until the deadline, or 0 if the deadline has passed.
 */
export function remainingAt(deadline, now = Date.now()) {
  return Math.max(0, (deadline - now) / 1000);
}
