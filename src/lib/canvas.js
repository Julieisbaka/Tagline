export * from '../../electron/canvas.mjs';
import { resolveLink } from './vault.js';

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
