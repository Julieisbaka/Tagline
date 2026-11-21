export {
  MAX_HELPER_TEXT,
  extensionHelper,
  markdownToText,
  pathHelper,
} from './extensionHelpers.js';

export const EDITOR_COMMANDS = Object.freeze([
  'toggleBold',
  'toggleItalic',
  'toggleUnderline',
  'toggleHighlight',
  'toggleStrike',
  'toggleCode',
  'toggleCodeBlock',
  'toggleHeading',
  'setParagraph',
  'clearNodes',
  'setHardBreak',
  'setHorizontalRule',
  'toggleBulletList',
  'toggleOrderedList',
  'toggleBlockquote',
  'toggleTaskList',
  'insertTable',
  'addColumnBefore',
  'addColumnAfter',
  'deleteColumn',
  'addRowBefore',
  'addRowAfter',
  'deleteRow',
  'toggleHeaderRow',
  'toggleHeaderColumn',
  'toggleHeaderCell',
  'mergeCells',
  'splitCell',
  'deleteTable',
  'undo',
  'redo',
  'unsetAllMarks',
]);

export const APPLICATION_EVENTS = Object.freeze({
  'vault.changed': 'vault:read',
  'vault.fileChanged': 'vault:read',
  'note.changed': 'editor:active-note',
  'editor.updated': 'editor',
  'editor.selectionChanged': 'editor',
  'editor.ready': 'editor',
});

/**
 * Create an in-process event bus with disposable subscriptions and cloned payloads.
 * @returns {object}
 */
export function createEventBus() {
  const listeners = new Map();
  return {
    on(name, listener) {
      if (!listeners.has(name)) {
        listeners.set(name, new Set());
      }
      const group = listeners.get(name);
      group.add(listener);
      return () => {
        group.delete(listener);
        if (!group.size) {
          listeners.delete(name);
        }
      };
    },
    emit(name, payload) {
      requirePayload(payload);
      for (const listener of [...(listeners.get(name) || [])]) {
        listener(structuredClone(payload));
      }
    },
  };
}

export const applicationEvents = createEventBus();

/**
 * Validate and copy a nonnegative editor selection range.
 * @param {object} value
 * @returns {{from:number,to:number}}
 */
export function requireSelection(value) {
  if (
    !value ||
    !Number.isSafeInteger(value.from) ||
    !Number.isSafeInteger(value.to) ||
    value.from < 0 ||
    value.to < value.from
  ) {
    throw new Error('Selection requires integer positions with 0 <= from <= to.');
  }
  return { from: value.from, to: value.to };
}

/**
 * Clone and validate a JSON-serializable event payload within the size limit.
 * @param {*} value
 * @returns {*}
 */
export function requirePayload(value) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error('Payload must be JSON-serializable.');
  }
  if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > 131072) {
    throw new Error('Payload must be JSON up to 131,072 bytes.');
  }
  return JSON.parse(serialized);
}

/**
 * Validate an application or extension event name.
 * @param {string} name
 * @returns {string}
 */
export function requireEventName(name) {
  if (typeof name !== 'string' || !/^[a-z][a-zA-Z0-9.-]{0,127}$/.test(name)) {
    throw new Error('Invalid event name.');
  }
  return name;
}
