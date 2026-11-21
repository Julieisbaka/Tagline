import { baseName, isFlow, isMarkdown } from './vault.js';

export function canLinkCard(path) {
  return typeof path === 'string' && isMarkdown(path) && !/[\[\]#|\r\n]/.test(path);
}

/** Create a wikilink to the exact vault path, preserving an existing cell's text. */
export function linkCardInCell(cell, path) {
  if (!canLinkCard(path)) {
    throw new Error('This note path cannot be represented as a wikilink.');
  }
  const name = baseName(path);
  const link = `[[${path}|${name}]]`;
  return cell ? `${cell}${cell.endsWith('\n') ? '' : '\n'}${link}` : link;
}

/** Flow documents linking to a note, as recorded by the vault backlink index. */
export function flowsUsingCard(index, path) {
  return (index.backlinks[path] || []).filter(isFlow);
}
