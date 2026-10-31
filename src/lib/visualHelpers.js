import { readFrontmatter } from './frontmatter.js';

/** 
 * Return the first Markdown construct that cannot be safely represented visually.
 * @param {string} content - The Markdown content to check.
 * @returns {string|null} - A description of the unsupported construct, or null if none are found.
 */
export function visualBlocker(content) {
  const metadata = readFrontmatter(content);
  if (metadata.error) return 'invalid YAML frontmatter';
  content = metadata.body;
  if (/<!--|<\/?[a-z][^>]*>/i.test(content.replace(/```[\s\S]*?```/g, ''))) return 'embedded HTML';
  if (/^\[\^[^\]]+\]:/m.test(content)) return 'footnotes';
  if (/!\[[^\]]*\]\(/.test(content)) return 'Markdown images';
  if (/^(?:\$\$|:::)/m.test(content)) return 'math or custom fenced blocks';
  return null;
}

/** 
 * Serialize a ProseMirror document slice as Markdown.
 * @param {object} editor - The Tiptap editor instance.
 * @param {number} from - The starting position of the slice.
 * @param {number} to - The ending position of the slice.
 * @returns {string} - The serialized Markdown content of the slice.
 */
const serializeSlice = (editor, from, to) =>
  editor.markdown.serialize({ type: 'doc', content: editor.state.doc.slice(from, to).content.toJSON() || [] });

/** 
 * Serialize the selection, or the containing heading section, as Markdown.
 * @param {object} editor - The Tiptap editor instance.
 * @param {boolean} [ignoreSelection] - If true, ignore the current selection and serialize the containing heading section instead.
 * @returns {string} - The serialized Markdown content of the selection or heading section.
 */
export function visualSelection(editor, ignoreSelection = false) {
  const { from, to, $from } = editor.state.selection;
  if (!ignoreSelection && from !== to) {
    return serializeSlice(editor, from, to);
  }
  let start = 0;
  let end = editor.state.doc.content.size;
  let level = 7;
  editor.state.doc.forEach((node, offset) => {
    if (offset <= $from.pos && node.type.name === 'heading') {
      start = offset;
      level = node.attrs.level;
    }
  });
  if (level === 7) return '';
  editor.state.doc.forEach((node, offset) => {
    if (offset > start && offset < end && node.type.name === 'heading' && node.attrs.level <= level) end = offset;
  });
  return serializeSlice(editor, start, end);
}
