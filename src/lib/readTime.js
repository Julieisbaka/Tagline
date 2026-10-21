import { syllable } from 'syllable';

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
  return value.replace(/<(?:br\b[^>]*|\/(?:p|div|li|h[1-6]))>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => {
      const number = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : ' ';
    })
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, name) =>
      ({ amp: ' and ', lt: ' ', gt: ' ', quot: '"', apos: "'", nbsp: ' ' })[name.toLowerCase()])
    .replace(/&[a-z]+;/gi, ' ');
}

export function speechStats(text) {
  const tokens = spokenText(text).match(/[\p{L}]+(?:['\u2019-][\p{L}]+)*|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|%/gu) || [];
  let syllables = 0;
  let complexity = 0;
  for (const token of tokens) {
    const spoken = /^\d/.test(token) ? spokenNumber(token) : token === '%' ? 'percent' : token;
    const initials = INITIALISMS.has(token) || /^[B-DF-HJ-NP-TV-Z]{2,6}$/.test(token);
    const count = initials ? [...token].reduce((n, letter) => n + (letter === 'W' ? 3 : 1), 0)
      : Math.max(1, syllable(spoken));
    syllables += count;
    // A modest articulation surcharge, not a readability score: long words and
    // dense consonant clusters take longer even at an identical syllable count.
    const clusters = (spoken.toLowerCase().match(/[bcdfghjklmnpqrstvwxyz]{3,}/g) || []).length;
    complexity += Math.max(0, count - 2) * 0.1 + Math.min(0.3, clusters * 0.08);
  }
  return { syllables, weightedSyllables: syllables + complexity };
}

export function readingSeconds(stats, wpm = 250) {
  if (!Number.isFinite(wpm) || wpm <= 0) throw new Error('Speaking rate must be a positive number.');
  // Keep the user's WPM calibration: average English speech is approximately
  // 1.5 syllables/word, but duration now depends on actual articulation units.
  return stats.weightedSyllables / (wpm * 1.5) * 60;
}
