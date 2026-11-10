let fonts = [];
let faces = [];
let generation = 0;
const MIME_TYPES = new Set(['font/woff2', 'font/woff', 'font/ttf', 'font/otf']);

export const getExtensionFonts = () => fonts;

export async function registerExtensionFonts(contributions = []) {
  const current = ++generation;
  faces.forEach((face) => document.fonts.delete(face));
  faces = [];
  const nextFonts = contributions.filter(
    (font) =>
      font &&
      /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/.test(font.family) &&
      MIME_TYPES.has(font.mimeType) &&
      typeof font.data === 'string' &&
      font.data.length <= 14_000_000 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(font.data)
  );
  fonts = nextFonts;
  const results = await Promise.allSettled(
    nextFonts.map(async (font) => {
      const face = new FontFace(font.family, `url(data:${font.mimeType};base64,${font.data})`, {
        weight: font.weight,
        style: font.style,
      });
      await face.load();
      if (current !== generation) {
        return;
      }
      document.fonts.add(face);
      faces.push(face);
    })
  );
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.warn(`Could not load extension font "${nextFonts[index].family}".`, result.reason);
    }
  });
  if (current !== generation) {
    return;
  }
  fonts = nextFonts.filter((_, index) => results[index].status === 'fulfilled');
  window.dispatchEvent(new Event('extension-fonts-changed'));
}
