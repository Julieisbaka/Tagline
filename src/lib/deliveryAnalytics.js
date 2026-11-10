const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
const FILLERS = new Set(['um', 'uh', 'erm', 'er', 'umm', 'uhh', 'like']);

/** Count conservative English filler tokens and calculate pace only from a supplied duration. */
export function analyzeDelivery(transcript, seconds = null) {
  if (typeof transcript !== 'string' || transcript.length > 200000) {
    throw new Error('Transcript must be at most 200,000 characters.');
  }
  if (seconds !== null && (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86400)) {
    throw new Error('Duration must be between 0 and 86,400 seconds.');
  }
  const words = [...transcript.matchAll(WORD)];
  const fillers = {};
  for (let i = 0; i < words.length; i++) {
    const lower = words[i][0].toLowerCase();
    if (
      lower === 'so' &&
      words[i + 1]?.[0].toLowerCase() === 'yeah' &&
      /^\s*,?\s*$/.test(transcript.slice(words[i].index + words[i][0].length, words[i + 1].index))
    ) {
      fillers['so yeah'] = (fillers['so yeah'] || 0) + 1;
      i++;
      continue;
    }
    if (FILLERS.has(lower)) {
      fillers[lower] = (fillers[lower] || 0) + 1;
    }
  }
  return {
    words: words.length,
    fillers,
    fillerCount: Object.values(fillers).reduce((sum, count) => sum + count, 0),
    wpm: seconds && words.length ? Math.round((words.length * 60) / seconds) : null,
  };
}
