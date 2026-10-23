import { slugify } from './markdown.js';
import { isMarkdown, resolveLink } from './vault.js';

const RELATION_PATTERN = /<!-- tagline-argument:(supports|answers|contradicts) \[\[([^\]#|]+)(?:#([^\]|]*))?\]\](?:\s+(\d+))? -->/g;
const HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

function scanHeadings(content) {
  const headings = [];
  let offset = 0;
  let fence = null;
  for (const line of content.split('\n')) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!fence) fence = marker;
      else if (fence === marker) fence = null;
    } else if (!fence) {
      const match = line.match(HEADING_PATTERN);
      if (match) headings.push({ level: match[1].length, title: match[2].trim(), start: offset });
    }
    offset += line.length + 1;
  }
  return headings;
}

function cardId(path, slug, occurrence) {
  return `${path}#${slug}#${occurrence}`;
}

export function getArgumentCards(contents) {
  const paths = Object.keys(contents).filter(isMarkdown);
  const cards = [];
  for (const path of paths) {
    const content = contents[path] || '';
    const headings = scanHeadings(content);
    const occurrences = new Map();
    for (let i = 0; i < headings.length; i++) {
      const heading = headings[i];
      if (heading.level !== 4) continue;
      const slug = slugify(heading.title);
      const occurrence = occurrences.get(slug) || 0;
      occurrences.set(slug, occurrence + 1);
      const endHeading = headings.slice(i + 1).find((next) => next.level <= 4);
      const end = endHeading ? endHeading.start : content.length;
      const section = content.slice(heading.start, end);
      cards.push({
        id: cardId(path, slug, occurrence),
        path,
        title: heading.title,
        slug,
        occurrence,
        section,
        start: heading.start,
        end,
        relations: [],
      });
    }
  }

  const byId = new Map(cards.map((card) => [card.id, card]));
  for (const card of cards) {
    for (const match of card.section.matchAll(RELATION_PATTERN)) {
      const targetPath = resolveLink(match[2], paths);
      if (!targetPath) continue;
      const slug = slugify(match[3] || '');
      const occurrence = match[4] ? Math.max(0, Number(match[4]) - 1) : 0;
      const targetId = cardId(targetPath, slug, occurrence);
      if (byId.has(targetId)) card.relations.push({ type: match[1], targetId });
    }
  }
  return cards;
}

export function createArgumentRelation(content, source, target, type) {
  if (!['supports', 'answers', 'contradicts'].includes(type)) {
    throw new Error(`Unknown argument relation: ${type}`);
  }
  if (!source || !target || source.id === target.id) return content;
  const comment = `<!-- tagline-argument:${type} [[${target.path.replace(/\.md$/i, '')}#${target.slug}]] ${target.occurrence + 1} -->`;
  const section = content.slice(source.start, source.end);
  if (section.includes(comment)) return content;
  const trimmedEnd = source.end;
  const existing = content.slice(source.start, trimmedEnd).replace(/\s+$/, '');
  const insertion = `${existing}\n${comment}\n`;
  return content.slice(0, source.start) + insertion + content.slice(trimmedEnd);
}

export function removeArgumentRelation(content, source, relation) {
  if (!source || !relation) return content;
  const target = relation.target;
  const comment = `<!-- tagline-argument:${relation.type} [[${target.path.replace(/\.md$/i, '')}#${target.slug}]] ${target.occurrence + 1} -->`;
  const section = content.slice(source.start, source.end);
  const index = section.indexOf(comment);
  if (index < 0) return content;
  const before = section.slice(0, index).replace(/\n+$/, '\n');
  const after = section.slice(index + comment.length).replace(/^\n/, '');
  return content.slice(0, source.start) + before + after + content.slice(source.end);
}

export function buildArgumentGraph(cards) {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const types = {};
  const edges = [];
  for (const card of cards) {
    for (const relation of card.relations) {
      if (!byId.has(relation.targetId)) continue;
      edges.push([card.id, relation.targetId]);
      types[`${card.id}\u0000${relation.targetId}`] = relation.type;
    }
  }
  const degrees = new Map(cards.map((card) => [card.id, 0]));
  for (const [from, to] of edges) {
    degrees.set(from, degrees.get(from) + 1);
    degrees.set(to, degrees.get(to) + 1);
  }
  const nodes = cards.map((card) => ({
    id: card.id,
    path: card.path,
    label: card.title,
    r: 5 + Math.sqrt(degrees.get(card.id)) * 2.5,
    color: '--text-muted',
  }));
  return { nodes, edges, edgeTypes: types };
}
