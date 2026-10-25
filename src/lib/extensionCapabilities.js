import { marked } from 'marked';
import { EMPTY_FLOW, parseFlow, serializeFlow, setFlowCell } from '../../electron/flow.mjs';
import {
  canvasGroupMembers, createArgumentEdge, createCanvasId, createCanvasNode, moveCanvasNodes,
  parseCanvas, resolveCanvasLink, serializeCanvas, suggestCanvasFiles,
} from './canvas.js';
import { cardStats, formatDuration, getSectionAt, spokenEvidence } from './card.js';
import { createCitation } from './citation.js';
import { renderMarkdown, slugify } from './markdown.js';
import { readingSeconds, speechStats } from './readTime.js';
import { fillTemplate } from './template.js';
import { extractLinks, extractTags, fuzzyScore, outline, resolveLink } from './vault.js';

export const MAX_HELPER_TEXT = 100_000;

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
  return collect(marked.lexer(markdown)).replace(/[ \t]+/g, ' ').replace(/[ \t]*\n[ \t]*/g, '\n').trim();
}

function requireHelperText(value, label) {
  if (typeof value !== 'string' || value.length > MAX_HELPER_TEXT) {
    throw new Error(`${label} must be text up to ${MAX_HELPER_TEXT} characters.`);
  }
  return value;
}

function requirePaths(value) {
  if (!Array.isArray(value) || value.length > 10_000 ||
    value.some((path) => typeof path !== 'string' || path.length > 1000)) {
    throw new Error('Paths must be an array of at most 10,000 vault-relative paths.');
  }
  return value;
}

export function extensionHelper(method, args) {
  switch (method) {
    case 'helpers.canvas.parse':
      return parseCanvas(requireHelperText(args[0], 'Canvas JSON'));
    case 'helpers.canvas.serialize':
      return requireHelperText(serializeCanvas(args[0]), 'Canvas JSON');
    case 'helpers.canvas.createNode':
      if (!Number.isSafeInteger(args[1]) || args[1] < 0 || args[1] > 10000) throw new Error('Node index must be from 0 to 10,000.');
      return createCanvasNode(args[0], args[1]);
    case 'helpers.canvas.createArgumentEdge':
      return createArgumentEdge(requireHelperText(args[0], 'Source node'), requireHelperText(args[1], 'Target node'), args[2]);
    case 'helpers.canvas.groupMembers':
      return canvasGroupMembers(parseCanvas(serializeCanvas(args[0])).nodes, requireHelperText(args[1], 'Group id'));
    case 'helpers.canvas.resolveLink':
      return resolveCanvasLink(requireHelperText(args[0], 'Link target'), requirePaths(args[1]));
    case 'helpers.canvas.suggestFiles':
      if (!Number.isSafeInteger(args[2]) || args[2] < 1 || args[2] > 1000) throw new Error('Suggestion limit must be from 1 to 1,000.');
      return suggestCanvasFiles(requirePaths(args[0]), requireHelperText(args[1], 'Query'), args[2]);
    case 'helpers.canvas.createId':
      return createCanvasId();
    case 'helpers.canvas.moveNodes': {
      const canvas = parseCanvas(serializeCanvas(args[0]));
      const ids = requirePaths(args[1]);
      if (args.slice(2, 4).length !== 2 || args.slice(2, 4).some((value) => !Number.isSafeInteger(value))) {
        throw new Error('Movement deltas must be safe integers.');
      }
      return parseCanvas(serializeCanvas(moveCanvasNodes(canvas, ids, args[2], args[3])));
    }
    case 'helpers.flow.parse':
      return parseFlow(requireHelperText(args[0], 'Flow JSON'));
    case 'helpers.flow.serialize':
      return requireHelperText(serializeFlow(args[0]), 'Flow JSON');
    case 'helpers.flow.create':
      return parseFlow(EMPTY_FLOW);
    case 'helpers.flow.setCell':
      return setFlowCell(args[0], args[1], args[2], args[3], requireHelperText(args[4], 'Cell text'));
    case 'helpers.markdownToText':
    case 'helpers.markdown.toText':
      return markdownToText(requireHelperText(args[0], 'Markdown'));
    case 'helpers.markdown.slugify':
      return slugify(requireHelperText(args[0], 'Heading'));
    case 'helpers.markdown.toHtml':
      return renderMarkdown(requireHelperText(args[0], 'Markdown'));
    case 'helpers.markdown.outline':
      return outline(requireHelperText(args[0], 'Markdown'));
    case 'helpers.markdown.extractLinks':
      return extractLinks(requireHelperText(args[0], 'Markdown'));
    case 'helpers.markdown.extractTags':
      return extractTags(requireHelperText(args[0], 'Markdown'));
    case 'helpers.markdown.resolveLink':
      return resolveLink(requireHelperText(args[0], 'Link target'), requirePaths(args[1]));
    case 'helpers.cards.getAt': {
      const content = requireHelperText(args[0], 'Markdown');
      const offset = args[1];
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > content.length) {
        throw new Error('Offset must be an integer within the Markdown text.');
      }
      return getSectionAt(content, offset);
    }
    case 'helpers.cards.stats':
      return cardStats(requireHelperText(args[0], 'Card'));
    case 'helpers.cards.spokenEvidence':
      return spokenEvidence(requireHelperText(args[0], 'Card'));
    case 'helpers.cards.formatDuration': {
      const seconds = args[0];
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 1_000_000_000) {
        throw new Error('Duration must be a number from 0 to 1,000,000,000 seconds.');
      }
      return formatDuration(seconds);
    }
    case 'helpers.search.fuzzyScore':
      return fuzzyScore(requireHelperText(args[0], 'Query'), requireHelperText(args[1], 'Text'));
    case 'helpers.templates.fill':
      return fillTemplate(requireHelperText(args[0], 'Template'), requireHelperText(args[1], 'Title'));
    case 'helpers.citations.create': {
      const input = args[0];
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Citation details must be an object.');
      }
      const details = {};
      for (const key of ['author', 'year', 'title', 'publication', 'url', 'accessed']) {
        const value = input[key];
        if (value !== undefined && (typeof value !== 'string' || value.length > 10_000)) {
          throw new Error(`Citation ${key} must be text up to 10,000 characters.`);
        }
        if (value !== undefined) details[key] = value;
      }
      if (typeof details.author !== 'string' || typeof details.year !== 'string') {
        throw new Error('Citation author and year are required text fields.');
      }
      return createCitation(details);
    }
    case 'helpers.speech.analyze':
      return speechStats(requireHelperText(args[0], 'Text'));
    case 'helpers.speech.estimate': {
      const text = requireHelperText(args[0], 'Text');
      const wpm = args[1] === undefined ? 250 : args[1];
      if (!Number.isFinite(wpm) || wpm < 50 || wpm > 1000) {
        throw new Error('Speaking rate must be a number from 50 to 1,000 words per minute.');
      }
      const stats = speechStats(text);
      return { ...stats, seconds: readingSeconds(stats, wpm) };
    }
    default:
      throw new Error(`Unknown extension helper: ${method}`);
  }
}
