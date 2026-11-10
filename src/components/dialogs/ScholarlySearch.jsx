import { useEffect, useRef, useState } from 'react';
import { createCitation } from '../../lib/citation.js';
import { useI18n } from '../../lib/i18n.js';

export default function ScholarlySearch({ query, onCreateCard, onClose, searchButtonRef }) {
  const { t } = useI18n();
  const [results, setResults] = useState([]);
  const [draft, setDraft] = useState(null);
  const [tag, setTag] = useState('');
  const [quote, setQuote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const request = useRef(0);
  useEffect(() => {
    const currentRequest = request;
    currentRequest.current++;
    setResults([]);
    setDraft(null);
    setBusy(false);
    setError('');
    setSearched(false);
    return () => {
      currentRequest.current++;
    };
  }, [query]);
  const search = async () => {
    const id = ++request.current;
    setBusy(true);
    setError('');
    setDraft(null);
    try {
      const items = await window.api.searchScholarly(query);
      if (id === request.current) {
        setResults(items);
        setSearched(true);
      }
    } catch (e) {
      if (id === request.current) {
        setError(e.message);
      }
    } finally {
      if (id === request.current) {
        setBusy(false);
      }
    }
  };
  const save = async () => {
    setError('');
    try {
      if (!tag.trim() || !quote.trim()) {
        throw new Error(t('Enter a card tag and source excerpt.'));
      }
      const citation = createCitation(draft);
      const heading = tag.trim().replace(/\s+/g, ' ');
      const name =
        heading
          .replace(/[\\/:*?"<>|\x00-\x1f]/g, '-')
          .replace(/[. ]+$/g, '')
          .slice(0, 100) || 'Evidence card';
      setBusy(true);
      const path = await onCreateCard(
        `${name}.md`,
        `#### ${heading}\n\n${citation}\n\n${quote.trim()}\n`
      );
      if (!path) {
        throw new Error(t('Could not save the card. Please try again.'));
      }
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p className='search-count'>
        {t(
          'Search sends your query to Crossref. Results are scholarly metadata, not a direct JSTOR search. Full text may require access.'
        )}
      </p>
      <button
        ref={searchButtonRef}
        type='button'
        onClick={search}
        disabled={busy || !query.trim() || query.length > 300}
      >
        {t(busy ? 'Searching…' : 'Search Crossref')}
      </button>
      {error && (
        <p role='alert' className='search-error'>
          {error}
        </p>
      )}
      {searched && !results.length && <p role='status'>{t('No scholarly results found.')}</p>}
      {draft ? (
        <section>
          <h4>{t('Cut evidence card')}</h4>
          <p className='hint'>
            {t(
              'Review the citation and paste an excerpt from the source you have permission to use.'
            )}
          </p>
          {Object.entries({
            author: 'Author',
            year: 'Year',
            title: 'Title',
            publication: 'Publication',
            url: 'Article URL',
          }).map(([key, label]) => (
            <label key={key} className='setting-row'>
              <span>{t(label)}</span>
              <input
                value={draft[key]}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              />
            </label>
          ))}
          <label className='setting-row'>
            <span>{t('Card tag')}</span>
            <input maxLength={200} value={tag} onChange={(e) => setTag(e.target.value)} />
          </label>
          <label>
            {t('Source excerpt')}
            <textarea
              rows={7}
              maxLength={200000}
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
            />
          </label>
          <div className='dialog-buttons'>
            <button type='button' disabled={busy} onClick={() => setDraft(null)}>
              {t('Back to results')}
            </button>
            <button type='button' disabled={busy} onClick={save}>
              {t('Save card to vault')}
            </button>
          </div>
        </section>
      ) : (
        <div className='search-results'>
          {results.map((item, i) => (
            <div className='search-result' key={`${item.url}-${i}`}>
              <strong>{item.title}</strong>
              <p>{[item.author, item.year, item.publication].filter(Boolean).join(' — ')}</p>
              {item.url && (
                <a href={item.url} target='_blank' rel='noreferrer'>
                  {t('Open source')}
                </a>
              )}{' '}
              <button
                type='button'
                onClick={() => {
                  setDraft(item);
                  setTag(item.title);
                  setQuote('');
                }}
              >
                {t('Cut card')}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
