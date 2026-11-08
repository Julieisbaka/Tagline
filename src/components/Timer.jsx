import { useEffect, useRef, useState } from 'react';
import { formatDuration } from '../lib/card.js';
import { remainingAt } from '../lib/countdown.js';
import { useI18n } from '../lib/i18n.js';
import TimerPresetDialog from './dialogs/TimerPresetDialog.jsx';

export const FORMATS = {
  highschool: {
    label: 'High school policy (8-3-5)',
    prep: 8,
    speeches: [
      ['1AC', 8],
      ['CX', 3],
      ['1NC', 8],
      ['CX', 3],
      ['2AC', 8],
      ['CX', 3],
      ['2NC', 8],
      ['CX', 3],
      ['1NR', 5],
      ['1AR', 5],
      ['2NR', 5],
      ['2AR', 5],
    ],
  },
  college: {
    label: 'College policy (9-3-6)',
    prep: 10,
    speeches: [
      ['1AC', 9],
      ['CX', 3],
      ['1NC', 9],
      ['CX', 3],
      ['2AC', 9],
      ['CX', 3],
      ['2NC', 9],
      ['CX', 3],
      ['1NR', 6],
      ['1AR', 6],
      ['2NR', 6],
      ['2AR', 6],
    ],
  },
};

function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.8);
    osc.onended = () => ctx.close();
  } catch (error) {
    console.error('Timer sound failed:', error);
  }
}

// A countdown that keeps accurate time using wall-clock deltas.
function useCountdown(initial, onComplete) {
  const [remaining, setRemaining] = useState(initial);
  const [running, setRunning] = useState(false);
  const deadline = useRef(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!running) {
      return undefined;
    }
    const id = setInterval(() => {
      if (deadline.current === null) {
        return;
      }
      const next = remainingAt(deadline.current);
      setRemaining(next);
      if (next === 0) {
        deadline.current = null;
        setRunning(false);
        onCompleteRef.current();
      }
    }, 200);
    return () => clearInterval(id);
  }, [running]);

  return {
    remaining,
    running,
    toggle: () => {
      if (deadline.current !== null) {
        setRemaining(remainingAt(deadline.current));
        deadline.current = null;
        setRunning(false);
      } else if (remaining > 0) {
        deadline.current = Date.now() + remaining * 1000;
        setRunning(true);
      }
    },
    stop: () => {
      if (deadline.current !== null) {
        setRemaining(remainingAt(deadline.current));
      }
      deadline.current = null;
      setRunning(false);
    },
    reset: (v) => {
      setRunning(false);
      deadline.current = null;
      setRemaining(v);
    },
  };
}

export default function Timer({
  format,
  onFormatChange,
  presets = [],
  onAddPreset,
  timerSoundEnabled = false,
  timerSoundName = '',
}) {
  const { t } = useI18n();
  const customPresets = Array.isArray(presets)
    ? presets.filter(
        (preset) =>
          preset &&
          typeof preset.id === 'string' &&
          typeof preset.label === 'string' &&
          Number.isFinite(preset.prep) &&
          preset.prep >= 0 &&
          Array.isArray(preset.speeches) &&
          preset.speeches.length > 0 &&
          preset.speeches.every(
            (speech) =>
              Array.isArray(speech) &&
              typeof speech[0] === 'string' &&
              Number.isFinite(speech[1]) &&
              speech[1] > 0
          )
      )
    : [];
  const fmt = Object.hasOwn(FORMATS, format)
    ? FORMATS[format]
    : customPresets.find((preset) => preset.id === format);
  const [speech, setSpeech] = useState(0);
  const [addingPreset, setAddingPreset] = useState(false);
  const [timerSound, setTimerSound] = useState(null);
  const playEndSound = () => {
    if (!timerSoundEnabled) {
      beep();
      return;
    }
    if (!timerSound) {
      window.dispatchEvent(
        new CustomEvent('app-error', { detail: t('The custom timer sound is not available.') })
      );
      return;
    }
    const audio = new Audio(timerSound);
    audio
      .play()
      .catch((error) =>
        window.dispatchEvent(new CustomEvent('app-error', { detail: error.message }))
      );
  };
  const main = useCountdown(fmt ? Math.round(fmt.speeches[0][1] * 60) : 0, playEndSound);
  const aff = useCountdown(fmt ? Math.round(fmt.prep * 60) : 0, playEndSound);
  const neg = useCountdown(fmt ? Math.round(fmt.prep * 60) : 0, playEndSound);

  useEffect(() => {
    let active = true;
    setTimerSound(null);
    if (!timerSoundEnabled || !timerSoundName) {
      return undefined;
    }
    window.api
      .readTimerSound()
      .then((sound) => {
        if (!sound) {
          throw new Error(t('The saved timer sound is missing. Choose it again.'));
        }
        if (active) {
          setTimerSound(sound.data);
        }
      })
      .catch((error) => {
        if (active) {
          window.dispatchEvent(new CustomEvent('app-error', { detail: error.message }));
        }
      });
    return () => {
      active = false;
    };
  }, [timerSoundEnabled, timerSoundName, t]);

  const selectSpeech = (i) => {
    setSpeech(i);
    main.reset(Math.round(fmt.speeches[i][1] * 60));
  };

  const resetForFormat = (next) => {
    setSpeech(0);
    main.reset(Math.round(next.speeches[0][1] * 60));
    aff.reset(Math.round(next.prep * 60));
    neg.reset(Math.round(next.prep * 60));
  };

  const changeFormat = (f) => {
    if (f === '__add_preset__') {
      setAddingPreset(true);
      return;
    }
    const next = Object.hasOwn(FORMATS, f)
      ? FORMATS[f]
      : customPresets.find((preset) => preset.id === f);
    if (!next) {
      return;
    }
    onFormatChange(f);
    resetForFormat(next);
  };

  const startPrep = (which) => {
    main.stop();
    (which === 'aff' ? neg : aff).stop();
    (which === 'aff' ? aff : neg).toggle();
  };

  const low = main.remaining <= 30 && main.remaining > 0;
  const selector = (
    <select
      aria-label={t('Timer preset')}
      value={fmt ? format : ''}
      onChange={(e) => changeFormat(e.target.value)}
    >
      {!fmt && (
        <option value='' disabled>
          {t('Select a preset')}
        </option>
      )}
      {Object.entries(FORMATS).map(([key, value]) => (
        <option key={key} value={key}>
          {t(value.label)}
        </option>
      ))}
      {customPresets.map((preset) => (
        <option key={preset.id} value={preset.id}>
          {preset.label}
        </option>
      ))}
      <option value='__add_preset__'>{t('Add preset…')}</option>
    </select>
  );
  const dialog = addingPreset && (
    <TimerPresetDialog
      initial={fmt || FORMATS.highschool}
      onClose={() => setAddingPreset(false)}
      onSave={(preset) => {
        onAddPreset(preset);
        resetForFormat(preset);
        setAddingPreset(false);
      }}
    />
  );

  if (!fmt) {
    return (
      <div className='timer'>
        <p role='alert'>{t('Unsupported timer preset. Select a current preset.')}</p>
        {selector}
        {dialog}
      </div>
    );
  }

  return (
    <div className='timer'>
      {selector}
      {dialog}

      <div className='timer-speeches'>
        {fmt.speeches.map(([name], i) => (
          <button
            key={i}
            className={`speech-btn${i === speech ? ' active' : ''}`}
            onClick={() => selectSpeech(i)}
          >
            {name}
          </button>
        ))}
      </div>

      <div className={`timer-display${low ? ' low' : ''}${main.remaining === 0 ? ' done' : ''}`}>
        {formatDuration(main.remaining)}
      </div>
      <div className='timer-controls'>
        <button
          className='primary'
          onClick={() => {
            aff.stop();
            neg.stop();
            main.toggle();
          }}
        >
          {t(main.running ? 'Pause' : 'Start')}
        </button>
        <button
          disabled={!main.running && main.remaining === Math.round(fmt.speeches[speech][1] * 60)}
          onClick={() => main.reset(Math.round(fmt.speeches[speech][1] * 60))}
        >
          {t('Reset')}
        </button>
        <button onClick={() => speech < fmt.speeches.length - 1 && selectSpeech(speech + 1)}>
          {t('Next')}
        </button>
      </div>

      <h4>{t('Prep time')}</h4>
      <div className='prep-row'>
        {[
          ['aff', 'Aff', aff],
          ['neg', 'Neg', neg],
        ].map(([key, label, timer]) => (
          <div key={key} className={`prep-box side-${key}${timer.running ? ' running' : ''}`}>
            <div className='prep-label'>{t(label)}</div>
            <div className='prep-time'>{formatDuration(timer.remaining)}</div>
            <button onClick={() => startPrep(key)}>{t(timer.running ? 'Pause' : 'Start')}</button>
            <button
              className='link-btn'
              disabled={!timer.running && timer.remaining === Math.round(fmt.prep * 60)}
              onClick={() => timer.reset(Math.round(fmt.prep * 60))}
            >
              {t('reset')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
