export * from '../../../electron/canvas.mjs';
import { resolveLink } from '../vault/vault.js';

/**
 * Resolve a web URL, vault path, or [[file#heading|label]] without opening it.
 * @param {string} value Link text.
 * @param {string[]} paths Candidate vault-relative file paths.
 * @param {string} [currentPath] Canvas file path, used for same-document anchors.
 * @returns {{type:'web', url:string}|{type:'file', path:string, heading:string, label:string|undefined}|null}
 */
export function resolveCanvasLink(value, paths, currentPath) {
  const target = value.trim();
  if (/^https?:\/\//i.test(target)) {
    try {
      const url = new URL(target);
      return { type: 'web', url: url.href };
    } catch {
      return null;
    }
  }
  const wiki = target.match(/^\[\[([^\]]+)\]\]$/);
  const raw = wiki ? wiki[1] : target;
  // Only wiki targets carry a | alias; a plain path may legitimately contain |.
  const [destination, label] = wiki ? raw.split('|') : [raw, undefined];
  const hash = destination.indexOf('#');
  const file = hash < 0 ? destination : destination.slice(0, hash);
  const heading = hash < 0 ? '' : destination.slice(hash + 1);
  const path = file.trim() ? resolveLink(file, paths) : currentPath || null;
  return path ? { type: 'file', path, heading, label } : null;
}
