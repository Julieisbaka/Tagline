import { marked } from 'marked';

export const EDITOR_COMMANDS = Object.freeze([
  'toggleBold', 'toggleItalic', 'toggleUnderline', 'toggleHighlight', 'toggleStrike',
  'toggleHeading', 'setParagraph', 'toggleBulletList', 'toggleOrderedList',
  'toggleBlockquote', 'undo', 'redo', 'unsetAllMarks',
]);

export const APPLICATION_EVENTS = Object.freeze({
  'vault.changed': 'vault:read',
  'vault.fileChanged': 'vault:read',
  'note.changed': 'editor:active-note',
  'editor.updated': 'editor',
  'editor.selectionChanged': 'editor',
  'editor.ready': 'editor',
});

export function createEventBus() {
  const listeners = new Map();
  return {
    on(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      const group = listeners.get(name);
      group.add(listener);
      return () => {
        group.delete(listener);
        if (!group.size) listeners.delete(name);
      };
    },
    emit(name, payload) {
      for (const listener of [...(listeners.get(name) || [])]) listener(structuredClone(payload));
    },
  };
}

export const applicationEvents = createEventBus();

export function requireSelection(value) {
  if (!value || !Number.isSafeInteger(value.from) || !Number.isSafeInteger(value.to) ||
    value.from < 0 || value.to < value.from) throw new Error('Selection requires integer positions with 0 <= from <= to.');
  return { from: value.from, to: value.to };
}

export function requirePayload(value) {
  let serialized;
  try { serialized = JSON.stringify(value); }
  catch { throw new Error('Payload must be JSON-serializable.'); }
  if (serialized === undefined || serialized.length > 65536) throw new Error('Payload must be JSON up to 65,536 characters.');
  return JSON.parse(serialized);
}

export function requireEventName(name) {
  if (typeof name !== 'string' || !/^[a-z][a-zA-Z0-9.-]{0,127}$/.test(name)) throw new Error('Invalid event name.');
  return name;
}

export function pathHelper(operation, args) {
  const normalize = (input) => {
    if (typeof input !== 'string' || input.length > 1000 || /^[\\/]|^[a-z]:/i.test(input)) {
      throw new Error('Use a vault-relative path up to 1,000 characters.');
    }
    const parts = [];
    for (const part of input.replace(/\\/g, '/').split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') {
        if (!parts.length) throw new Error('Path escapes the vault.');
        parts.pop();
      } else parts.push(part);
    }
    return parts.join('/');
  };
  if (operation === 'join') {
    if (!args.length || args.some((input) => typeof input !== 'string' || /^[\\/]|^[a-z]:/i.test(input))) {
      throw new Error('Use vault-relative paths.');
    }
    return normalize(args.join('/'));
  }
  const path = normalize(args[0]);
  if (operation === 'normalize') return path;
  if (operation === 'basename') return path.split('/').pop() || '';
  if (operation === 'dirname') return path.split('/').slice(0, -1).join('/');
  if (operation === 'extname') return path.split('/').pop()?.match(/^.+(\.[^.]*)$/)?.[1] || '';
  throw new Error('Unknown path helper.');
}

export function markdownToText(markdown) {
  const collect = (tokens) => tokens.map((token) => {
    if (token.type === 'html') return '';
    if (token.type === 'image') return token.text || '';
    if (token.type === 'table') return [...token.header, ...token.rows.flat()]
      .map((cell) => collect(cell.tokens)).join(' ');
    if (token.items) return collect(token.items);
    if (token.tokens) return collect(token.tokens);
    return token.text || (token.type === 'br' || token.type === 'space' ? '\n' : token.raw || '');
  }).join(' ');
  return collect(marked.lexer(markdown)).replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').trim();
}
