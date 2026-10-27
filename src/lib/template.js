import { splitFrontmatter } from './frontmatter.js';

/** Expand date, time, title, path, Markdown body, and raw frontmatter placeholders. @param {string} text @param {string} title @param {{path?:string,content?:string}} [context] @returns {string} */
export function fillTemplate(text, title, { path = '', content = '' } = {}) {
  const now = new Date();
  const metadata = splitFrontmatter(content);
  const values = {
    date: now.toISOString().slice(0, 10),
    time: now.toTimeString().slice(0, 5),
    title,
    path,
    content: metadata.body,
    properties: metadata.raw ?? '',
  };
  return text.replace(/{{(date|time|title|path|content|properties)}}/g, (_match, key) => values[key]);
}
