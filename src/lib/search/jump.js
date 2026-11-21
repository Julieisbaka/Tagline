/**
 * Build the jump target produced when a search result is opened.
 *
 * SearchModal passes `{ line, cellMap }` so flow results can map a synthetic
 * search line back to a cell, while every other caller passes a bare line
 * number (or nothing). Normalising here keeps `jump.line` a number for the
 * markdown editor and preserves `jump.cellMap` for the flow editor.
 *
 * @param {string} path - Vault path being opened.
 * @param {number|{line: number, cellMap?: Array}} line - Line number or payload.
 * @param {number} [now] - Jump sequence value (defaults to current time).
 * @returns {{path: string, line: number|undefined, cellMap: Array|undefined, n: number}}
 */
export function makeJump(path, line, now = Date.now()) {
  const payload = line && typeof line === 'object' ? line : { line };
  return { path, line: payload.line, cellMap: payload.cellMap, n: now };
}
