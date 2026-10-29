function wrapContents(element, tagName) {
  const wrapper = element.ownerDocument.createElement(tagName);
  while (element.firstChild) wrapper.append(element.firstChild);
  element.append(wrapper);
}

function unwrap(element) {
  element.replaceWith(...element.childNodes);
}

function isBoldWeight(value) {
  return value === 'bold' || value === 'bolder' || Number.parseInt(value, 10) >= 600;
}

function hasVisibleBackground(value) {
  return Boolean(value && value !== 'transparent' &&
    !/^rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(value));
}

/** Remove pasted inline styling while retaining selected emphasis marks. @returns {string} */
export function cleanPastedHTML(html, {
  keepBold = true, keepUnderline = true, keepHighlight = true,
} = {}) {
  const document = new DOMParser().parseFromString(html, 'text/html');
  for (const element of [...document.body.querySelectorAll('*')]) {
    const tag = element.tagName.toLowerCase();
    const { fontWeight, textDecoration, textDecorationLine, backgroundColor } = element.style;
    const bold = isBoldWeight(fontWeight);
    const underline = `${textDecoration} ${textDecorationLine}`.includes('underline');
    const highlight = hasVisibleBackground(backgroundColor);

    element.removeAttribute('style');
    if (keepHighlight && highlight && tag !== 'mark') wrapContents(element, 'mark');
    if (keepUnderline && underline && tag !== 'u') wrapContents(element, 'u');
    if (keepBold && bold && !['b', 'strong'].includes(tag)) wrapContents(element, 'strong');

    if (tag === 'font') unwrap(element);
    else if (!keepBold && ['b', 'strong'].includes(tag)) unwrap(element);
    else if (!keepUnderline && tag === 'u') unwrap(element);
    else if (!keepHighlight && tag === 'mark') unwrap(element);
  }
  return document.body.innerHTML;
}
