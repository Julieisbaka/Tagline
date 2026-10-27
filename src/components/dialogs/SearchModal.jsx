import { useEffect, useMemo, useRef, useState } from 'react';
import defaults from '../../lib/defaultSettings.json' with { type: 'json' };
import { useI18n } from '../../lib/i18n.js';
import { createSearchEngine, filterSearchDocuments, HYBRID_CANDIDATE_LIMIT, mergeHybridResults, parseQuery, searchExcerpt } from '../../lib/search.js';
import { displayName } from '../../lib/vault.js';
import ModalBackdrop from './ModalBackdrop.jsx';

// Keyword and local embedding search share tag and phrase constraints.
export default function SearchModal({ contents, index, initialQuery = '', maxResults = defaults.searchMaxResults, showMarkdownExtension = false, onOpen, onClose }) {
  const { t } = useI18n();
  const [query, setQuery] = useState(initialQuery);
  const [mode, setMode] = useState('text');
  const [semanticResults, setSemanticResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const resultList = useRef(null);
  const search = useMemo(() => createSearchEngine(contents, index), [contents, index]);
  useEffect(() => {
    ++requestId.current;
    setSemanticResults(null);
    setError('');
    return () => { ++requestId.current; };
  }, [query, mode, contents, index, maxResults]);

  const runSemantic = async () => {
    const text = parseQuery(query).text.replace(/"/g, '').trim();
    if (!text) { setError(t('Enter a description to search by meaning.')); return; }
    const documents = filterSearchDocuments(contents, index, query);
    if (!Object.keys(documents).length) { setSemanticResults([]); setError(''); return; }
    const id = ++requestId.current;
    setBusy(true);
    setError('');
    setSemanticResults(null);
    try {
      const results = await window.api.semanticSearch({
        query: text, documents, maxResults: mode === 'hybrid' ? HYBRID_CANDIDATE_LIMIT : maxResults,
      });
      if (id === requestId.current) setSemanticResults(results);
    } catch (e) {
      if (id === requestId.current) setError([
        mode === 'hybrid' ? t('Hybrid search failed; showing keyword results only.') : '',
        e.message, t('Download the model in Settings before searching.'),
      ].filter(Boolean).join(' '));
    } finally { setBusy(false); }
  };

  const results = useMemo(() => search(
    query, mode === 'hybrid' ? HYBRID_CANDIDATE_LIMIT : maxResults,
    { matchAll: mode !== 'hybrid' },
  ), [query, search, maxResults, mode]);

  const displayed = useMemo(() => {
    if (mode === 'text') return results;
    if (mode === 'hybrid') return mergeHybridResults(results, semanticResults || [], maxResults);
    return (semanticResults || []).map((r) => ({
      path: r.path, score: r.score, matches: [{ line: r.line, text: r.text }],
    }));
  }, [mode, results, semanticResults, maxResults]);
  const terms = parseQuery(query).terms;

  const openResult = (event, path, line) => {
    onOpen(path, event.ctrlKey || event.metaKey, line);
    onClose();
  };
  const navigate = (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = [...resultList.current.querySelectorAll('.search-file')];
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement);
    const next = current < 0 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1)
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
    buttons[next].scrollIntoView({ block: 'nearest' });
  };

  return (
    <ModalBackdrop onMouseDown={onClose}>
      <div className="modal search" role="dialog" aria-modal="true" aria-label={t('Search')}
        onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="palette-input"
          aria-label={t('Search')}
          placeholder={t('Search vault…  (try: tag:neg "political capital")')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            navigate(e);
            if (e.key === 'Escape') onClose();
            if (e.key === 'Enter' && mode !== 'text' && !busy) runSemantic();
            if (e.key === 'Enter' && mode === 'text' && displayed.length) {
              openResult(e, displayed[0].path, displayed[0].matches[0]?.line);
            }
          }}
        />
        <div className="search-options">
          <select aria-label={t('Search mode')} value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="text">{t('Full text')}</option>
            <option value="hybrid">{t('Hybrid (keywords + local meaning)')}</option>
            <option value="semantic">{t('Semantic (local embeddings)')}</option>
          </select>
          {mode !== 'text' && <button disabled={busy || !parseQuery(query).text.replace(/"/g, '').trim()} onClick={runSemantic}>
            {t(busy ? 'Indexing / searching locally...' : mode === 'hybrid' ? 'Search keywords + meaning' : 'Search by meaning')}
          </button>}
        </div>
        {mode === 'semantic' && <div className="search-count">
          {t('Ranks the closest matching passage in each note. Supports tag: filters; scores are similarity, not confidence.')}
        </div>}
        {mode === 'hybrid' && <div className="search-count" role="status">
          {t(semanticResults === null
            ? 'Keyword results shown. Run hybrid search to include local semantic matches.'
            : 'Combines keyword and semantic rankings. Tags and quoted phrases remain required.')}
        </div>}
        {error && <div className="search-error" role="alert">{error}</div>}
        <div className="search-count" aria-live="polite">
          {query.trim() ? t('{count} file(s)', { count: displayed.length }) : ''}
          {displayed.some((result) => result.approximate) && ` — ${t('No exact matches. Showing close spelling matches.')}`}
        </div>
        <div className="search-count">{t('Arrow keys to choose a file; Enter to open. Quoted phrases match exactly.')}</div>
        {query.trim() && !displayed.length && !busy && (mode === 'text' || semanticResults !== null) &&
          <div className="search-count">{t('No matching notes. Try fewer words or remove a tag or quoted phrase.')}</div>}
        <div className="search-results" ref={resultList} onKeyDown={navigate}>
          {displayed.map((r) => (
            <div key={r.path} className="search-result">
              <button
                type="button"
                className="search-file"
                onClick={(e) => openResult(e, r.path, r.matches[0]?.line)}
              >
                {displayName(r.path, true, showMarkdownExtension)} <span className="palette-detail">{r.path}</span>
                {r.sources && <span className="palette-detail"> — {t(r.sources.length === 2
                  ? 'Keyword + semantic' : r.sources[0] === 'keyword' ? 'Keyword match' : 'Semantic match')}</span>}
                {r.score != null && <span className="search-score"> ({t('similarity')} {r.score.toFixed(3)})</span>}
              </button>
              {r.matches.map((m) => (
                <button
                  type="button"
                  key={m.line}
                  className="search-line"
                  onClick={(e) => openResult(e, r.path, m.line)}
                >
                  {searchExcerpt(m.text.trim(), r.matchedTerms || terms).map((part, i) =>
                    part.match ? <mark key={i}>{part.text}</mark> : part.text)}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </ModalBackdrop>
  );
}
