const WORD_CHARACTER = /[\p{L}\p{M}\p{N}_]/u;

export function wordRangeAt(text, offset) {
  let index = Math.max(0, Math.min(text.length, offset));
  const isWord = (character) => !!character && WORD_CHARACTER.test(character);
  if (!isWord(text[index]) && isWord(text[index - 1])) {
    index--;
  }
  if (!isWord(text[index])) {
    return null;
  }
  let start = index;
  let end = index + 1;
  while (isWord(text[start - 1])) {
    start--;
  }
  while (isWord(text[end])) {
    end++;
  }
  return [start, end];
}
