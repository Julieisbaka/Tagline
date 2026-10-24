const { createHash } = require('node:crypto');

const digest = (text) => createHash('sha256').update(text).digest('hex');

function chunksFor(content, maxWords = 160, overlap = 30) {
  const words = [];
  content.split('\n').forEach((line, lineNumber) => {
    for (const word of line.match(/\S+/g) || []) words.push({ text: word, line: lineNumber });
  });
  const chunks = [];
  for (let i = 0; i < words.length; i += maxWords - overlap) {
    const slice = words.slice(i, i + maxWords);
    chunks.push({ text: slice.map((w) => w.text).join(' '), line: slice[0].line });
    if (i + maxWords >= words.length) break;
  }
  return chunks;
}

function cosine(a, b) {
  if (a.length !== b.length || !a.length) throw new Error('Incompatible embedding dimensions.');
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
}

function lexicalAffinity(query, text) {
  const tokenize = (s) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const terms = [...new Set(tokenize(query))];
  const tokens = new Set(tokenize(text));
  return terms.length ? terms.filter((term) => tokens.has(term)).length / terms.length : 0;
}

function parseEmbeddingCache(content, model) {
  const saved = JSON.parse(content);
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid semantic index.');
  if (saved.model !== model) return {};
  if (!saved.documents || typeof saved.documents !== 'object' || Array.isArray(saved.documents)) {
    throw new Error('Invalid semantic index documents.');
  }
  return saved.documents;
}

function validCachedVectors(entry, hash, count, dimensions) {
  return !!entry && entry.hash === hash && Array.isArray(entry.vectors) && entry.vectors.length === count &&
    entry.vectors.every((vector) => Array.isArray(vector) && vector.length === dimensions && vector.every(Number.isFinite));
}

module.exports = { digest, chunksFor, cosine, lexicalAffinity, parseEmbeddingCache, validCachedVectors };
