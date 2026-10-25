import { isMap, parseDocument } from 'yaml';

export function splitFrontmatter(content) {
  const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(content);
  if (!opening) return { prefix: '', raw: null, body: content, offset: 0, error: '' };
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/gm;
  closing.lastIndex = opening[0].length;
  const end = closing.exec(content);
  if (!end) return { prefix: '', raw: null, body: content, offset: 0, error: 'Missing closing YAML frontmatter delimiter.' };
  const offset = end.index + end[0].length;
  return {
    prefix: content.slice(0, offset), raw: content.slice(opening[0].length, end.index),
    body: content.slice(offset), offset, error: '',
  };
}

function metadataDocument(raw) {
  const document = parseDocument(raw);
  const problem = document.errors[0] || document.warnings[0];
  if (problem) throw new Error(problem.message);
  if (document.contents !== null && !isMap(document.contents)) throw new Error('YAML frontmatter must be a mapping.');
  return document;
}

export function readFrontmatter(content) {
  const parts = splitFrontmatter(content);
  if (parts.error || parts.raw === null) return { ...parts, data: {} };
  try {
    const data = metadataDocument(parts.raw).toJS({ maxAliasCount: 50 }) || {};
    return { ...parts, data };
  } catch (error) {
    return { ...parts, data: {}, error: error.message };
  }
}

export function markSpeechDocument(content) {
  const metadata = readFrontmatter(content);
  if (metadata.error) throw new Error(`Invalid YAML frontmatter: ${metadata.error}`);
  if (metadata.data.speech === true) return content;
  const document = metadataDocument(metadata.raw || '');
  document.set('speech', true);
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const yaml = document.toString().replace(/\n/g, newline);
  return `---${newline}${yaml}---${newline}${metadata.prefix ? '' : newline}${metadata.body}`;
}

export function speechDocumentPaths(contents) {
  return Object.keys(contents).filter((path) =>
    /\.md$/i.test(path) && readFrontmatter(contents[path]).data.speech === true).sort();
}
