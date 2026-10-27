/** Return nonnegative seconds remaining between a deadline and a clock value. @param {number} deadline @param {number} [now] @returns {number} */
export function remainingAt(deadline, now = Date.now()) {
  return Math.max(0, (deadline - now) / 1000);
}
