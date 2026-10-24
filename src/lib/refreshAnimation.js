export const REFRESH_TURN_MS = 600;

export function refreshTurns(elapsed) {
  return Math.max(1, Math.ceil(elapsed / REFRESH_TURN_MS));
}
