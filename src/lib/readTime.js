import { syllable } from 'syllable';
import { splitFrontmatter } from './frontmatter.js';
import { PAUSE_UNITS } from './readTime/calibration.js';

export { calibrateReading, validateReadingSample } from './readTime/calibration.js';

const SMALL = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const INITIALISMS = new Set([
  'US',
  'USA',
  'UK',
  'UN',
  'EU',
  'USSR',
  'GDP',
  'FBI',
  'CIA',
  'AI',
  'API',
]);

/**
 * Convert an integer below one million into readable English words.
 * This function handles numbers in the range 0 to 999,999 and converts them into their corresponding English word representation.
 * @param {number} number - The integer to convert.
 * @returns {string} - The English word representation of the number.
 */
function integerWords(number) {
  if (number < 20) {
    return SMALL[number];
  }
  if (number < 100) {
    return `${TENS[Math.floor(number / 10)]} ${number % 10 ? SMALL[number % 10] : ''}`;
  }
  if (number < 1000) {
    return `${SMALL[Math.floor(number / 100)]} hundred ${number % 100 ? integerWords(number % 100) : ''}`;
  }
  if (number < 1_000_000) {
    return `${integerWords(Math.floor(number / 1000))} thousand ${number % 1000 ? integerWords(number % 1000) : ''}`;
  }
  return String(number)
    .split('')
    .map((digit) => SMALL[Number(digit)])
    .join(' ');
}

/**
 * Convert a numeric token into words, with speech-friendly year and decimal rules.
 * This function handles numeric strings, converting them into spoken English words. It applies special rules for years and decimal numbers to ensure natural speech patterns.
 * @param {string} value - The numeric string to convert.
 * @returns {string} - The spoken English representation of the number.
 */
function spokenNumber(value) {
  value = value.replace(/,/g, '');
  if (value.includes('.')) {
    const [whole, fraction] = value.split('.');
    return `${spokenNumber(whole)} point ${[...fraction].map((digit) => SMALL[Number(digit)]).join(' ')}`;
  }
  if (value.length > 6) {
    return [...value].map((digit) => SMALL[Number(digit)]).join(' ');
  }
  if (/^0\d/.test(value)) {
    return value
      .split('')
      .map((digit) => SMALL[Number(digit)])
      .join(' ');
  }
  const number = Number(value);
  // Citation years are normally read "nineteen ninety-nine" or "twenty twenty-four".
  if (number >= 1900 && number <= 2099 && number % 100) {
    if (number < 2000 || number >= 2010) {
      return `${integerWords(Math.floor(number / 100))} ${number % 100 < 10 ? 'oh ' : ''}${integerWords(number % 100)}`;
    }
  }
  return integerWords(number);
}

/**
 * Remove script, style, and comment content before extracting spoken text.
 * This function strips out non-spoken markup elements such as <script> and <style> tags, as well as HTML comments, to isolate the text that should be considered for spoken rendering.
 * @param {string} value - The HTML content to process.
 * @returns {string} - The cleaned text with non-spoken markup removed.
 */
function stripNonspokenMarkup(value) {
  const lowercase = value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  const rawTextTag = /<\s*(script|style)(?=[\s/>])/iy;
  const text = [];
  let index = 0;
  while (index < value.length) {
    if (value.startsWith('<!--', index)) {
      const end = value.indexOf('-->', index + 4);
      index = end === -1 ? value.length : end + 3;
      continue;
    }
    rawTextTag.lastIndex = index;
    const opening = lowercase[index] === '<' ? rawTextTag.exec(value) : null;
    if (opening) {
      const name = opening[1].toLowerCase();
      const openingEnd = value.indexOf('>', index + opening[0].length);
      if (openingEnd === -1) {
        break;
      }
      let closing = lowercase.indexOf(`</${name}`, openingEnd + 1);
      while (closing !== -1 && !/[\s>]/.test(lowercase[closing + name.length + 2] || '')) {
        closing = lowercase.indexOf(`</${name}`, closing + 2);
      }
      if (closing === -1) {
        break;
      }
      const end = value.indexOf('>', closing);
      index = end === -1 ? value.length : end + 1;
      continue;
    }
    text.push(value[index]);
    index++;
  }
  return text.join('');
}

/**
 * Convert Markdown/HTML into plain speech text, excluding frontmatter and URLs.
 * This function processes the input content, removing frontmatter, non-spoken markup, and URLs, resulting in a clean text suitable for spoken rendering.
 * @param {string} value - The Markdown or HTML content to process.
 * @param {object} [options] - Delivery policy for competitive speech.
 * @param {boolean} [options.skipParenthetical=false] - Drop parenthetical and bracketed spans such as citation or qualification asides.
 * @param {boolean} [options.skipSectionLabels=false] - Drop lines that are only an all-caps section label.
 * @returns {string} - The plain text representation for spoken output.
 */
export function spokenText(value, { skipParenthetical = false, skipSectionLabels = false } = {}) {
  let text = stripNonspokenMarkup(splitFrontmatter(value).body);
  let previous;
  do {
    previous = text;
    text = text.replace(/<(?:br\b[^>]*|\/(?:p|div|li|h[1-6]))>/gi, '\n').replace(/<[^>]*>/g, '');
  } while (text !== previous);
  if (skipParenthetical) {
    // Remove innermost spans until none remain, so nested asides disappear too.
    do {
      previous = text;
      text = text.replace(/[([{][^()[\]{}]*[)\]}]/g, ' ');
    } while (text !== previous);
  }
  if (skipSectionLabels) {
    text = text.replace(/^[ \t]*(?:\p{Lu}[\p{Lu}\p{N}&'’]+(?:[ \t]+|$)){2,}/gmu, '');
  }
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => {
      const number = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : ' ';
    })
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp);/gi,
      (_, name) =>
        ({ amp: ' and ', lt: ' ', gt: ' ', quot: '"', apos: "'", nbsp: ' ' })[name.toLowerCase()]
    )
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[<>]/g, '');
}

/**
 * Count Unicode words in plain speech text.
 * @param {string} text - The text in which to count words.
 * @returns {number} - The number of words found in the text.
 */
function wordCount(text) {
  return (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;
}

/**
 * Highlight spans are marked with ==highlight== or <mark>; both support nesting
 * after markup is stripped. Returns one plain-text span per outermost mark.
 * @param {string} text - The text to scan for highlights.
 * @returns {string[]} - Plain-text highlighted spans.
 */
function highlightSpans(text) {
  const spans = [];
  let depth = 0;
  let start = -1;
  const pattern = /==/g;
  let match;
  while ((match = pattern.exec(text))) {
    if (depth === 0) {
      start = match.index + 2;
      depth = 1;
    } else if (text[match.index - 1] === '=' && text[match.index + 2] === '=') {
      // A === run inside a span: consume it without changing the depth.
      pattern.lastIndex += 1;
    } else {
      depth--;
      if (depth === 0) {
        spans.push(text.slice(start, match.index));
      }
    }
  }
  return spans;
}

/**
 * Count spoken words, syllables, complexity, sentences, and pause units.
 * @param {string} text - The input text to analyze for speech characteristics.
 * @param {object} [options] - Delivery policy for competitive speech.
 * @param {boolean} [options.skipParenthetical=false] - Drop parenthetical and bracketed spans.
 * @param {boolean} [options.skipSectionLabels=false] - Drop all-caps section label lines.
 * @param {boolean} [options.slowHighlights=false] - Speak highlighted spans deliberately; their words and syllables count twice.
 * @returns {object} - An object containing speech statistics, including per-class pause counts.
 */
export function speechStats(text, options = {}) {
  const plain = spokenText(text, options);
  const tokens =
    plain.match(/[\p{L}]+(?:['’-][\p{L}]+)*|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|%/gu) || [];
  let syllables = 0;
  let complexity = 0;
  let spokenWords = 0;
  let complexWords = 0;
  let properNouns = 0;
  let numerals = 0;
  let numeralWords = 0;
  for (const token of tokens) {
    const spoken = /^\d/.test(token) ? spokenNumber(token) : token === '%' ? 'percent' : token;
    const initials = INITIALISMS.has(token) || /^[B-DF-HJ-NP-TV-Z]{2,6}$/.test(token);
    const count = initials
      ? [...token].reduce((n, letter) => n + (letter === 'W' ? 3 : 1), 0)
      : Math.max(1, syllable(spoken));
    syllables += count;
    spokenWords += initials ? token.length : (spoken.match(/[\p{L}]+/gu) || []).length;
    if (/^\d/.test(token)) {
      numerals++;
      numeralWords += (spoken.match(/[\p{L}]+/gu) || []).length;
    } else if (!initials && /^[\p{Lu}]/u.test(token) && token.toLowerCase() !== token) {
      properNouns++;
    }
    if (count >= 3 && !initials && !/^\d/.test(token)) {
      complexWords++;
    }
    // A modest articulation surcharge, not a readability score: long words and
    // dense consonant clusters take longer even at an identical syllable count.
    const clusters = (spoken.toLowerCase().match(/[bcdfghjklmnpqrstvwxyz]{3,}/g) || []).length;
    complexity += Math.max(0, count - 2) * 0.1 + Math.min(0.3, clusters * 0.08);
  }
  if (options.slowHighlights) {
    // Deliberate delivery of marked evidence roughly doubles its time on mic.
    for (const span of highlightSpans(text)) {
      for (const token of span.match(/[\p{L}]+(?:['’-][\p{L}]+)*|\d+(?:\.\d+)?/gu) || []) {
        const spoken = /^\d/.test(token) ? spokenNumber(token) : token;
        syllables += Math.max(1, syllable(spoken));
        spokenWords += (spoken.match(/[\p{L}]+/gu) || []).length;
      }
    }
  }
  const punctuation = plain.replace(/\d[,.]\d/g, '0').replace(/\b(?:[A-Z]\.){2,}/g, 'initialism');
  const sentenceEnds = tokens.length ? (punctuation.match(/[.!?]+(?=\s|$)/g) || []).length : 0;
  const sentences = tokens.length ? Math.max(1, sentenceEnds) : 0;
  const paragraphCount = plain
    .trim()
    .split(/\n\s*\n/)
    .filter(Boolean).length;
  const paragraphs = Math.max(0, paragraphCount - 1);
  // Per-class pause counts; delivery styles pause very differently at commas
  // versus sentence ends, so calibration fits each class separately.
  const pauses = {
    commas: (punctuation.match(/,/g) || []).length,
    semicolons: (punctuation.match(/[;:]/g) || []).length,
    dashes: (punctuation.match(/[—–]/g) || []).length,
    sentences: sentenceEnds,
    paragraphs,
  };
  const pauseUnits = tokens.length
    ? pauses.sentences * 0.22 +
      (pauses.commas + pauses.semicolons + pauses.dashes) * 0.09 +
      pauses.paragraphs * 0.15
    : 0;
  // Quoted and parenthesized spans carry attribution and delivery overhead.
  let quotedWords = 0;
  for (const match of plain.matchAll(/[“"‘']([^“”"‘’']+)[”"’']/g)) {
    quotedWords += wordCount(match[1]);
  }
  const parentheticalWords = [...plain.matchAll(/\(([^()]*)\)/g)].reduce(
    (sum, match) => sum + wordCount(match[1]),
    0
  );
  const properNounDensity = tokens.length ? properNouns / tokens.length : 0;
  const numeralDensity = tokens.length ? numerals / tokens.length : 0;
  return {
    syllables,
    // Names and figures force a pronunciation check mid-delivery.
    weightedSyllables: syllables + complexity + properNouns * 0.35 + numeralWords * 0.25,
    spokenWords,
    complexWords,
    sentences,
    pauseUnits,
    pauses,
    properNounDensity,
    numeralDensity,
    paragraphCount,
    quotedWords,
    parentheticalWords,
  };
}
/**
 * Estimate speech duration from statistics, rate, and optional personal profile.
 * This function calculates the expected duration from weighted syllables, syllables per minute, and an optional personal profile.
 * @param {object} stats - The speech statistics object, typically obtained from analyzeSpeech.
 * @param {number} [spm=375] - The speaking rate in weighted syllables per minute.
 * @param {object|null} [profile=null] - An optional personal profile containing articulation and pause adjustments.
 * @returns {number} - The estimated duration of the speech in seconds.
 */
export function readingSeconds(stats, spm = 375, profile = null) {
  if (!Number.isFinite(spm) || spm <= 0) {
    throw new Error('Speaking rate must be a positive number.');
  }
  if (
    !Number.isFinite(stats.weightedSyllables) ||
    stats.weightedSyllables < 0 ||
    (stats.pauseUnits !== undefined && (!Number.isFinite(stats.pauseUnits) || stats.pauseUnits < 0))
  ) {
    throw new Error('Invalid speech statistics.');
  }
  if (profile) {
    if (
      !Number.isFinite(profile.articulation) ||
      profile.articulation < 0 ||
      !Number.isFinite(profile.pauses) ||
      profile.pauses <= 0 ||
      (profile.intercept !== undefined &&
        (!Number.isFinite(profile.intercept) || profile.intercept < 0)) ||
      (profile.pauseWeights !== undefined &&
        (typeof profile.pauseWeights !== 'object' ||
          profile.pauseWeights === null ||
          Object.values(profile.pauseWeights).some((w) => !Number.isFinite(w) || w < 0)))
    ) {
      throw new Error('Invalid reading calibration profile.');
    }
    const pauseSeconds = (() => {
      if (!profile.pauseWeights || !stats.pauses) {
        return stats.pauseUnits || 0;
      }
      let seconds = 0;
      for (const [kind, count] of Object.entries(stats.pauses)) {
        const unit = PAUSE_UNITS[kind] ?? 0.09;
        seconds += count * unit * (profile.pauseWeights[kind] ?? 1);
      }
      return seconds;
    })();
    return (
      (profile.intercept || 0) +
      stats.weightedSyllables * 0.16 * profile.articulation +
      pauseSeconds * profile.pauses
    );
  }
  return (stats.weightedSyllables / spm) * 60 + (stats.pauseUnits || 0) * Math.sqrt(375 / spm);
}

/**
 * Assess duration and effort metrics using a default or calibrated speech profile.
 * This function evaluates the expected duration, reading ease, and effort required for a given set of speech statistics, optionally using a calibrated profile to adjust for individual articulation and pause patterns.
 * @param {object} stats - The speech statistics object, typically obtained from analyzeSpeech.
 * @param {number} [spm=375] - The speaking rate in weighted syllables per minute.
 * @param {object|null} [profile=null] - An optional calibrated profile containing baseline density and baseline seconds per word.
 * @returns {object} - An object containing the assessed metrics: seconds, readingEase, effort, and a flag indicating whether a calibrated profile was used.
 */
export function readingAssessment(stats, spm = 375, profile = null) {
  for (const key of ['syllables', 'weightedSyllables', 'spokenWords', 'sentences']) {
    if (!Number.isFinite(stats?.[key]) || stats[key] < 0) {
      throw new Error('Invalid speech statistics.');
    }
  }
  if (
    profile &&
    (!Number.isFinite(profile.baselineDensity) ||
      profile.baselineDensity <= 0 ||
      !Number.isFinite(profile.baselineSecondsPerWord) ||
      profile.baselineSecondsPerWord <= 0)
  ) {
    throw new Error('Invalid reading assessment profile.');
  }
  const words = stats.spokenWords || 0;
  const density = words ? stats.weightedSyllables / words : 0;
  const readingEase = words
    ? 206.835 - (1.015 * words) / Math.max(1, stats.sentences) - (84.6 * stats.syllables) / words
    : null;
  const baseline = profile?.baselineDensity || 1.6;
  const seconds = readingSeconds(stats, spm, profile);
  const effort = words
    ? profile
      ? (100 * seconds) / words / profile.baselineSecondsPerWord
      : (100 * density) / baseline
    : null;
  return { seconds, readingEase, effort, calibrated: !!profile };
}
