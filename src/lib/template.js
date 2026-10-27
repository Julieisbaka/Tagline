import { splitFrontmatter } from './frontmatter.js';

/** 
 * Expand date, time, title, path, Markdown body, and raw frontmatter placeholders in a template string.
 * @param {string} text - The template string containing placeholders to expand.
 * @param {string} title - The title to insert into the template.
 * @param {{path?:string,content?:string}} [context] - The context object containing optional path and content for the template.
 * @returns {string} - The resulting string with all placeholders expanded.
 */
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
