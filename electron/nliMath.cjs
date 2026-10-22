const MAX_POSITIONS = 512;
const MAX_PASSAGES = 48;

function softmax(values) {
  const top = Math.max(...values);
  const exps = values.map((value) => Math.exp(value - top));
  const total = exps.reduce((sum, value) => sum + value, 0);
  return exps.map((value) => value / total);
}

// Packs whole sentences into passages that fit the model window; oversized
// sentences are split on word boundaries so nothing is silently truncated.
function chunkPremise(text, count, budget, maxPassages = MAX_PASSAGES) {
  if (!Number.isInteger(budget) || budget < 16) throw new Error('The hypothesis leaves no room for the document.');
  const sentences = text.split(/(?<=[.!?]["'\u201d\u2019)\]]?)\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const pieces = [];
  for (const sentence of sentences) {
    if (count(sentence) <= budget) { pieces.push(sentence); continue; }
    // Per-word counts are nearly additive; keep a margin for merges at boundaries.
    let words = [];
    let used = 0;
    for (const word of sentence.split(/\s+/)) {
      const size = count(word);
      if (words.length && used + size > budget * 0.9) {
        pieces.push(words.join(' '));
        words = [];
        used = 0;
      }
      words.push(word);
      used += size;
    }
    if (words.length) pieces.push(words.join(' '));
  }
  const chunks = [];
  let current = '';
  for (const piece of pieces) {
    const next = current ? `${current} ${piece}` : piece;
    if (current && count(next) > budget) {
      chunks.push(current);
      current = piece;
    } else current = next;
  }
  if (current) chunks.push(current);
  if (!chunks.length) throw new Error('The selected text is empty.');
  return { chunks: chunks.slice(0, maxPassages), truncated: chunks.length > maxPassages };
}

module.exports = { MAX_POSITIONS, MAX_PASSAGES, softmax, chunkPremise };
