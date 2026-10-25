export * from '../../electron/canvas.mjs';
import { resolveLink } from './vault.js';

/**
 * Resolve a web URL, vault path, or [[file#heading|label]] without opening it.
 * @param {string} value Link text.
 * @param {string[]} paths Candidate vault-relative file paths.
 * @returns {{type:'web', url:string}|{type:'file', path:string, heading:string, label:string|undefined}|null}
 */
export function resolveCanvasLink(value, paths) {
  const target = value.trim();
  if (/^https?:\/\//i.test(target)) {
    try {
      const url = new URL(target);
      return { type: 'web', url: url.href };
    } catch { return null; }
  }
  const wiki = target.match(/^\[\[([^\]]+)\]\]$/);
  const [destination, label] = (wiki ? wiki[1] : target).split('|');
  const [file, ...heading] = destination.split('#');
  const path = resolveLink(file, paths);
  return path ? { type: 'file', path, heading: heading.join('#'), label } : null;
}
