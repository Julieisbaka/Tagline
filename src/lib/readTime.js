import { syllable } from 'syllable';
import { splitFrontmatter } from './frontmatter.js';

const SMALL = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const INITIALISMS = new Set(['US', 'USA', 'UK', 'UN', 'EU', 'USSR', 'GDP', 'FBI', 'CIA', 'AI', 'API']);

function integerWords(number) {
  if (number < 20) return SMALL[number];
  if (number < 100) return `${TENS[Math.floor(number / 10)]} ${number % 10 ? SMALL[number % 10] : ''}`;
  if (number < 1000) return `${SMALL[Math.floor(number / 100)]} hundred ${number % 100 ? integerWords(number % 100) : ''}`;
  if (number < 1_000_000) return `${integerWords(Math.floor(number / 1000))} thousand ${number % 1000 ? integerWords(number % 1000) : ''}`;
  return String(number).split('').map((digit) => SMALL[Number(digit)]).join(' ');
}

function spokenNumber(value) {
  value = value.replace(/,/g, '');
  if (value.includes('.')) {
    const [whole, fraction] = value.split('.');
    return `${spokenNumber(whole)} point ${[...fraction].map((digit) => SMALL[Number(digit)]).join(' ')}`;
  }
  if (value.length > 6) return [...value].map((digit) => SMALL[Number(digit)]).join(' ');
  if (/^0\d/.test(value)) return value.split('').map((digit) => SMALL[Number(digit)]).join(' ');
  const number = Number(value);
  // Citation years are normally read "nineteen ninety-nine" or "twenty twenty-four".
  if (number >= 1900 && number <= 2099 && number % 100) {
    if (number < 2000 || number >= 2010) {
      return `${integerWords(Math.floor(number / 100))} ${number % 100 < 10 ? 'oh ' : ''}${integerWords(number % 100)}`;
    }
  }
  return integerWords(number);
}

export function spokenText(value) {
  return splitFrontmatter(value).body.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(?:br\b[^>]*|\/(?:p|div|li|h[1-6]))>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => {
      const number = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : ' ';
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, name) =>
      ({ amp: ' and ', lt: ' ', gt: ' ', quot: '"', apos: "'", nbsp: ' ' })[name.toLowerCase()])
    .replace(/&[a-z]+;/gi, ' ');
}

export function speechStats(text) {
  const plain = spokenText(text);
  const tokens = plain.match(/[\p{L}]+(?:['\u2019-][\p{L}]+)*|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|%/gu) || [];
  let syllables = 0;
  let complexity = 0;
  let spokenWords = 0;
  let complexWords = 0;
  for (const token of tokens) {
    const spoken = /^\d/.test(token) ? spokenNumber(token) : token === '%' ? 'percent' : token;
    const initials = INITIALISMS.has(token) || /^[B-DF-HJ-NP-TV-Z]{2,6}$/.test(token);
    const count = initials ? [...token].reduce((n, letter) => n + (letter === 'W' ? 3 : 1), 0)
      : Math.max(1, syllable(spoken));
    syllables += count;
    spokenWords += initials ? token.length : (spoken.match(/[\p{L}]+/gu) || []).length;
    if (count >= 3 && !initials && !/^\d/.test(token)) complexWords++;
    // A modest articulation surcharge, not a readability score: long words and
    // dense consonant clusters take longer even at an identical syllable count.
    const clusters = (spoken.toLowerCase().match(/[bcdfghjklmnpqrstvwxyz]{3,}/g) || []).length;
    complexity += Math.max(0, count - 2) * 0.1 + Math.min(0.3, clusters * 0.08);
  }
  const punctuation = plain.replace(/\d[,.]\d/g, '0').replace(/\b(?:[A-Z]\.){2,}/g, 'initialism');
  const sentences = tokens.length ? Math.max(1, (punctuation.match(/[.!?]+(?=\s|$)/g) || []).length) : 0;
  const clauses = (punctuation.match(/[,;:]|[—–]/g) || []).length;
  const paragraphs = Math.max(0, plain.trim().split(/\n\s*\n/).filter(Boolean).length - 1);
  const pauseUnits = tokens.length
    ? (punctuation.match(/[.!?]+(?=\s|$)/g) || []).length * 0.22 + clauses * 0.09 + paragraphs * 0.15 : 0;
  return { syllables, weightedSyllables: syllables + complexity, spokenWords, complexWords, sentences, pauseUnits };
}

export function readingSeconds(stats, wpm = 250, profile = null) {
  if (!Number.isFinite(wpm) || wpm <= 0) throw new Error('Speaking rate must be a positive number.');
  if (!Number.isFinite(stats.weightedSyllables) || stats.weightedSyllables < 0 ||
    (stats.pauseUnits !== undefined && (!Number.isFinite(stats.pauseUnits) || stats.pauseUnits < 0))) {
    throw new Error('Invalid speech statistics.');
  }
  if (profile) {
    return stats.weightedSyllables * 0.16 * profile.articulation +
      (stats.pauseUnits || 0) * profile.pauses;
  }
  return stats.weightedSyllables / (wpm * 1.5) * 60 + (stats.pauseUnits || 0) * Math.sqrt(250 / wpm);
}

export function validateReadingSample(sample) {
  if (!sample || typeof sample.id !== 'string' || !sample.id || sample.id.length > 100 || typeof sample.name !== 'string' ||
    !sample.name.trim() || sample.name.length > 200 || !['full', 'evidence'].includes(sample.scope) ||
    !Number.isFinite(sample.seconds) || sample.seconds <= 0 || sample.seconds > 86400 ||
    sample.version !== 1 || !sample.stats) throw new Error('Invalid timed reading sample.');
  const stats = sample.stats;
  for (const key of ['syllables', 'weightedSyllables', 'spokenWords', 'complexWords', 'sentences', 'pauseUnits']) {
    if (!Number.isFinite(stats[key]) || stats[key] < 0 || stats[key] > 1e9) throw new Error('Invalid sample statistics.');
  }
  if (!stats.spokenWords || !stats.weightedSyllables || !stats.sentences) {
    throw new Error('Reading samples must contain spoken words. Check the selected scope and highlights.');
  }
  return sample;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function calibrateReading(samples = []) {
  if (!Array.isArray(samples) || samples.length > 100) throw new Error('Use at most 100 timed reading samples.');
  if (!samples.length) return null;
  samples.forEach(validateReadingSample);
  if (new Set(samples.map((sample) => sample.id)).size !== samples.length) throw new Error('Timed reading sample IDs must be unique.');
  const rows = samples.map(({ stats, seconds }) => {
    const articulation = stats.weightedSyllables * 0.16;
    const base = articulation + stats.pauseUnits;
    return { x: articulation / base, y: stats.pauseUnits / base, ratio: seconds / base };
  });
  const center = median(rows.map((row) => row.ratio));
  const spread = Math.max(center * 0.1, median(rows.map((row) => Math.abs(row.ratio - center))) * 1.4826);
  // Robust relative-error fitting prevents one long or mistimed sample dominating.
  let articulation = center;
  let pauses = center;
  for (let iteration = 0; iteration < 8; iteration++) {
    let xx = 0.03 * rows.length; let yy = 0.1 * rows.length; let xy = 0;
    let xt = xx * center; let yt = yy * center;
    for (const row of rows) {
      const residual = Math.abs(row.ratio - (row.x * articulation + row.y * pauses));
      const weight = Math.min(1, 1.5 * spread / Math.max(residual, 1e-12));
      xx += weight * row.x ** 2; yy += weight * row.y ** 2; xy += weight * row.x * row.y;
      xt += weight * row.x * row.ratio; yt += weight * row.y * row.ratio;
    }
    const determinant = xx * yy - xy ** 2;
    articulation = Math.max(center * 0.05, (xt * yy - yt * xy) / determinant);
    pauses = Math.max(center * 0.05, (yt * xx - xt * xy) / determinant);
  }
  const seconds = samples.reduce((sum, sample) => sum + sample.seconds, 0);
  const units = samples.reduce((sum, sample) => sum + sample.stats.weightedSyllables, 0);
  const words = samples.reduce((sum, sample) => sum + sample.stats.spokenWords, 0);
  const errors = samples.map(({ stats, seconds: observed }) =>
    Math.abs(readingSeconds(stats, 250, { articulation, pauses }) - observed) / observed);
  return {
    articulation, pauses, count: samples.length, seconds,
    baselineDensity: units / words, medianRelativeError: median(errors),
    baselineSecondsPerWord: median(samples.map(({ stats }) =>
      readingSeconds(stats, 250, { articulation, pauses }) / stats.spokenWords)),
  };
}

export function readingAssessment(stats, wpm = 250, profile = null) {
  const words = stats.spokenWords || 0;
  const density = words ? stats.weightedSyllables / words : 0;
  const readingEase = words ? 206.835 - 1.015 * words / Math.max(1, stats.sentences) -
    84.6 * stats.syllables / words : null;
  const baseline = profile?.baselineDensity || 1.6;
  const seconds = readingSeconds(stats, wpm, profile);
  const effort = words ? profile
    ? 100 * seconds / words / profile.baselineSecondsPerWord : 100 * density / baseline : null;
  return { seconds, readingEase, effort, calibrated: !!profile };
}
