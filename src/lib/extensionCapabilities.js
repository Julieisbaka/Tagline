import { marked } from 'marked';
import { EMPTY_FLOW, parseFlow, serializeFlow, setFlowCell } from '../../electron/flow.mjs';
import {
  canvasGroupMembers, createArgumentEdge, createCanvasId, createCanvasNode, moveCanvasNodes,
  parseCanvas, resolveCanvasLink, serializeCanvas, suggestCanvasFiles,
} from './canvas.js';
import { cardStats, formatDuration, getSectionAt, spokenEvidence } from './card.js';
import { createCitation, spokenCitations } from './citation.js';
import { markSpeechDocument, readFrontmatter, speechDocumentPaths, splitFrontmatter } from './frontmatter.js';
import { dateValue, monthDays, moveMonth, parseDate } from './calendar.js';
import { remainingAt } from './countdown.js';
import { cellBounds, copyFlowCells, parseFlowCells, pasteFlowCells } from './flowCells.js';
import { folderPaths, normalizeFolders } from './folderPaths.js';
import { initialLanguage, systemLanguage } from './localization.js';
import { displayBinding, validBinding } from './keybindings.js';
import { renderMarkdown, slugify } from './markdown.js';
import { buildHypotheses, entailmentLabel, premiseText } from './nli.js';
import {
  calibrateReading, readingAssessment, readingSeconds, speechStats, spokenText, validateReadingSample,
} from './readTime.js';
import { moveRibbonItem, normalizeRibbonItems } from './ribbonItems.js';
import { fillTemplate } from './template.js';
import {
  baseName, buildIndex, dirName, displayName, extractLinks, extractTags, flattenTree, fuzzyScore,
  isCanvas, isFlow, isMarkdown, joinPath, outline, resolveLink, rewriteLinks,
} from './vault.js';
import { moveWorkspaceItem, normalizeWorkspaceItems } from './workspaceItems.js';

/** Maximum input text accepted by extension pure-text helpers. */
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

/** Create an in-process event bus with disposable subscriptions and cloned payloads. @returns {object} */
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

/** Validate and copy a nonnegative editor selection range. @param {object} value @returns {{from:number,to:number}} */
export function requireSelection(value) {
  if (!value || !Number.isSafeInteger(value.from) || !Number.isSafeInteger(value.to) ||
    value.from < 0 || value.to < value.from) throw new Error('Selection requires integer positions with 0 <= from <= to.');
  return { from: value.from, to: value.to };
}

/** Clone and validate a JSON-serializable event payload within the size limit. @param {*} value @returns {*} */
export function requirePayload(value) {
  let serialized;
  try { serialized = JSON.stringify(value); }
  catch { throw new Error('Payload must be JSON-serializable.'); }
  if (serialized === undefined || serialized.length > 65536) throw new Error('Payload must be JSON up to 65,536 characters.');
  return JSON.parse(serialized);
}

/** Validate an application or extension event name. @param {string} name @returns {string} */
export function requireEventName(name) {
  if (typeof name !== 'string' || !/^[a-z][a-zA-Z0-9.-]{0,127}$/.test(name)) throw new Error('Invalid event name.');
  return name;
}

/** Run a bounded path-formatting helper without accessing the filesystem. @param {string} operation @param {string[]} args @returns {string} */
export function pathHelper(operation, args) {
  /** Normalize a vault-relative path and reject traversal above its root. @param {string} input @returns {string} */
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

/** Convert Markdown to plain text, excluding HTML and YAML metadata. @param {string} markdown @returns {string} */
export function markdownToText(markdown) {
  /** Recursively collect readable text from Markdown lexer tokens. @param {object[]} tokens @returns {string} */
  const collect = (tokens) => tokens.map((token) => {
    if (token.type === 'html') return '';
    if (token.type === 'image') return token.text || '';
    if (token.type === 'table') return [...token.header, ...token.rows.flat()]
      .map((cell) => collect(cell.tokens)).join(' ');
    if (token.items) return collect(token.items);
    if (token.tokens) return collect(token.tokens);
    return token.text || (token.type === 'br' || token.type === 'space' ? '\n' : token.raw || '');
  }).join(' ');
  return collect(marked.lexer(splitFrontmatter(markdown).body)).replace(/[ \t]+/g, ' ').replace(/[ \t]*\n[ \t]*/g, '\n').trim();
}

/** Validate text arguments passed to extension utility helpers. @param {*} value @param {string} label @returns {string} */
function requireHelperText(value, label) {
  if (typeof value !== 'string' || value.length > MAX_HELPER_TEXT) {
    throw new Error(`${label} must be text up to ${MAX_HELPER_TEXT} characters.`);
  }
  return value;
}

/** Validate a bounded list of vault-relative paths. @param {*} value @returns {string[]} */
function requirePaths(value) {
  if (!Array.isArray(value) || value.length > 10_000 ||
    value.some((path) => typeof path !== 'string' || path.length > 1000)) {
    throw new Error('Paths must be an array of at most 10,000 vault-relative paths.');
  }
  return value;
}

/** Validate a bounded list of helper IDs. @param {*} value @returns {string[]} */
function requireIds(value) {
  if (!Array.isArray(value) || value.length > 1000 ||
    value.some((id) => typeof id !== 'string' || id.length > 200)) {
    throw new Error('IDs must be an array of at most 1,000 strings no longer than 200 characters.');
  }
  return value;
}

/** Validate and bound caller-supplied path-to-Markdown content. @param {*} value @returns {Record<string,string>} */
function requireDocuments(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Documents must be a path-to-text object.');
  }
  const entries = Object.entries(value);
  if (entries.length > 10_000 || entries.some(([path, text]) =>
    typeof path !== 'string' || path.length > 1000 || typeof text !== 'string' || text.length > MAX_HELPER_TEXT)) {
    throw new Error('Documents must contain at most 10,000 paths and text values up to 100,000 characters.');
  }
  if (entries.reduce((total, [, text]) => total + text.length, 0) > 1_000_000) {
    throw new Error('Document text must total no more than 1,000,000 characters.');
  }
  return value;
}

/** Validate a bounded nonnegative row or column index. @param {*} value @param {string} label @returns {number} */
function requireCoordinate(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100_000) {
    throw new Error(`${label} must be an integer from 0 to 100,000.`);
  }
  return value;
}

/** Validate bounded two-dimensional flow cell text. @param {*} value @param {string} label @returns {string[][]} */
function requireFlowCells(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array of rows.`);
  let count = 0, characters = 0;
  for (const row of value) {
    if (!Array.isArray(row)) throw new Error(`${label} must contain arrays of cells.`);
    count += row.length;
    for (const cell of row) {
      if (typeof cell !== 'string') throw new Error(`${label} cells must be text.`);
      characters += cell.length;
    }
  }
  if (count > 100_000 || characters > MAX_HELPER_TEXT) throw new Error(`${label} exceeds the flow-cell limits.`);
  return value;
}

/** Validate a bounded tree before traversing it in extension helpers. @param {*} value @returns {object[]} */
function requireFolderTree(value) {
  if (!Array.isArray(value)) throw new Error('Folder tree must be an array.');
  const seen = new Set();
  let count = 0;
  /** Validate one bounded tree level and all descendant folder nodes. @param {object[]} nodes @param {number} depth @returns {void} */
  const visit = (nodes, depth) => {
    if (depth > 100) throw new Error('Folder tree exceeds 100 levels.');
    for (const node of nodes) {
      if (!node || typeof node !== 'object' || seen.has(node)) throw new Error('Folder tree must not contain invalid or circular nodes.');
      seen.add(node);
      if (++count > 10_000 || typeof node.path !== 'string' || node.path.length > 1000) {
        throw new Error('Folder tree must contain at most 10,000 nodes with valid paths.');
      }
      if (node.type === 'folder') {
        if (!Array.isArray(node.children)) throw new Error('Folder tree folders must have child arrays.');
        visit(node.children, depth + 1);
      }
    }
  };
  visit(value, 0);
  return value;
}

/** Convert and validate a Date or strict local date string. @param {*} value @param {string} label @returns {Date} */
function requireDate(value, label) {
  const date = typeof value === 'string' ? parseDate(value) : value;
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error(`${label} must be a valid date.`);
  return date;
}

/** Dispatch validated, side-effect-free helper calls from extension workers. @param {string} method @param {Array<*>} args @returns {*} */
export function extensionHelper(method, args) {
  switch (method) {
    case 'helpers.countdown.remainingAt':
      if (!Number.isFinite(args[0]) || !Number.isFinite(args[1] ?? Date.now())) throw new Error('Deadline and current time must be finite timestamps.');
      return remainingAt(args[0], args[1] ?? Date.now());
    case 'helpers.language.system':
      if (args[0] !== undefined && (!Array.isArray(args[0]) || args[0].length > 100 ||
        args[0].some((locale) => typeof locale !== 'string' || locale.length > 100))) {
        throw new Error('System languages must be up to 100 locale strings.');
      }
      return systemLanguage(args[0] ?? []);
    case 'helpers.language.initial':
      if (typeof args[0] !== 'string' || args[0].length > 100 ||
        (args[1] !== undefined && (!Array.isArray(args[1]) || args[1].length > 100 ||
        args[1].some((locale) => typeof locale !== 'string' || locale.length > 100)))) {
        throw new Error('System languages must be up to 100 locale strings.');
      }
      return initialLanguage(args[0], args[1] ?? []);
    case 'helpers.keybindings.valid':
      return validBinding(requireHelperText(args[0], 'Shortcut'));
    case 'helpers.keybindings.display':
      if (!['darwin', 'win32', 'linux'].includes(args[1])) throw new Error('Platform must be darwin, win32, or linux.');
      return displayBinding(requireHelperText(args[0], 'Shortcut'), args[1]);
    case 'helpers.layout.normalizeRibbon':
      if (!Array.isArray(args[1]) || args[1].length > 1000 || !Array.isArray(args[2]) || args[2].length > 1000 ||
        args[1].some((item) => !item || typeof item.id !== 'string' || item.id.length > 200) ||
        args[2].some((id) => typeof id !== 'string' || id.length > 200)) {
        throw new Error('Ribbon contributions and hidden IDs must be arrays of at most 1,000 valid items.');
      }
      if (args[0] !== undefined && (!Array.isArray(args[0]) || args[0].length > 1000 ||
        args[0].some((id) => typeof id !== 'string' || id.length > 200))) {
        throw new Error('Ribbon IDs must be an array of at most 1,000 strings.');
      }
      return normalizeRibbonItems(args[0], args[1], args[2]);
    case 'helpers.layout.moveRibbon':
      return moveRibbonItem(requireIds(args[0]), requireHelperText(args[1], 'Source ID'), requireHelperText(args[2], 'Target ID'));
    case 'helpers.layout.normalizeWorkspace':
      if (!Array.isArray(args[1]) || args[1].length > 1000 ||
        args[1].some((item) => !item || typeof item.id !== 'string' || item.id.length > 200)) {
        throw new Error('Workspace catalog must be an array of at most 1,000 valid items.');
      }
      if (args[0] !== undefined && (!Array.isArray(args[0]) || args[0].length > 1000 ||
        args[0].some((id) => typeof id !== 'string' || id.length > 200))) {
        throw new Error('Workspace IDs must be an array of at most 1,000 strings.');
      }
      return normalizeWorkspaceItems(args[0], args[1]);
    case 'helpers.layout.moveWorkspace':
      return moveWorkspaceItem(requireIds(args[0]), requireHelperText(args[1], 'Item ID'), requireHelperText(args[2], 'Target ID'));
    case 'helpers.calendar.dateValue':
      return dateValue(requireDate(args[0], 'Date'));
    case 'helpers.calendar.parseDate':
      return parseDate(requireHelperText(args[0], 'Date'));
    case 'helpers.calendar.moveMonth':
      if (!Number.isSafeInteger(args[1]) || Math.abs(args[1]) > 120_000) throw new Error('Month movement must be a safe integer between -120,000 and 120,000.');
      return moveMonth(requireDate(args[0], 'Date'), args[1]);
    case 'helpers.calendar.monthDays':
      return monthDays(requireDate(args[0], 'Date'));
    case 'helpers.flowCells.bounds':
      return cellBounds(
        { row: requireCoordinate(args[0]?.row, 'Anchor row'), column: requireCoordinate(args[0]?.column, 'Anchor column') },
        { row: requireCoordinate(args[1]?.row, 'Head row'), column: requireCoordinate(args[1]?.column, 'Head column') },
      );
    case 'helpers.flowCells.copy':
      if (!args[1] || !['top', 'bottom', 'left', 'right'].every((key) =>
        Number.isSafeInteger(args[1][key]) && args[1][key] >= 0 && args[1][key] <= 100_000) ||
        args[1].bottom < args[1].top || args[1].right < args[1].left ||
        (args[1].bottom - args[1].top + 1) * (args[1].right - args[1].left + 1) > 100_000) {
        throw new Error('Cell bounds must describe a nonnegative rectangle of at most 100,000 cells.');
      }
      return requireHelperText(copyFlowCells(requireFlowCells(args[0], 'Rows'), args[1]), 'Copied cell data');
    case 'helpers.flowCells.parse':
      return parseFlowCells(requireHelperText(args[0], 'Pasted cell data'));
    case 'helpers.flowCells.paste': {
      const top = requireCoordinate(args[1], 'Top row');
      const left = requireCoordinate(args[2], 'Left column');
      return pasteFlowCells({
        columns: requireFlowCells([args[0]?.columns], 'Sheet columns')[0],
        rows: requireFlowCells(args[0]?.rows, 'Sheet rows'),
      }, top, left, requireFlowCells(args[3], 'Pasted cells'));
    }
    case 'helpers.folders.paths':
      return folderPaths(requireFolderTree(args[0]));
    case 'helpers.folders.normalize':
      return normalizeFolders(requireHelperText(args[0], 'Path'), args[1] === true, requirePaths(args[2] ?? []));
    case 'helpers.frontmatter.split':
      return splitFrontmatter(requireHelperText(args[0], 'Markdown'));
    case 'helpers.frontmatter.markSpeech':
      return requireHelperText(markSpeechDocument(requireHelperText(args[0], 'Markdown')), 'Markdown');
    case 'helpers.frontmatter.speechPaths': {
      const documents = requireDocuments(args[0]);
      return speechDocumentPaths(documents);
    }
    case 'helpers.vault.isFlow':
      return isFlow(requireHelperText(args[0], 'Path'));
    case 'helpers.vault.isMarkdown':
      return isMarkdown(requireHelperText(args[0], 'Path'));
    case 'helpers.vault.isCanvas':
      return isCanvas(requireHelperText(args[0], 'Path'));
    case 'helpers.vault.baseName':
      return baseName(requireHelperText(args[0], 'Path'));
    case 'helpers.vault.displayName':
      return displayName(requireHelperText(args[0], 'Path'), args[1], args[2]);
    case 'helpers.vault.dirName':
      return dirName(requireHelperText(args[0], 'Path'));
    case 'helpers.vault.joinPath':
      return requireHelperText(joinPath(requireHelperText(args[0], 'Directory'), requireHelperText(args[1], 'Name')), 'Path');
    case 'helpers.vault.index':
      return buildIndex(requireDocuments(args[0]));
    case 'helpers.vault.extractLinks':
      return extractLinks(requireHelperText(args[0], 'Markdown'));
    case 'helpers.vault.extractTags':
      return extractTags(requireHelperText(args[0], 'Markdown'));
    case 'helpers.vault.resolveLink':
      return resolveLink(requireHelperText(args[0], 'Link target'), requirePaths(args[1]));
    case 'helpers.vault.outline':
      return outline(requireHelperText(args[0], 'Markdown'));
    case 'helpers.vault.flattenTree':
      return flattenTree(requireFolderTree(args[0]));
    case 'helpers.vault.rewriteLinks':
      return rewriteLinks(requireHelperText(args[0], 'Markdown'), requireHelperText(args[1], 'Old path'),
        requireHelperText(args[2], 'New path'), requirePaths(args[3]));
    case 'helpers.vault.fuzzyScore':
      return fuzzyScore(requireHelperText(args[0], 'Query'), requireHelperText(args[1], 'Text'));
    case 'helpers.citations.spoken':
      return spokenCitations(requireHelperText(args[0], 'Markdown'));
    case 'helpers.speech.text':
      return spokenText(requireHelperText(args[0], 'Text'));
    case 'helpers.speech.readingSeconds': {
      const wpm = args[1] === undefined ? 250 : args[1];
      if (!Number.isFinite(wpm) || wpm < 50 || wpm > 1000) throw new Error('Speaking rate must be a number from 50 to 1,000 words per minute.');
      return readingSeconds(args[0], wpm, args[2] ?? null);
    }
    case 'helpers.speech.validateSample':
      return validateReadingSample(args[0]);
    case 'helpers.speech.calibrate':
      return calibrateReading(args[0]);
    case 'helpers.speech.assess':
      if (args[1] !== undefined && (!Number.isFinite(args[1]) || args[1] < 50 || args[1] > 1000)) {
        throw new Error('Speaking rate must be a number from 50 to 1,000 words per minute.');
      }
      return readingAssessment(args[0], args[1] === undefined ? 250 : args[1], args[2] ?? null);
    case 'helpers.nli.premise':
      return premiseText(requireHelperText(args[0], 'Markdown'));
    case 'helpers.nli.hypotheses':
      return buildHypotheses(requireHelperText(args[0], 'Template ID'), requireHelperText(args[1], 'Hypothesis lines'));
    case 'helpers.nli.label':
      if (!Number.isFinite(args[0]) || args[0] < 0 || args[0] > 1) throw new Error('Probability must be between 0 and 1.');
      return entailmentLabel(args[0]);
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
    case 'helpers.markdown.toText':
      return markdownToText(requireHelperText(args[0], 'Markdown'));
    case 'helpers.markdown.frontmatter': {
      const metadata = readFrontmatter(requireHelperText(args[0], 'Markdown'));
      if (metadata.error) throw new Error(`Invalid YAML frontmatter: ${metadata.error}`);
      return { data: metadata.data, body: metadata.body, prefix: metadata.prefix };
    }
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
    case 'helpers.templates.fill': {
      const context = args[2] === undefined ? {} : args[2];
      if (!context || typeof context !== 'object' || Array.isArray(context)) {
        throw new Error('Template context must be an object.');
      }
      return fillTemplate(requireHelperText(args[0], 'Template'), requireHelperText(args[1], 'Title'), {
        path: requireHelperText(context.path === undefined ? '' : context.path, 'Path'),
        content: requireHelperText(context.content === undefined ? '' : context.content, 'Content'),
      });
    }
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
