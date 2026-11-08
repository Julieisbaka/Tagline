import { syllable } from 'syllable';
import { splitFrontmatter } from './frontmatter.js';

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
 * Validate a saved timed reading sample and its speech statistics.
 * This function checks the integrity and correctness of a timed reading sample, ensuring that all required fields are present and that the speech statistics are within reasonable bounds.
 * @param {object} sample - The timed reading sample to validate.
 * @returns {object} - The validated sample if it passes all checks.
 */
export function validateReadingSample(sample) {
  if (
    !sample ||
    typeof sample.id !== 'string' ||
    !sample.id ||
    sample.id.length > 100 ||
    typeof sample.name !== 'string' ||
    !sample.name.trim() ||
    sample.name.length > 200 ||
    !['full', 'evidence'].includes(sample.scope) ||
    !Number.isFinite(sample.seconds) ||
    sample.seconds <= 0 ||
    sample.seconds > 86400 ||
    sample.version !== 1 ||
    !sample.stats
  ) {
    throw new Error('Invalid timed reading sample.');
  }
  const stats = sample.stats;
  for (const key of [
    'syllables',
    'weightedSyllables',
    'spokenWords',
    'complexWords',
    'sentences',
    'pauseUnits',
    'properNounDensity',
    'numeralDensity',
    'paragraphCount',
    'quotedWords',
    'parentheticalWords',
  ]) {
    if (!Number.isFinite(stats[key]) || stats[key] < 0 || stats[key] > 1e9) {
      throw new Error('Invalid sample statistics.');
    }
  }
  if (stats.pauses !== undefined) {
    if (typeof stats.pauses !== 'object' || stats.pauses === null) {
      throw new Error('Invalid sample statistics.');
    }
    for (const value of Object.values(stats.pauses)) {
      if (!Number.isFinite(value) || value < 0 || value > 1e9) {
        throw new Error('Invalid sample statistics.');
      }
    }
  }
  if (!stats.spokenWords || !stats.weightedSyllables || !stats.sentences) {
    throw new Error(
      'Reading samples must contain spoken words. Check the selected scope and highlights.'
    );
  }
  return sample;
}

/**
 * Return the median of a nonempty numeric array.
 * This function calculates the median value of the provided array of numbers, which is the middle value when the array is sorted. If the array has an even number of elements, the median is the average of the two middle values.
 * @param {number[]} values - The array of numbers to compute the median for. Must be nonempty.
 * @returns {number} - The median value of the array.
 */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Fit a robust articulation/pause calibration profile from timed reading samples.
 * This function analyzes a collection of timed reading samples to estimate a robust articulation and pause profile, which can be used to adjust speech duration predictions. It employs a relative-error fitting approach to minimize the influence of outliers.
 * @param {object[]} [samples=[]] - An array of timed reading samples to use for calibration. Each sample should be validated and contain unique IDs.
 * @returns {object|null} - An object containing the calibrated articulation and pause parameters, along with summary statistics, or null if no samples are provided.
 */
const PAUSE_KINDS = ['sentences', 'paragraphs', 'commas', 'semicolons', 'dashes'];
const PAUSE_UNITS = {
  sentences: 0.22,
  paragraphs: 0.15,
  commas: 0.09,
  semicolons: 0.09,
  dashes: 0.09,
};

/**
 * Solve a small symmetric positive-definite system by Gaussian elimination.
 * Pivoting keeps the calibration stable when a pause class barely occurs.
 * @param {number[][]} matrix - The square matrix.
 * @param {number[]} vector - The right-hand side.
 * @returns {number[]} - The solution vector.
 */
function solveSystem(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++) {
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) {
        pivot = row;
      }
    }
    [a[column], a[pivot]] = [a[pivot], a[column]];
    const divisor = a[column][column] || 1e-12;
    for (let row = column + 1; row < n; row++) {
      const factor = a[row][column] / divisor;
      for (let k = column; k <= n; k++) {
        a[row][k] -= factor * a[column][k];
      }
    }
  }
  const solution = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = a[row][n];
    for (let k = row + 1; k < n; k++) {
      sum -= a[row][k] * solution[k];
    }
    solution[row] = sum / (a[row][row] || 1e-12);
  }
  return solution;
}

/**
 * Fit a robust articulation/pause calibration profile from timed reading samples.
 * Fits seconds = intercept + a·articulation + b·(per-class pause seconds) with
 * iteratively reweighted ridge regression, so setup/transition time and pause
 * style are learned instead of assumed. Requires at least three samples; fewer
 * return null so callers fall back to the default algorithm. Outlier samples
 * are reported instead of silently dominating the fit.
 * @param {object[]} [samples=[]] - Validated timed reading samples with unique IDs.
 * @returns {object|null} - The calibrated profile, or null when fewer than three samples exist.
 */
export function calibrateReading(samples = []) {
  if (!Array.isArray(samples) || samples.length > 100) {
    throw new Error('Use at most 100 timed reading samples.');
  }
  if (!samples.length) {
    return null;
  }
  samples.forEach(validateReadingSample);
  if (new Set(samples.map((sample) => sample.id)).size !== samples.length) {
    throw new Error('Timed reading sample IDs must be unique.');
  }
  // Two or fewer samples pin an unregularized line through the origin and give
  // no estimate of fit quality; use the default algorithm instead.
  if (samples.length < 3) {
    return null;
  }
  // Features: [1, articulation seconds, pause seconds per class in default units].
  const features = samples.map(({ stats }) => [
    1,
    stats.weightedSyllables * 0.16,
    ...PAUSE_KINDS.map((kind) => (stats.pauses?.[kind] ?? 0) * PAUSE_UNITS[kind]),
  ]);
  const observed = samples.map((sample) => sample.seconds);
  // Residual spread from the default prediction (no intercept, all multipliers
  // 1). It is robust because most samples are expected to be well-timed, so a
  // single mistimed sample inflates only its own residual and is down-weighted.
  const defaultPrediction = (row) => row.slice(1).reduce((sum, value) => sum + value, 0);
  const defaultResiduals = features.map((row, index) =>
    Math.abs(observed[index] - defaultPrediction(row))
  );
  const spread = Math.max(1, median(defaultResiduals) * 1.4826, Math.min(...observed) * 0.05);
  // Hard-reject samples far outside the robust residual band before fitting;
  // with a 100x mistiming the intercept would otherwise absorb the outlier and
  // the remaining samples would look like errors.
  const inliers = samples.filter(
    (_, index) => defaultResiduals[index] <= Math.max(spread * 6, Math.min(...observed) * 2)
  );
  const fitSamples = inliers.length >= 3 ? inliers : samples;
  const fitFeatures = fitSamples.map(({ stats }) => [
    1,
    stats.weightedSyllables * 0.16,
    ...PAUSE_KINDS.map((kind) => (stats.pauses?.[kind] ?? 0) * PAUSE_UNITS[kind]),
  ]);
  const fitObserved = fitSamples.map((sample) => sample.seconds);
  // Fit seconds = intercept + a·articulation + w_k·pause_k directly. Robust
  // weights keep one mistimed sample from dominating; a light ridge scaled to
  // feature magnitude pulls the fit toward the default rate for sparse data.
  const featureScale = [
    1,
    Math.max(1, ...features.map((row) => row[1])),
    ...PAUSE_KINDS.map((_, k) => Math.max(1, ...features.map((row) => row[2 + k]))),
  ];
  const n = PAUSE_KINDS.length + 2;
  const ridge = 0.005 * fitSamples.length;
  // Start at the default prediction (all multipliers 1, no intercept).
  let coefficients = [0, ...new Array(n - 1).fill(1)];
  for (let iteration = 0; iteration < 15; iteration++) {
    const xtx = Array.from({ length: n }, () => new Array(n).fill(0));
    const xty = new Array(n).fill(0);
    for (let row = 0; row < fitSamples.length; row++) {
      const prediction = fitFeatures[row].reduce(
        (sum, value, i) => sum + value * coefficients[i],
        0
      );
      const residual = Math.abs(fitObserved[row] - prediction);
      const weight = Math.min(1, (1.5 * spread) / Math.max(residual, 1e-12));
      for (let i = 0; i < n; i++) {
        xty[i] += weight * fitFeatures[row][i] * fitObserved[row];
        for (let j = i; j < n; j++) {
          xtx[i][j] += weight * fitFeatures[row][i] * fitFeatures[row][j];
        }
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < i; j++) {
        xtx[i][j] = xtx[j][i];
      }
    }
    // Ridge: keep the intercept unregularized, pull the rest toward defaults.
    for (let i = 1; i < n; i++) {
      xtx[i][i] += ridge * featureScale[i] ** 2;
      xty[i] += ridge * featureScale[i] ** 2;
    }
    const solved = solveSystem(xtx, xty);
    // Clamp only pathological negatives; tiny negative values are numerical
    // noise and must not zero out a coefficient the data still supports.
    coefficients = solved.map((value) => (value < -1e-9 ? 0 : Math.max(0, value)));
  }
  const predict = (index) =>
    features[index].reduce((sum, value, i) => sum + value * coefficients[i], 0);
  const errors = samples.map((_, index) => Math.abs(predict(index) - observed[index]));
  const relativeErrors = errors.map((error, index) => error / Math.max(observed[index], 1e-12));
  const medianRelativeError = median(relativeErrors);
  // Modified z-score: robust to the very outliers it detects. A sample is
  // suspicious when it sits far above the typical error, or is plainly wrong.
  const errorSpread = Math.max(
    0.05,
    median(relativeErrors.map((value) => Math.abs(value - medianRelativeError))) * 1.4826
  );
  const outliers = samples
    .map((sample, index) => ({
      id: sample.id,
      name: sample.name,
      relativeError: relativeErrors[index],
    }))
    .filter(
      (entry) =>
        entry.relativeError > 0.25 ||
        (entry.relativeError - medianRelativeError) / errorSpread > 3.5
    );
  // Leave-one-out error: refit without each sample on the converged weights is
  // costly; approximate with the residual inflated by its robust down-weight.
  const looErrors = samples.map((_, index) => {
    const kept = errors.filter((__, other) => other !== index);
    const keptMedian = median(kept);
    return Math.max(errors[index], keptMedian);
  });
  const seconds = samples.reduce((sum, sample) => sum + sample.seconds, 0);
  const units = samples.reduce((sum, sample) => sum + sample.stats.weightedSyllables, 0);
  const words = samples.reduce((sum, sample) => sum + sample.stats.spokenWords, 0);
  return {
    intercept: coefficients[0],
    articulation: coefficients[1],
    pauses: 1,
    pauseWeights: Object.fromEntries(PAUSE_KINDS.map((kind, i) => [kind, coefficients[2 + i]])),
    count: samples.length,
    seconds,
    baselineDensity: units / words,
    medianRelativeError,
    looMeanAbsoluteError: looErrors.reduce((sum, value) => sum + value, 0) / looErrors.length,
    outliers,
    baselineSecondsPerWord: median(
      samples.map((_, index) => predict(index) / samples[index].stats.spokenWords)
    ),
  };
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
