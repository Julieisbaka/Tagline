import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatDuration } from '../../lib/card.js';
import { useI18n } from '../../lib/i18n.js';
import ModalBackdrop from './ModalBackdrop.jsx';

function parseDuration(value) {
  const match = /^(\d{1,3}):([0-5]\d)$/.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export default function TimerPresetDialog({ initial, onSave, onClose }) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [prep, setPrep] = useState(formatDuration(initial.prep * 60));
  const [speeches, setSpeeches] = useState(() =>
    initial.speeches.map(([label, minutes]) => ({ label, duration: formatDuration(minutes * 60) }))
  );
  const addedSpeech = useRef(false);
  const lastSpeech = useRef(null);
  useEffect(() => {
    if (addedSpeech.current) {
      lastSpeech.current?.focus();
      addedSpeech.current = false;
    }
  }, [speeches.length]);
  const valid =
    name.trim() &&
    parseDuration(prep) !== null &&
    speeches.every((speech) => speech.label.trim() && parseDuration(speech.duration) > 0);

  const updateSpeech = (index, patch) =>
    setSpeeches((current) =>
      current.map((speech, i) => (i === index ? { ...speech, ...patch } : speech))
    );

  const save = (event) => {
    event.preventDefault();
    if (!valid) {
      return;
    }
    onSave({
      id: `custom-${crypto.randomUUID()}`,
      label: name.trim(),
      prep: parseDuration(prep) / 60,
      speeches: speeches.map((speech) => [
        speech.label.trim(),
        parseDuration(speech.duration) / 60,
      ]),
    });
  };

  return createPortal(
    <ModalBackdrop onMouseDown={onClose}>
      <form
        className='modal dialog timer-preset-dialog'
        role='dialog'
        aria-modal='true'
        aria-labelledby='timer-preset-title'
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={save}
      >
        <h3 id='timer-preset-title'>{t('Add timer preset')}</h3>
        <label className='timer-preset-field'>
          {t('Preset name')}
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className='timer-preset-field'>
          {t('Prep time (mm:ss)')}
          <input
            aria-describedby='timer-preset-help'
            value={prep}
            onChange={(event) => setPrep(event.target.value)}
          />
        </label>
        <p id='timer-preset-help'>{t('Enter times as minutes:seconds (for example, 8:00).')}</p>
        <div className='timer-preset-speech timer-preset-heading' aria-hidden='true'>
          <span>{t('Speeches')}</span>
          <span>{t('Time (mm:ss)')}</span>
          <span />
        </div>
        <div className='timer-preset-speeches'>
          {speeches.map((speech, index) => (
            <div className='timer-preset-speech' key={index}>
              <input
                ref={index === speeches.length - 1 ? lastSpeech : null}
                aria-label={t('Speech {number} name', { number: index + 1 })}
                placeholder={t('Speech name')}
                value={speech.label}
                onChange={(event) => updateSpeech(index, { label: event.target.value })}
              />
              <input
                aria-label={t('Speech {number} time (mm:ss)', { number: index + 1 })}
                aria-describedby='timer-preset-help'
                placeholder='0:00'
                value={speech.duration}
                onChange={(event) => updateSpeech(index, { duration: event.target.value })}
              />
              <button
                type='button'
                aria-label={t('Remove speech {number}', { number: index + 1 })}
                disabled={speeches.length === 1}
                onClick={() => setSpeeches((current) => current.filter((_, i) => i !== index))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          type='button'
          onClick={() => {
            addedSpeech.current = true;
            setSpeeches((current) => [...current, { label: '', duration: '' }]);
          }}
        >
          {t('Add speech')}
        </button>
        <div className='dialog-buttons'>
          <button type='button' onClick={onClose}>
            {t('Cancel')}
          </button>
          <button className='primary' type='submit' disabled={!valid}>
            {t('Save preset')}
          </button>
        </div>
      </form>
    </ModalBackdrop>,
    document.body
  );
}
