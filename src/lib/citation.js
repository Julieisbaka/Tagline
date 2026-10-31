/** 
 * Escape citation text for safe, literal insertion into Markdown.
 * @param {string} value - The citation text to escape.
 * @returns {string} - The escaped citation text.
 */
const escape = (value) => value.trim().replace(/[\\`*_[\]<>]/g, '\\$&').replace(/\r?\n/g, ' ');

/** 
 * Format validated author/year and optional source details as citation Markdown.
 * @param {object} details - The citation details including author, year, title, publication, url, and accessed date.
 * @returns {string} - The formatted citation in Markdown.
 */
export function createCitation({ author, year, title = '', publication = '', url = '', accessed = '' }) {
  if (!author.trim() || !/^\d{4}$/.test(year)) throw new Error('Enter an author and a four-digit year.');
  let link = '';
  if (url.trim()) {
    const parsed = new URL(url.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Use an HTTP or HTTPS citation URL.');
    link = parsed.href.replace(/[()]/g, (c) => encodeURIComponent(c));
  }
  const details = [title && `"${escape(title)}"`, publication && escape(publication),
  link && `[${escape(url)}](${link})`, accessed && `Accessed ${escape(accessed)}`].filter(Boolean);
  return `**${escape(author)} ${year}**${details.length ? ' — ' + details.join(', ') : ''}`;
}

/** 
 * Extract author/year leads from bold citation lines for speech timing. 
 * @param {string} content 
 * @returns {string} 
 */
export function spokenCitations(content) {
  return [...content.matchAll(/^\*\*([^*\n]+)\*\*[^\n]*$/gm)].map((m) => {
    const lead = m[1].split(/\s+[–—]\s+/)[0];
    const year = lead.match(/\b(?:\d{4}|\d{2})\b/);
    return year ? lead.slice(0, year.index + year[0].length) : '';
  }).filter(Boolean).join(' ');
}
