// Require a tag, a recognizable author/year citation, and evidence before
// changing pasted text. Ordinary articles and snippets are left alone.
export function isCardLead(tag, cite, body) {
  const plainTag = tag.replace(/[*_`]/g, '').trim();
  const plainCite = cite.replace(/[*_`]/g, '').trim();
  return (
    plainTag.length > 0 &&
    plainTag.length <= 160 &&
    !/^(?:#{1,6}\s|[-*+]\s|\d+\.\s)/.test(plainTag) &&
    !/[.!?]$/.test(plainTag) &&
    /^[\p{L}][^\n]{0,160}\b(?:19|20)\d{2}\b/u.test(plainCite) &&
    body.trim().length >= 40
  );
}

export function smartPasteMarkdown(text) {
  const lines = text.split(/\r?\n/);
  const first = lines.findIndex((line) => line.trim());
  const second = lines.findIndex((line, index) => index > first && line.trim());
  const third = lines.findIndex((line, index) => index > second && line.trim());
  if (
    first < 0 ||
    second < 0 ||
    third < 0 ||
    !isCardLead(lines[first], lines[second], lines.slice(third).join('\n'))
  ) {
    return text;
  }
  lines[first] = `#### ${lines[first]}`;
  if (!/[*_`\[\]]/.test(lines[second])) {
    lines[second] = `**${lines[second]}**`;
  }
  return lines.join('\n');
}
