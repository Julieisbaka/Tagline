export function fillTemplate(text, title) {
  const now = new Date();
  return text
    .replace(/{{date}}/g, now.toISOString().slice(0, 10))
    .replace(/{{time}}/g, now.toTimeString().slice(0, 5))
    .replace(/{{title}}/g, title);
}
