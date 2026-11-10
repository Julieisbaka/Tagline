import { splitFrontmatter } from './frontmatter.js';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n, width = 2) => String(n).padStart(width, '0');

/**
 * Format a Date in local time using Moment-style tokens (YYYY MM DD HH hh mm ss A a MMMM MMM dddd ddd, [literal]).
 * @param {Date} date
 * @param {string} format
 * @returns {string}
 */
export function formatDate(date, format) {
  const hours12 = date.getHours() % 12 || 12;
  const tokens = {
    YYYY: pad(date.getFullYear(), 4),
    YY: pad(date.getFullYear() % 100),
    MMMM: MONTHS[date.getMonth()],
    MMM: MONTHS[date.getMonth()].slice(0, 3),
    MM: pad(date.getMonth() + 1),
    M: String(date.getMonth() + 1),
    dddd: DAYS[date.getDay()],
    ddd: DAYS[date.getDay()].slice(0, 3),
    DD: pad(date.getDate()),
    D: String(date.getDate()),
    HH: pad(date.getHours()),
    H: String(date.getHours()),
    hh: pad(hours12),
    h: String(hours12),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
    A: date.getHours() < 12 ? 'AM' : 'PM',
    a: date.getHours() < 12 ? 'am' : 'pm',
  };
  return format.replace(
    /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|dddd|ddd|DD|D|HH|H|hh|h|mm|ss|A|a/g,
    (match, literal) => literal ?? tokens[match]
  );
}

/**
 * Expand date, time, title, path, Markdown body, and raw frontmatter placeholders in a template string.
 * {{date:FORMAT}} and {{time:FORMAT}} accept custom local-time formats.
 * @param {string} text - The template string containing placeholders to expand.
 * @param {string} title - The title to insert into the template.
 * @param {{path?:string,content?:string,vars?:Record<string,string>,properties?:boolean,cursor?:boolean}} [context] - path/content of the target note; vars supplies custom {{name}} values; properties=false blanks {{properties}}; cursor=true keeps the {{cursor}} marker.
 * @returns {string} - The resulting string with all placeholders expanded.
 */
export function fillTemplate(
  text,
  title,
  { path = '', content = '', vars = {}, properties = true, cursor = false } = {}
) {
  const now = new Date();
  const metadata = splitFrontmatter(content);
  const values = {
    title,
    path,
    content: metadata.body,
    properties: properties ? (metadata.raw ?? '') : '',
    cursor: cursor ? '{{cursor}}' : '',
  };
  const defaults = { date: 'YYYY-MM-DD', time: 'HH:mm' };
  return text.replace(
    /{{(?:(date|time)(?::([^}]*))?|(title|path|content|properties|cursor)|([A-Za-z_][\w-]*))}}/g,
    (match, clock, format, key, custom) => {
      if (clock) {
        return formatDate(now, format?.trim() || defaults[clock]);
      }
      if (key) {
        return values[key];
      }
      return Object.hasOwn(vars, custom) ? vars[custom] : match;
    }
  );
}

/**
 * Remove the {{cursor}} marker from filled text and report its offset (-1 when absent).
 * @param {string} text
 * @returns {{text:string,cursor:number}}
 */
export function extractCursor(text) {
  const cursor = text.indexOf('{{cursor}}');
  return { text: text.replace(/{{cursor}}/g, ''), cursor };
}

/**
 * Return the template folder name from settings, without surrounding slashes.
 * @param {{templateFolder?:string}} [settings]
 * @returns {string}
 */
export function templateFolderName(settings) {
  return (settings?.templateFolder || 'Templates').replace(/^\/+|\/+$/g, '') || 'Templates';
}

/**
 * Filter vault paths down to Markdown templates in the template folder.
 * @param {string[]} paths
 * @param {string} folder
 * @returns {string[]}
 */
export function templatePaths(paths, folder) {
  const prefix = `${folder.toLowerCase()}/`;
  return paths.filter((p) => p.toLowerCase().startsWith(prefix) && /\.md$/i.test(p)).sort();
}

/**
 * Split a template into its frontmatter presence and the body that is safe to insert into an existing note.
 * @param {string} text
 * @returns {{hasFrontmatter:boolean,body:string}}
 */
export function templateBody(text) {
  const parts = splitFrontmatter(text);
  return { hasFrontmatter: parts.raw !== null, body: parts.body.replace(/^\r?\n/, '') };
}
