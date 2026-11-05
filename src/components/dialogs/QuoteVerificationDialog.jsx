import { useMemo, useState } from 'react';
import { detectCards } from '../../lib/cardDetection.js';
import { scanCards } from '../../lib/evidenceCheckup.js';
import { useI18n } from '../../lib/i18n.js';
import { cardQuote, verifyQuote } from '../../lib/quoteVerification.js';
import ModalBackdrop from './ModalBackdrop.jsx';

export default function QuoteVerificationDialog({ contents, onClose }) {
  const { t } = useI18n();
  const cards = useMemo(() => {
    const files = new Map();
    return scanCards(contents).map((card) => {
      if (!files.has(card.path)) {
        const text = String(contents[card.path] ?? '');
        files.set(card.path, {
          lines: text.split(/\r\n?|\n/),
          sections: new Map(detectCards(text).map((section) => [section.lineIndex, section])),
        });
      }
      const { lines, sections } = files.get(card.path);
      const section = sections.get(card.lineIndex);
      return {
        ...card,
        quote: cardQuote(
          lines.slice(card.lineIndex, section.endLineIndex).join('\n'),
          Boolean(card.citation)
        ),
      };
    });
  }, [contents]);
  const [selected, setSelected] = useState('');
  const [url, setUrl] = useState('');
  const [quote, setQuote] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const selectCard = (value) => {
    setSelected(value);
    const card = cards[Number(value)];
    setQuote(value === '' ? '' : card.quote);
    setUrl(value === '' ? '' : card.citation?.url || '');
    setResult(null);
    setError('');
  };
  const run = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const source = await window.api.fetchQuoteSource(url.trim());
      setResult({ ...source, ...verifyQuote(quote, source.text) });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const labels = {
    match: 'Words found in sequence; punctuation and case were ignored.',
    omission:
      'Possible truncation or omitted words: matching passages are separated or an ellipsis is present.',
    review:
      'Some words were not found in order. Possible paraphrase, alteration, or unavailable text; review manually.',
    unverified: 'No comparable words were found. Review manually.',
  };
  const highlighted = [];
  if (result) {
    let position = 0;
    for (const [index, range] of result.ranges.entries()) {
      highlighted.push(result.text.slice(position, range.start));
      highlighted.push(<mark key={index}>{result.text.slice(range.start, range.end)}</mark>);
      position = range.end;
    }
    highlighted.push(result.text.slice(position));
  }
  return (
    <ModalBackdrop onMouseDown={busy ? undefined : onClose}>
      <div
        className='modal dialog analysis-dialog'
        role='dialog'
        aria-modal='true'
        aria-labelledby='quote-title'
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 id='quote-title'>{t('Quote verification')}</h3>
        <p className='hint'>
          {t(
            'Select a card or paste its evidence, then review the quote and URL before fetching. The quote stays local; the source site receives a normal web request.'
          )}
        </p>
        <fieldset disabled={busy} className='analysis-fields'>
          <label>
            {t('Card')}
            <select value={selected} onChange={(e) => selectCard(e.target.value)}>
              <option value=''>{t('Paste evidence instead')}</option>
              {cards.map((card, index) => (
                <option key={`${card.path}:${card.lineIndex}`} value={index}>
                  {card.path} — {card.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('Source URL')}
            <input
              type='url'
              value={url}
              maxLength={2048}
              onChange={(e) => {
                setUrl(e.target.value);
                setResult(null);
              }}
            />
          </label>
          <label>
            {t('Evidence to compare')}
            <textarea
              rows={7}
              maxLength={20000}
              value={quote}
              onChange={(e) => {
                setQuote(e.target.value);
                setResult(null);
              }}
            />
          </label>
        </fieldset>
        <p className='hint'>
          {t(
            'Matches ignore punctuation and case. This cannot verify meaning, context, hidden text, or whether a quote was selectively shortened. Review the original source.'
          )}
        </p>
        <div className='dialog-buttons'>
          <button onClick={onClose} disabled={busy}>
            {t('Close')}
          </button>
          <button className='primary' disabled={busy || !url.trim() || !quote.trim()} onClick={run}>
            {t(busy ? 'Fetching source...' : 'Fetch and compare')}
          </button>
        </div>
        {error && (
          <p className='error-text' role='alert'>
            {error}
          </p>
        )}
        {result && (
          <section aria-live='polite'>
            <p>
              <strong>{t(labels[result.status])}</strong>
            </p>
            <p>
              {t('{matched} of {total} words matched.', {
                matched: result.matched,
                total: result.total,
              })}
            </p>
            {result.limited && (
              <p>
                {t('Comparison stopped at the work limit; review the remaining text manually.')}
              </p>
            )}
            <p className='hint'>{t('Fetched source: {url}', { url: result.url })}</p>
            <div
              className='quote-source'
              tabIndex={0}
              aria-label={t('Fetched source with matching words highlighted')}
            >
              {highlighted}
            </div>
          </section>
        )}
      </div>
    </ModalBackdrop>
  );
}
