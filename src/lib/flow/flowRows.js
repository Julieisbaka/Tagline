/**
 * Whether a flow sheet still has a row left after removing one.
 * A sheet always keeps at least one argument row so it can never become
 * empty; the remove-row controls use this to give feedback instead of
 * silently no-op-ing on the last row.
 *
 * @param {number} rowCount - Number of rows currently in the sheet.
 * @returns {boolean}
 */
export function canRemoveRow(rowCount) {
  return rowCount > 1;
}
