import { useMemo, useState } from 'react';
import { analyzeDelivery } from '../../lib/deliveryAnalytics.js';
import { useI18n } from '../../lib/i18n.js';
import ModalBackdrop from './ModalBackdrop.jsx';

export default function DeliveryAnalyticsDialog({ onClose, settings, updateSettings }) {
  const { t } = useI18n();
  const [transcript, setTranscript] = useState('');
  const [seconds, setSeconds] = useState('');
  const [season, setSeason] = useState('');
  const [speech, setSpeech] = useState('');
  const [date, setDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const [message, setMessage] = useState('');
  const [sameSpeech, setSameSpeech] = useState(false);
  const history = Array.isArray(settings.deliveryHistory) ? settings.deliveryHistory : [];
  const duration = Number(seconds);
  const validDuration =
    !seconds || (Number.isFinite(duration) && duration > 0 && duration <= 86400);
  const result = useMemo(
    () => analyzeDelivery(transcript, validDuration && seconds ? duration : null),
    [transcript, validDuration, seconds, duration]
  );
  const trend = history
    .filter(
      (entry) =>
        entry.season === season.trim() &&
        (!sameSpeech || entry.speech.toLowerCase() === speech.trim().toLowerCase())
    )
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  const save = () => {
    if (!season.trim() || !speech.trim() || !date || !result.words || !validDuration) {
      return;
    }
    if (history.length >= 1000) {
      setMessage(t('Delete a saved speech before adding another.'));
      return;
    }
    updateSettings({
      deliveryHistory: [
        ...history,
        {
          id: crypto.randomUUID(),
          season: season.trim(),
          speech: speech.trim(),
          date,
          words: result.words,
          fillerCount: result.fillerCount,
          fillers: result.fillers,
        },
      ],
    });
    setMessage(t('Speech statistics saved.'));
  };
  return (
    <ModalBackdrop onMouseDown={onClose}>
      <div
        className='modal dialog analysis-dialog'
        role='dialog'
        aria-modal='true'
        aria-labelledby='delivery-title'
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 id='delivery-title'>{t('Delivery analytics')}</h3>
        <p className='hint'>
          {t(
            'Paste a transcript and optionally enter its measured duration. Analysis stays on this device; no audio is recorded or transcribed.'
          )}
        </p>
        <div className='analysis-fields'>
          <label>
            {t('Transcript')}
            <textarea
              rows={10}
              maxLength={200000}
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
            />
          </label>
          <label>
            {t('Measured duration in seconds (optional)')}
            <input
              type='number'
              min='0.1'
              max='86400'
              step='any'
              value={seconds}
              onChange={(e) => setSeconds(e.target.value)}
              aria-invalid={!validDuration}
            />
          </label>
        </div>
        {!validDuration && (
          <p className='error-text' role='alert'>
            {t('Enter a duration greater than zero and at most 86,400 seconds.')}
          </p>
        )}
        <section aria-live='polite'>
          <p>{t('Words: {count}', { count: result.words })}</p>
          <p>
            {t('Filler words: {count}', { count: result.fillerCount })}
            {Object.entries(result.fillers).length > 0 &&
              ` (${Object.entries(result.fillers)
                .map(([word, count]) => `${word}: ${count}`)
                .join(', ')})`}
          </p>
          <p>
            {result.wpm === null
              ? t('Pace: enter a measured duration to calculate words per minute.')
              : t('Pace: {wpm} words per minute.', { wpm: result.wpm })}
          </p>
        </section>
        <p className='hint'>
          {t(
            'Counts English hesitation tokens, “like”, and “so yeah”. These are estimates: “like” may be meaningful, and transcription errors can affect results.'
          )}
        </p>
        <h4>{t('Season trend')}</h4>
        <p className='hint'>
          {t(
            'Save statistics for each practice speech. Transcripts are not saved; statistics stay in this app profile.'
          )}
        </p>
        <div className='analysis-fields'>
          <label>
            {t('Season')}
            <input
              maxLength={80}
              value={season}
              onChange={(e) => setSeason(e.target.value)}
              placeholder='2026–27'
            />
          </label>
          <label>
            {t('Speech')}
            <input
              maxLength={80}
              value={speech}
              onChange={(e) => setSpeech(e.target.value)}
              placeholder='1AC'
            />
          </label>
          <label>
            {t('Date')}
            <input type='date' value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <button
          type='button'
          disabled={!season.trim() || !speech.trim() || !date || !result.words || !validDuration}
          onClick={save}
        >
          {t('Save speech statistics')}
        </button>
        <label>
          <input
            type='checkbox'
            checked={sameSpeech}
            onChange={(e) => setSameSpeech(e.target.checked)}
          />{' '}
          {t('Show only the entered speech')}
        </label>
        {message && <p role='status'>{message}</p>}
        {trend.length > 0 && (
          <div>
            {trend.map((entry) => (
              <p key={entry.id}>
                {entry.date} — {entry.speech}: {entry.fillerCount} / {entry.words} {t('words')} (
                {((entry.fillerCount * 100) / entry.words).toFixed(1)} {t('per 100 words')}){' '}
                <button
                  type='button'
                  aria-label={t('Delete statistics for {speech} on {date}', {
                    speech: entry.speech,
                    date: entry.date,
                  })}
                  onClick={() =>
                    updateSettings({
                      deliveryHistory: history.filter((item) => item.id !== entry.id),
                    })
                  }
                >
                  {t('Delete')}
                </button>
              </p>
            ))}
          </div>
        )}
        <div className='dialog-buttons'>
          <button onClick={onClose}>{t('Close')}</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
