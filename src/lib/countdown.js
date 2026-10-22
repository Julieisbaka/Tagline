export function remainingAt(deadline, now = Date.now()) {
  return Math.max(0, (deadline - now) / 1000);
}
