import { useMemo, useState } from 'react';
import { analyzeDelivery } from '../../lib/deliveryAnalytics.js';
import { useI18n } from '../../lib/i18n.js';
import ModalBackdrop from './ModalBackdrop.jsx';

export default function DeliveryAnalyticsDialog({ onClose }) {
  const { t } = useI18n();
  const [transcript, setTranscript] = useState('');
  const [seconds, setSeconds] = useState('');
  const duration = Number(seconds);
  const validDuration =
    !seconds || (Number.isFinite(duration) && duration > 0 && duration <= 86400);
  const result = useMemo(
    () => analyzeDelivery(transcript, validDuration && seconds ? duration : null),
    [transcript, validDuration, seconds, duration]
  );
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
            'Counts only common English hesitation tokens (um, uh, erm, er, umm, uhh). Transcription errors and meaningful uses can affect results.'
          )}
        </p>
        <div className='dialog-buttons'>
          <button onClick={onClose}>{t('Close')}</button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
