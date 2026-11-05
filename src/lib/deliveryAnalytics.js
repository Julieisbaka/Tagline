const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
const FILLERS = new Set(['um', 'uh', 'erm', 'er', 'umm', 'uhh']);

/** Count conservative English filler tokens and calculate pace only from a supplied duration. */
export function analyzeDelivery(transcript, seconds = null) {
  if (typeof transcript !== 'string' || transcript.length > 200000) {
    throw new Error('Transcript must be at most 200,000 characters.');
  }
  if (seconds !== null && (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86400)) {
    throw new Error('Duration must be between 0 and 86,400 seconds.');
  }
  const words = transcript.match(WORD) || [];
  const fillers = {};
  for (const word of words) {
    const lower = word.toLowerCase();
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
