import { useEffect, useMemo, useRef, useState } from 'react';
import { baseName, isMarkdown } from '../lib/vault.js';
import { useI18n } from '../lib/i18n.js';
import { searchVault } from '../lib/search.js';

// Full-text search. Supports "tag:name" to filter by tag and quoted phrases.
export default function SearchModal({ contents, index, initialQuery = '', maxResults = 200, onOpen, onClose }) {
  const { t } = useI18n();
  const [query, setQuery] = useState(initialQuery);
  const [mode, setMode] = useState('text');
  const [semanticResults, setSemanticResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  useEffect(() => {
    ++requestId.current;
    setSemanticResults([]);
    setError('');
    return () => { ++requestId.current; };
  }, [query, mode, contents]);

  const runSemantic = async () => {
    const tagFilters = [...query.matchAll(/tag:#?([\w/-]+)/gi)].map((m) => m[1].toLowerCase());
    const text = query.replace(/tag:#?[\w/-]+/gi, '').replace(/"/g, '').trim();
    if (!text) { setError(t('Enter a description to search by meaning.')); return; }
    const documents = Object.fromEntries(Object.entries(contents).filter(([p]) =>
      isMarkdown(p) && tagFilters.every((tag) => (index.tags[tag] || []).includes(p))));
    const id = ++requestId.current;
    setBusy(true);
    setError('');
    try {
      const results = await window.api.semanticSearch({ query: text, documents, maxResults });
      if (id === requestId.current) setSemanticResults(results);
    } catch (e) {
      if (id === requestId.current) setError(`${e.message} ${t('Download the model in Settings before searching.')}`);
    } finally { setBusy(false); }
  };

  const results = useMemo(() => searchVault(contents, index, query, maxResults), [query, contents, index, maxResults]);

  const displayed = mode === 'text' ? results : semanticResults.map((r) => ({
    path: r.path, score: r.score, matches: [{ line: r.line, text: r.text }],
  }));
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
            if (e.key === 'Enter' && mode === 'semantic' && !busy) runSemantic();
          }}
        />
        <div className="search-options">
          <select aria-label={t('Search mode')} value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="text">{t('Full text')}</option>
            <option value="semantic">{t('Semantic (local embeddings)')}</option>
          </select>
          {mode === 'semantic' && <button disabled={busy || !query.trim()} onClick={runSemantic}>
            {t(busy ? 'Indexing / searching locally...' : 'Search by meaning')}
          </button>}
        </div>
        {mode === 'semantic' && <div className="search-count">
          {t('Ranks the closest matching passage in each note. Supports tag: filters; scores are similarity, not confidence.')}
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
                {baseName(r.path)} <span className="palette-detail">{r.path}</span>
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
