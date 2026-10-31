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

function isExplicitlyNonBold(value) {
  return value === 'normal' || (/^\d+$/.test(value) && Number(value) < 600);
}

function hasVisibleBackground(value) {
  const color = value.trim().toLowerCase();
  return Boolean(color && ![
    'transparent', 'white', '#fff', '#ffffff', 'initial', 'inherit', 'unset', 'revert', 'revert-layer',
    'rgb(255, 255, 255)', 'rgba(255, 255, 255, 1)',
  ].includes(color) && !/^rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(color));
}

function splitAroundChild(parent, child, preserveMiddle) {
  const before = parent.cloneNode(false);
  const after = parent.cloneNode(false);
  while (parent.firstChild !== child) before.append(parent.firstChild);
  while (child.nextSibling) after.append(child.nextSibling);

  const replacements = [];
  if (before.hasChildNodes()) replacements.push(before);
  if (preserveMiddle) {
    const middle = parent.cloneNode(false);
    middle.append(child);
    replacements.push(middle);
  } else {
    replacements.push(child);
  }
  if (after.hasChildNodes()) replacements.push(after);
  parent.replaceWith(...replacements);
}

function liftOutOfBold(element) {
  let boldAncestor = element.parentElement?.closest('b, strong');
  while (boldAncestor) {
    let child = element;
    while (child.parentElement !== boldAncestor) {
      const parent = child.parentElement;
      splitAroundChild(parent, child, true);
    }
    splitAroundChild(boldAncestor, child, false);
    boldAncestor = element.parentElement?.closest('b, strong');
  }
}

const tableStructure = new Set(['TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'CAPTION', 'COLGROUP']);
const blockElements = new Set([
  ...tableStructure, 'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIALOG', 'DIV', 'DL',
  'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HEADER', 'HGROUP', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'SUMMARY', 'UL',
]);

function wrapInlineContent(element, tagName) {
  let inlineChildren = [];
  const wrapInlineRun = () => {
    if (!inlineChildren.length) return;
    const wrapper = element.ownerDocument.createElement(tagName);
    inlineChildren[0].before(wrapper);
    for (const child of inlineChildren) wrapper.append(child);
    inlineChildren = [];
  };
  for (const child of [...element.childNodes]) {
    if (child.nodeType === 1 && blockElements.has(child.tagName)) {
      wrapInlineRun();
      wrapInlineContent(child, tagName);
    } else {
      inlineChildren.push(child);
    }
  }
  wrapInlineRun();
}

function applyMark(element, tagName) {
  if (tableStructure.has(element.tagName)) {
    const cells = element.matches('td, th') ? [element] : [...element.querySelectorAll('td, th')];
    for (const cell of cells) wrapInlineContent(cell, tagName);
  } else {
    wrapInlineContent(element, tagName);
  }
}

/** Remove pasted inline styling while retaining selected emphasis marks. @returns {string} */
export function cleanPastedHTML(html, {
  keepBold = true, keepUnderline = true, keepHighlight = true,
} = {}) {
  const tableFragment = !/<table\b/i.test(html) &&
    /^\s*<(?:caption|colgroup|thead|tbody|tfoot|tr|td|th)\b/i.test(html);
  const document = new DOMParser().parseFromString(
    tableFragment ? `<table>${html}</table>` : html,
    'text/html',
  );
  const table = tableFragment ? document.body.querySelector('table') : null;
  const root = table || document.body;

  for (const element of [...root.querySelectorAll('*')]) {
    const tag = element.tagName.toLowerCase();
    const { fontWeight, fontStyle, textDecoration, textDecorationLine, backgroundColor } = element.style;
    const bold = isBoldWeight(fontWeight);
    const nonBold = isExplicitlyNonBold(fontWeight);
    const italic = fontStyle === 'italic' || fontStyle === 'oblique';
    const decoration = `${textDecoration} ${textDecorationLine}`;
    const underline = decoration.includes('underline');
    const strike = decoration.includes('line-through');
    const highlight = hasVisibleBackground(backgroundColor);

    if (nonBold) liftOutOfBold(element);
    element.removeAttribute('style');
    if (keepHighlight && highlight && tag !== 'mark') applyMark(element, 'mark');
    if (keepUnderline && underline && tag !== 'u') applyMark(element, 'u');
    if (keepBold && bold && !['b', 'strong'].includes(tag)) applyMark(element, 'strong');
    if (italic && !['i', 'em'].includes(tag)) applyMark(element, 'em');
    if (strike && !['s', 'strike', 'del'].includes(tag)) applyMark(element, 's');

    if (tag === 'font') unwrap(element);
    else if (['b', 'strong'].includes(tag) && (nonBold || !keepBold)) unwrap(element);
    else if (!keepUnderline && tag === 'u') unwrap(element);
    else if (!keepHighlight && tag === 'mark') unwrap(element);
  }
  return table ? table.innerHTML : document.body.innerHTML;
}
