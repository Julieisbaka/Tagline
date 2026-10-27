import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  SearchQuery,
  setSearchQuery,
} from '@codemirror/search';
import { trapTabKey } from './focusScope.js';
import { translate } from './i18n.js';

/** Update the search match count and current-match status in the panel. @param {EditorView} view @param {object} queryCache @returns {object} */
function matchStatus(view, queryCache) {
  const query = getSearchQuery(view.state);
  if (queryCache.query && queryCache.doc === view.state.doc &&
    queryCache.query.search === query.search &&
    queryCache.query.caseSensitive === query.caseSensitive &&
    queryCache.query.wholeWord === query.wholeWord &&
    queryCache.query.literal === query.literal &&
    queryCache.query.regexp === query.regexp) {
    return queryCache.matches;
  }

  const matches = [];
  if (query.valid) {
    const cursor = query.getCursor(view.state);
    let match = cursor.next();
    while (!match.done) {
      matches.push({ from: match.value.from, to: match.value.to });
      match = cursor.next();
    }
  }
  queryCache.query = query;
  queryCache.doc = view.state.doc;
  queryCache.matches = matches;
  return matches;
}

/** Return the match containing the current editor selection, if any. @param {object[]} matches @param {object} selection @returns {number} */
function currentMatch(matches, selection) {
  let low = 0;
  let high = matches.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (matches[middle].from < selection.from) low = middle + 1;
    else high = middle;
  }
  return matches[low]?.from === selection.from && matches[low]?.to === selection.to ? low + 1 : 0;
}

/** Create the CodeMirror find/replace panel and its state synchronization. @param {EditorView} view @returns {object} */
export function createCodeMirrorFindReplacePanel(view) {
  const dom = document.createElement('div');
  dom.className = 'visual-find';
  dom.setAttribute('role', 'search');
  dom.setAttribute('aria-label', translate('Find and replace in note'));

  const findForm = document.createElement('form');
  findForm.className = 'visual-find-row';
  const findInput = document.createElement('input');
  findInput.setAttribute('aria-label', translate('Find text'));
  findInput.setAttribute('main-field', 'true');
  findInput.placeholder = translate('Find text');
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const previousButton = document.createElement('button');
  previousButton.type = 'button';
  previousButton.textContent = translate('Previous match');
  const nextButton = document.createElement('button');
  nextButton.type = 'submit';
  nextButton.textContent = translate('Next match');
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = translate('Close find');
  findForm.append(findInput, status, previousButton, nextButton, closeButton);

  const replaceForm = document.createElement('form');
  replaceForm.className = 'visual-find-row';
  const replaceInput = document.createElement('input');
  replaceInput.setAttribute('aria-label', translate('Replace with'));
  replaceInput.placeholder = translate('Replace with');
  const replaceButton = document.createElement('button');
  replaceButton.type = 'submit';
  replaceButton.textContent = translate('Replace');
  const replaceAllButton = document.createElement('button');
  replaceAllButton.type = 'button';
  replaceAllButton.textContent = translate('Replace all');
  const caseLabel = document.createElement('label');
  const caseInput = document.createElement('input');
  caseInput.type = 'checkbox';
  caseLabel.append(caseInput, document.createTextNode(translate('Match case')));
  const wholeWordLabel = document.createElement('label');
  const wholeWordInput = document.createElement('input');
  wholeWordInput.type = 'checkbox';
  wholeWordLabel.append(wholeWordInput, document.createTextNode(translate('Whole words')));
  replaceForm.append(replaceInput, replaceButton, replaceAllButton, caseLabel, wholeWordLabel);
  dom.append(findForm, replaceForm);

  const initialQuery = getSearchQuery(view.state);
  findInput.value = initialQuery.search;
  replaceInput.value = initialQuery.replace;
  caseInput.checked = initialQuery.caseSensitive;
  wholeWordInput.checked = initialQuery.wholeWord;

  const cache = { query: null, doc: null, matches: [] };
  let closed = false;
  /** Build a literal CodeMirror search query from the panel controls. @returns {SearchQuery} */
  const buildQuery = () => new SearchQuery({
    search: findInput.value,
    replace: replaceInput.value,
    caseSensitive: caseInput.checked,
    wholeWord: wholeWordInput.checked,
    literal: true,
  });
  /** Dispatch the current query and optionally navigate to its first match. @param {boolean} [navigate] @returns {void} */
  const updateQuery = (navigate = false) => {
    if (closed || view.destroyed) return;
    const query = buildQuery();
    view.dispatch({
      ...(navigate && query.valid ? { selection: { anchor: 0 } } : {}),
      effects: setSearchQuery.of(query),
    });
    if (navigate && query.valid) findNext(view);
  };
  /** Refresh result count, control state, and values from the editor's active query. @returns {void} */
  const refresh = () => {
    if (closed || view.destroyed) return;
    const query = getSearchQuery(view.state);
    const matches = matchStatus(view, cache);
    const selection = view.state.selection.main;
    const current = query.search ? currentMatch(matches, selection) : 0;
    status.textContent = translate('{current} of {total}', { current, total: matches.length });
    previousButton.disabled = nextButton.disabled = replaceButton.disabled = replaceAllButton.disabled = matches.length === 0;
    if (findInput.value !== query.search) findInput.value = query.search;
    if (document.activeElement !== replaceInput && replaceInput.value !== query.replace) {
      replaceInput.value = query.replace;
    }
    caseInput.checked = query.caseSensitive;
    wholeWordInput.checked = query.wholeWord;
  };
  /** Clear the active search query, close the panel, and restore editor focus. @returns {void} */
  const close = () => {
    if (closed || view.destroyed) return;
    const query = getSearchQuery(view.state);
    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({
        search: '',
        replace: query.replace,
        caseSensitive: query.caseSensitive,
        wholeWord: query.wholeWord,
        literal: true,
      })),
    });
    closeSearchPanel(view);
    view.focus();
  };

  findForm.addEventListener('submit', (event) => {
    event.preventDefault();
    findNext(view);
  });
  findForm.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      findPrevious(view);
    }
  });
  replaceForm.addEventListener('submit', (event) => {
    event.preventDefault();
    updateQuery();
    replaceNext(view);
  });
  dom.addEventListener('keydown', (event) => {
    trapTabKey(event, dom);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  });
  findInput.addEventListener('input', () => updateQuery(true));
  caseInput.addEventListener('change', () => updateQuery(true));
  wholeWordInput.addEventListener('change', () => updateQuery(true));
  previousButton.addEventListener('click', () => findPrevious(view));
  replaceAllButton.addEventListener('click', () => {
    updateQuery();
    replaceAll(view);
  });
  closeButton.addEventListener('click', close);

  return {
    dom,
    top: true,
    mount() {
      findInput.focus();
      refresh();
    },
    update(update) {
      if (update.docChanged || update.selectionSet || update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(setSearchQuery)))) refresh();
    },
    destroy() {
      closed = true;
    },
  };
}
