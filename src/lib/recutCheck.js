import nlp from 'compromise';
import { Marked } from 'marked';
import { spokenText } from './readTime.js';

const markdown = new Marked({ gfm: true, breaks: true });
markdown.use({
  extensions: [
    {
      name: 'evidenceHighlight',
      level: 'inline',
      start: (source) => source.indexOf('=='),
      tokenizer(source) {
        const match = /^==(?=\S)([\s\S]*?\S)==/.exec(source);
        if (match) {
          return {
            type: 'evidenceHighlight',
            raw: match[0],
            tokens: this.lexer.inlineTokens(match[1]),
          };
        }
        return undefined;
      },
    },
  ],
});

/** Extract the highlighted reading in order, not each highlight as a separate sentence. */
export function highlightedReading(body) {
  const pieces = [];
  let markDepth = 0;
  const walk = (tokens, highlighted = false) => {
    for (const token of tokens || []) {
      if (token.type === 'html') {
        if (/^<mark\b[^>]*>$/i.test(token.raw)) {
          markDepth++;
        } else if (/^<\/mark\s*>$/i.test(token.raw)) {
          markDepth = Math.max(0, markDepth - 1);
          if (!markDepth) {
            pieces.push(' ');
          }
        }
      } else if (token.type === 'evidenceHighlight') {
        walk(token.tokens, true);
        pieces.push(' ');
      } else if (token.type === 'codespan' || token.type === 'code' || token.type === 'heading') {
        continue;
      } else if (token.type === 'list') {
        walk(token.items, highlighted);
      } else if (token.tokens) {
        walk(token.tokens, highlighted);
        if (token.type === 'paragraph' || token.type === 'list_item') {
          pieces.push(' ');
        }
      } else if ((highlighted || markDepth) && token.type === 'text') {
        pieces.push(token.text);
      } else if ((highlighted || markDepth) && token.type === 'br') {
        pieces.push(' ');
      }
    }
  };
  walk(markdown.lexer(body));
  return spokenText(pieces.join('')).replace(/\s+/g, ' ').trim();
}

const dangling =
  /^(?:and|or|but|because|if|unless|while|although|though|when|where|which|who|that|to|of|for|with|without|in|on|at|by|as|the|a|an)$/i;
const disagreement =
  /\b(?:(?:he|she|it)\s+(?:are|were|have|do)|(?:we|they|you)\s+(?:is|was|has|does)|i\s+(?:is|are|has))\b/i;
const repeatedWords = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'of',
  'to',
  'in',
  'on',
  'with',
  'for',
  'is',
  'are',
  'was',
  'were',
  'has',
  'have',
  'will',
]);

/** Flag likely English reading problems; these are hints, not grammar verdicts. */
export function checkRecut(body) {
  const text = highlightedReading(body);
  if (text.length > 20000) {
    return [{ reason: 'too_long', excerpt: '' }];
  }
  const words = [...text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu)];
  if (words.length < 2) {
    return [];
  }

  const terms = nlp(text)
    .json({ offset: true })
    .flatMap((sentence) => sentence.terms || []);
  const findings = [];
  const add = (reason, start, end) => {
    const from = Math.max(0, start - 100);
    const to = Math.min(text.length, end + 100);
    findings.push({
      reason,
      start,
      excerpt: `${from ? '…' : ''}${text.slice(from, to).trim()}${to < text.length ? '…' : ''}`,
    });
  };
  const mismatch = disagreement.exec(text);
  if (mismatch) {
    add('agreement', mismatch.index, mismatch.index + mismatch[0].length);
  }
  const repeat = terms.findIndex(
    (term, index) =>
      index > 0 &&
      repeatedWords.has(term.normal) &&
      term.normal === terms[index - 1].normal &&
      /^\s+$/.test(terms[index - 1].post) &&
      !term.pre &&
      term.tags.some((tag) => ['Determiner', 'Connector', 'Verb'].includes(tag))
  );
  if (repeat >= 0) {
    const first = terms[repeat - 1].offset.start;
    const last = terms[repeat].offset;
    add('repetition', first, last.start + last.length);
  }
  const last = words.at(-1);
  if (dangling.test(last[0])) {
    add('ending', last.index, last.index + last[0].length);
  }
  return findings
    .sort((a, b) => a.start - b.start)
    .map(({ reason, excerpt }) => ({ reason, excerpt }));
}
