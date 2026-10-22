import { spokenText } from './readTime.js';

export const HYPOTHESIS_TEMPLATES = [
  { id: 'stance', label: 'The author of this text believes {}.' },
  { id: 'topic', label: 'This text is about {}.' },
  { id: 'custom', label: 'Custom hypothesis' },
];

// Converts note Markdown to plain prose so markup does not consume model tokens.
export function premiseText(markdown) {
  const withoutFrontmatter = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
  return spokenText(withoutFrontmatter
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, '')
    .replace(/(\*\*|__|==|~~|\*|_)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/`([^`]*)`/g, '$1'))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildHypotheses(templateId, lines) {
  const template = HYPOTHESIS_TEMPLATES.find((item) => item.id === templateId) || HYPOTHESIS_TEMPLATES[2];
  return lines.split('\n').map((line) => line.trim()).filter(Boolean).map((line) =>
    template.id === 'custom' ? line : template.label.replace('{}', line.replace(/[.\s]+$/, '')));
}

export function entailmentLabel(probability) {
  if (probability >= 0.8) return 'Strongly supported';
  if (probability >= 0.5) return 'Supported';
  if (probability >= 0.2) return 'Weak support';
  return 'Not supported';
}
