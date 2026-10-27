import { spokenText } from './readTime.js';

export const HYPOTHESIS_TEMPLATES = [
  { id: 'stance', label: 'The author of this text believes {}.' },
  { id: 'topic', label: 'This text is about {}.' },
  { id: 'custom', label: 'Custom hypothesis' },
];

/** 
 * Convert Markdown evidence into plain prose for local entailment analysis.
 * This function strips out Markdown syntax, code blocks, and frontmatter, producing a clean, readable text suitable for entailment evaluation.
 * @param {string} markdown 
 * @returns {string} 
 */
export function premiseText(markdown) {
  const withoutFrontmatter = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
  return spokenText(withoutFrontmatter
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/^[ \t]{0,3}(?:#{1,6}\s+|>[ \t]?|[-*+][ \t]+|\d+[.)][ \t]+)/gm, '')
    .replace(/(\*\*|__|==|~~|\*|_)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/`([^`]*)`/g, '$1'))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 
 * Build one hypothesis per nonblank line using a built-in template.
 * This function takes a template ID and a block of text, splits the text into individual lines, and generates a hypothesis for each nonblank line based on the specified template.
 * @param {string} templateId - The ID of the hypothesis template to use.
 * @param {string} lines - The text containing one or more lines to generate hypotheses from. Each nonblank line will be used to build a hypothesis.
 * @returns {string[]} - An array of generated hypotheses, one for each nonblank line.
 */
export function buildHypotheses(templateId, lines) {
  const template = HYPOTHESIS_TEMPLATES.find((item) => item.id === templateId) || HYPOTHESIS_TEMPLATES[2];
  return lines.split('\n').map((line) => line.trim()).filter(Boolean).map((line) =>
    template.id === 'custom' ? line : template.label.replace('{}', line.replace(/[.\s]+$/, '')));
}

/** 
 * Map an entailment probability to Tagline's user-facing confidence label. 
 * @param {number} probability 
 * @returns {string} 
 */
export function entailmentLabel(probability) {
  if (probability >= 0.8) return 'Strongly supported';
  if (probability >= 0.5) return 'Supported';
  if (probability >= 0.2) return 'Weak support';
  return 'Not supported';
}
