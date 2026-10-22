import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.js';
import { filterSearchDocuments, HYBRID_CANDIDATE_LIMIT, mergeHybridResults, parseQuery, searchVault } from '../lib/search.js';
import { displayName } from '../lib/vault.js';
import defaults from '../lib/defaultSettings.json' with { type: 'json' };

// Keyword and local embedding search share tag and phrase constraints.
export default function SearchModal({ contents, index, initialQuery = '', maxResults = defaults.searchMaxResults, showMarkdownExtension = false, onOpen, onClose }) {
  const { t } = useI18n();
  const [query, setQuery] = useState(initialQuery);
  const [mode, setMode] = useState('text');
  const [semanticResults, setSemanticResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);
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

  const results = useMemo(() => searchVault(
    contents, index, query, mode === 'hybrid' ? HYBRID_CANDIDATE_LIMIT : maxResults,
    { matchAll: mode !== 'hybrid' },
  ), [query, contents, index, maxResults, mode]);

  const displayed = useMemo(() => {
    if (mode === 'text') return results;
    if (mode === 'hybrid') return mergeHybridResults(results, semanticResults || [], maxResults);
    return (semanticResults || []).map((r) => ({
      path: r.path, score: r.score, matches: [{ line: r.line, text: r.text }],
    }));
  }, [mode, results, semanticResults, maxResults]);
  const terms = query
    .replace(/tag:#?[\w/-]+/gi, '')
    .match(/"[^"]+"|\S+/g)
    ?.map((t) => t.replace(/"/g, ''))
    .filter(Boolean);

  const mark = (text) => {
    if (!terms?.length) return text;
    const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
    return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal search" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="palette-input"
          placeholder={t('Search vault…  (try: tag:neg "political capital")')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'Enter' && mode !== 'text' && !busy) runSemantic();
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
        <div className="search-count">{query.trim() ? t('{count} file(s)', { count: displayed.length }) : ''}</div>
        <div className="search-results">
          {displayed.map((r) => (
            <div key={r.path} className="search-result">
              <div
                className="search-file"
                onClick={(e) => {
                  onOpen(r.path, e.ctrlKey || e.metaKey);
                  onClose();
                }}
              >
                {displayName(r.path, true, showMarkdownExtension)} <span className="palette-detail">{r.path}</span>
                {r.sources && <span className="palette-detail"> — {t(r.sources.length === 2
                  ? 'Keyword + semantic' : r.sources[0] === 'keyword' ? 'Keyword match' : 'Semantic match')}</span>}
                {r.score != null && <span className="search-score"> ({t('similarity')} {r.score.toFixed(3)})</span>}
              </div>
              {r.matches.map((m) => (
                <div
                  key={m.line}
                  className="search-line"
                  onClick={(e) => {
                    onOpen(r.path, e.ctrlKey || e.metaKey, m.line);
                    onClose();
                  }}
                >
                  {mark(m.text.trim().slice(0, 200))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
