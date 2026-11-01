import { isMarkdown } from './vault.js';

export const VAULT_PATH_TYPE = 'text/vault-path';
export const NOTE_LINK_TYPE = 'application/x-tagline-note-link';

export function hasNoteDrag(dataTransfer) {
  return !!dataTransfer && [VAULT_PATH_TYPE, NOTE_LINK_TYPE].some((type) => dataTransfer.types.includes(type));
}

/** 
 * @param {DataTransfer} dataTransfer The data transfer object from the drag event.
 * @param {string[]} paths The list of valid note paths in the current vault.
 * @returns {string|null} The path of the dragged note if it exists in the vault, otherwise null.
 */
export function draggedNotePath(dataTransfer, paths = []) {
  const path = dataTransfer?.getData(NOTE_LINK_TYPE) || dataTransfer?.getData(VAULT_PATH_TYPE);
  return path && isMarkdown(path) && paths.includes(path) ? path : null;
}

/** 
 * Build a wiki link without allowing filename characters to change its target.
 * @param {string} path The path of the note to link to.
 * @returns {string} The wiki link for the specified note path.
 */
export function draggedNoteLink(path) {
  if (/[\]#|\r\n]/.test(path)) {
    throw new Error('Cannot link to a note whose path contains #, |, or ].');
  }
  return `[[${path}]]`;
}
