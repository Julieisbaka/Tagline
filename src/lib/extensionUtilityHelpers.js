import { EMPTY_CANVAS } from './canvas.js';
import { containsEvidence } from './card.js';
import { detectCards } from './cardDetection.js';
import {
  CITATION_FIELDS,
  DEFAULT_CHECKUP,
  auditCards,
  citedUrls,
  linkIssues,
  normalizeCheckup,
  scanCards,
  sourceIssues,
} from './evidenceCheckup.js';
import { readFrontmatter } from './frontmatter.js';
import {
  KEYBINDINGS,
  binding,
  bindingConflict,
  editorBinding,
  eventBinding,
  matchesBinding,
  reservedBinding,
} from './keybindings.js';
import { LANGUAGES } from './localization.js';
import { HYPOTHESIS_TEMPLATES } from './nli.js';
import { DEFAULT_RIBBON_ITEMS, RIBBON_ITEMS } from './ribbonItems.js';
import {
  HYBRID_CANDIDATE_LIMIT,
  filterSearchDocuments,
  mergeHybridResults,
  parseQuery,
  searchExcerpt,
  searchVault,
} from './search.js';
import {
  BUILTIN_THEMES,
  COLOR_TOKENS,
  extensionThemes,
  getTheme,
  resolveThemeSettings,
  validateTheme,
} from './themes.js';
import { isJson } from './vault.js';
import { FILE_ACTIONS, STATUS_ITEMS } from './workspaceItems.js';

const MAX_TEXT = 100_000;

/**
 * Validate text supplied to a utility helper.
 * @param {*} value
 * @param {string} label
 * @returns {string}
 */
function text(value, label) {
  if (typeof value !== 'string' || value.length > MAX_TEXT) {
    throw new Error(`${label} must be text up to ${MAX_TEXT} characters.`);
  }
  return value;
}

/**
 * Validate a bounded plain object.
 * @param {*} value
 * @param {string} label
 * @returns {object}
 */
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

/**
 * Validate a bounded list of plain objects.
 * @param {*} value
 * @param {string} label
 * @returns {object[]}
 */
function objects(value, label) {
  if (!Array.isArray(value) || value.length > 10_000) {
    throw new Error(`${label} must be an array of at most 10,000 objects.`);
  }
  if (value.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error(`${label} must contain only objects.`);
  }
  return value;
}

/**
 * Validate a list of short strings.
 * @param {*} value
 * @param {string} label
 * @returns {string[]}
 */
function strings(value, label) {
  if (
    !Array.isArray(value) ||
    value.length > 1000 ||
    value.some((item) => typeof item !== 'string' || item.length > 200)
  ) {
    throw new Error(`${label} must be an array of at most 1,000 strings up to 200 characters.`);
  }
  return value;
}

/**
 * Validate and bound caller-supplied path-to-Markdown content.
 * @param {*} value
 * @returns {Record<string,string>}
 */
function documents(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Documents must be a path-to-text object.');
  }
  const entries = Object.entries(value);
  if (
    entries.length > 10_000 ||
    entries.some(
      ([path, content]) =>
        typeof path !== 'string' ||
        path.length > 1000 ||
        typeof content !== 'string' ||
        content.length > MAX_TEXT
    )
  ) {
    throw new Error(
      'Documents must contain at most 10,000 paths and text values up to 100,000 characters.'
    );
  }
  if (entries.reduce((total, [, content]) => total + content.length, 0) > 1_000_000) {
    throw new Error('Document text must total no more than 1,000,000 characters.');
  }
  return value;
}

/**
 * Validate a card list returned by scanCards or supplied by an extension.
 * @param {*} value
 * @returns {object[]}
 */
function cards(value) {
  return objects(value, 'Cards');
}

/**
 * Validate a link or source result map keyed by URL.
 * @param {*} value
 * @returns {object}
 */
function results(value) {
  const map = object(value, 'Results');
  const entries = Object.entries(map);
  if (entries.length > 10_000) {
    throw new Error('Results must contain at most 10,000 entries.');
  }
  if (entries.some(([, result]) => !result || typeof result !== 'object')) {
    throw new Error('Each result must be an object.');
  }
  return map;
}

/**
 * Validate a search index with a bounded tag-to-path map.
 * @param {*} value
 * @returns {object}
 */
function searchIndex(value) {
  const index = object(value, 'Search index');
  const tags = object(index.tags, 'Search index tags');
  const entries = Object.entries(tags);
  if (
    entries.length > 10_000 ||
    entries.some(
      ([tag, paths]) =>
        typeof tag !== 'string' ||
        tag.length > 200 ||
        !Array.isArray(paths) ||
        paths.length > 10_000 ||
        paths.some((path) => typeof path !== 'string' || path.length > 1000)
    )
  ) {
    throw new Error('Search index tags must map to bounded path arrays.');
  }
  return index;
}

/**
 * Validate search options.
 * @param {*} value
 * @returns {object}
 */
function searchOptions(value) {
  if (value === undefined) {
    return {};
  }
  const options = object(value, 'Search options');
  if (options.matchAll !== undefined && typeof options.matchAll !== 'boolean') {
    throw new Error('Search matchAll must be a boolean.');
  }
  return options;
}

/**
 * Validate a result limit.
 * @param {*} value
 * @returns {number}
 */
function limit(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1000) {
    throw new Error('Result limit must be an integer from 1 to 1,000.');
  }
  return value;
}

/**
 * Validate an excerpt length.
 * @param {*} value
 * @returns {number}
 */
function excerptLength(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new Error('Excerpt length must be an integer from 1 to 10,000.');
  }
  return value;
}

/**
 * Validate the audit reference time.
 * @param {*} value
 * @returns {Date}
 */
function auditNow(value) {
  if (value === undefined) {
    return new Date();
  }
  if (!(value instanceof Date) && typeof value !== 'string' && typeof value !== 'number') {
    throw new Error('Now must be a date, timestamp, or date string.');
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Now must be a valid date or timestamp.');
  }
  return date;
}

/**
 * Validate shortcut overrides.
 * @param {*} value
 * @returns {Record<string,string>}
 */
function shortcutOverrides(value) {
  if (value === undefined) {
    return {};
  }
  const overrides = object(value, 'Shortcut overrides');
  const entries = Object.entries(overrides);
  if (
    entries.length > 1000 ||
    entries.some(([id, key]) => id.length > 200 || typeof key !== 'string' || key.length > 200)
  ) {
    throw new Error('Shortcut overrides must map at most 1,000 IDs to short strings.');
  }
  return overrides;
}

/**
 * Validate extra shortcut definitions.
 * @param {*} value
 * @returns {object[]}
 */
function shortcutDefinitions(value) {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > 1000) {
    throw new Error('Shortcut definitions must be an array of at most 1,000 items.');
  }
  for (const item of value) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.id !== 'string' ||
      item.id.length > 200 ||
      typeof item.key !== 'string' ||
      item.key.length > 200
    ) {
      throw new Error('Each shortcut definition requires an ID and key up to 200 characters.');
    }
  }
  return value;
}

/**
 * Validate a platform name used by keybinding helpers.
 * @param {*} value
 * @returns {string}
 */
function platform(value) {
  if (!['darwin', 'win32', 'linux'].includes(value)) {
    throw new Error('Platform must be darwin, win32, or linux.');
  }
  return value;
}

/**
 * Validate a keyboard event-like object.
 * @param {*} value
 * @returns {object}
 */
function shortcutEvent(value) {
  const event = object(value, 'Keyboard event');
  for (const key of ['key', 'code']) {
    if (event[key] !== undefined && (typeof event[key] !== 'string' || event[key].length > 100)) {
      throw new Error('Keyboard event key and code must be text up to 100 characters.');
    }
  }
  for (const key of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) {
    if (event[key] !== undefined && typeof event[key] !== 'boolean') {
      throw new Error('Keyboard event modifiers must be booleans.');
    }
  }
  return event;
}

/**
 * Dispatch additional pure utility helpers that do not require permissions.
 * @param {string} method
 * @param {Array<*>} args
 * @returns {*}
 */
export function extensionUtilityHelper(method, args) {
  switch (method) {
    case 'helpers.cards.detect':
      return detectCards(text(args[0], 'Markdown'));
    case 'helpers.cards.containsEvidence':
      return containsEvidence(text(args[0], 'Document'), text(args[1], 'Text'));
    case 'helpers.checkup.fields':
      return CITATION_FIELDS;
    case 'helpers.checkup.defaults':
      return DEFAULT_CHECKUP;
    case 'helpers.checkup.normalize':
      return normalizeCheckup(object(args[0] ?? {}, 'Checkup options'));
    case 'helpers.checkup.scan':
      return scanCards(documents(args[0]));
    case 'helpers.checkup.citedUrls':
      return citedUrls(cards(args[0]));
    case 'helpers.checkup.audit':
      return auditCards(
        cards(args[0]),
        object(args[1] ?? {}, 'Checkup options'),
        auditNow(args[2])
      );
    case 'helpers.checkup.linkIssues':
      return linkIssues(cards(args[0]), results(args[1]));
    case 'helpers.checkup.sourceIssues':
      return sourceIssues(cards(args[0]), results(args[1]));
    case 'helpers.frontmatter.read':
      return readFrontmatter(text(args[0], 'Markdown'));
    case 'helpers.keybindings.all':
      return KEYBINDINGS;
    case 'helpers.keybindings.binding':
      return binding(
        text(args[0], 'Command ID'),
        shortcutOverrides(args[1]),
        shortcutDefinitions(args[2])
      );
    case 'helpers.keybindings.reserved':
      return reservedBinding(
        text(args[0], 'Shortcut'),
        args[1] === undefined ? '' : text(args[1], 'Command ID')
      );
    case 'helpers.keybindings.event':
      return eventBinding(shortcutEvent(args[0]), platform(args[1]));
    case 'helpers.keybindings.matches':
      return matchesBinding(shortcutEvent(args[0]), text(args[1], 'Shortcut'), platform(args[2]));
    case 'helpers.keybindings.conflict':
      return bindingConflict(
        text(args[0], 'Command ID'),
        text(args[1], 'Shortcut'),
        shortcutOverrides(args[2]),
        shortcutDefinitions(args[3])
      );
    case 'helpers.keybindings.editor':
      return editorBinding(text(args[0], 'Shortcut'));
    case 'helpers.language.languages':
      return LANGUAGES;
    case 'helpers.nli.templates':
      return HYPOTHESIS_TEMPLATES;
    case 'helpers.layout.ribbonItems':
      return RIBBON_ITEMS;
    case 'helpers.layout.defaultRibbonItems':
      return DEFAULT_RIBBON_ITEMS;
    case 'helpers.layout.fileActions':
      return FILE_ACTIONS;
    case 'helpers.layout.statusItems':
      return STATUS_ITEMS;
    case 'helpers.search.parse':
      return parseQuery(text(args[0], 'Query'));
    case 'helpers.search.filter':
      return filterSearchDocuments(
        documents(args[0]),
        searchIndex(args[1]),
        text(args[2], 'Query')
      );
    case 'helpers.search.vault':
      return searchVault(
        documents(args[0]),
        searchIndex(args[1]),
        text(args[2], 'Query'),
        args[3] === undefined ? undefined : limit(args[3]),
        searchOptions(args[4])
      );
    case 'helpers.search.excerpt':
      return searchExcerpt(
        text(args[0], 'Text'),
        strings(args[1], 'Search terms'),
        args[2] === undefined ? 200 : excerptLength(args[2])
      );
    case 'helpers.search.mergeHybrid':
      return mergeHybridResults(
        objects(args[0], 'Keyword results'),
        objects(args[1], 'Semantic results'),
        args[2] === undefined ? undefined : limit(args[2])
      );
    case 'helpers.search.candidateLimit':
      return HYBRID_CANDIDATE_LIMIT;
    case 'helpers.themes.builtin':
      return BUILTIN_THEMES;
    case 'helpers.themes.colorTokens':
      return COLOR_TOKENS;
    case 'helpers.themes.validate':
      return validateTheme(object(args[0], 'Theme'));
    case 'helpers.themes.resolveSettings':
      return resolveThemeSettings(
        object(args[0], 'Theme'),
        args[1] === undefined ? {} : object(args[1], 'Theme settings')
      );
    case 'helpers.themes.get':
      return getTheme(
        text(args[0], 'Theme ID'),
        args[1] === undefined ? undefined : object(args[1], 'Custom theme'),
        args[2] === undefined ? {} : object(args[2], 'Theme settings')
      );
    case 'helpers.themes.extensionThemes':
      return extensionThemes();
    case 'helpers.vault.isJson':
      return isJson(text(args[0], 'Path'));
    case 'helpers.canvas.empty':
      return EMPTY_CANVAS;
    default:
      throw new Error(`Unknown extension helper: ${method}`);
  }
}
