import { useEffect, useRef, useState } from 'react';
import { formatDuration } from '../lib/card.js';
import { remainingAt } from '../lib/countdown.js';
import { useI18n } from '../lib/i18n.js';
import { speechLike } from '../lib/voiceActivity.js';
import { playUiSound } from '../lib/uiSounds.js';
import TimerPresetDialog from './dialogs/TimerPresetDialog.jsx';

const ARM_GRACE_MS = 400;
const METER_FULL_SCALE = 0.3;

function micErrorMessage(error, t) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return t('Microphone access was denied. Allow it in system settings, then arm again.');
  }
  if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') {
    return t('No microphone was found. Connect one, then arm again.');
  }
  return t('Microphone unavailable: {error}', { error: error?.message ?? String(error) });
}

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
    start: (at = Date.now()) => {
      if (deadline.current === null && remaining > 0) {
        deadline.current = at + remaining * 1000;
        setRunning(true);
      }
    },
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
  timerAutoStartUseSpeechRecognition = false,
  timerFloatingWindow = false,
  recognitionLanguage = 'en',
  interactionSounds = false,
  onArmedChange,
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
  const [armed, setArmed] = useState(false);
  const [micStatus, setMicStatus] = useState('idle');
  const [threshold, setThreshold] = useState(4);
  const [micError, setMicError] = useState('');
  const [micIssue, setMicIssue] = useState(false);
  const [level, setLevel] = useState(0);
  const microphone = useRef(null);
  const thresholdValue = useRef(threshold);
  thresholdValue.current = threshold;
  const latest = useRef(null);
  latest.current = { main, aff, neg };

  const releaseMicrophone = () => {
    const session = microphone.current;
    microphone.current = null;
    if (!session) {
      return;
    }
    clearInterval(session.interval);
    if (session.recognition) {
      session.recognition.onresult = null;
      session.recognition.onspeechstart = null;
      session.recognition.onerror = null;
      session.recognition.onend = null;
      try {
        session.recognition.abort();
      } catch {}
    }
    session.stream?.getTracks().forEach((track) => track.stop());
    session.context?.close().catch(() => {});
  };
  const disarm = () => {
    releaseMicrophone();
    setArmed(false);
    setMicStatus('idle');
    setLevel(0);
  };
  useEffect(() => () => releaseMicrophone(), []);
  useEffect(() => {
    onArmedChange?.(armed);
  }, [armed, onArmedChange]);

  useEffect(() => {
    const active = armed || main.running || aff.running || neg.running;
    const remaining = aff.running ? aff.remaining : neg.running ? neg.remaining : main.remaining;
    const label = aff.running
      ? t('Aff prep')
      : neg.running
        ? t('Neg prep')
        : fmt?.speeches[speech]?.[0];
    window.api.setFloatingTimer?.(
      timerFloatingWindow && active && fmt
        ? {
            label: label || '',
            time: formatDuration(remaining),
            status: armed ? t('Armed') : t('Running'),
          }
        : null
    );
  }, [
    timerFloatingWindow,
    armed,
    main.running,
    main.remaining,
    aff.running,
    aff.remaining,
    neg.running,
    neg.remaining,
    fmt,
    speech,
    t,
  ]);
  useEffect(() => () => window.api.setFloatingTimer?.(null), []);

  const arm = async () => {
    if (microphone.current || latest.current.main.running || latest.current.main.remaining <= 0) {
      return;
    }
    setMicError('');
    setMicIssue(false);
    const session = {};
    microphone.current = session;
    setArmed(true);
    setMicStatus('requesting');

    const triggerStart = (offsetMs = 0) => {
      if (microphone.current !== session) {
        return;
      }
      disarm();
      latest.current.aff.stop();
      latest.current.neg.stop();
      latest.current.main.start(Date.now() - offsetMs);
    };

    try {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (timerAutoStartUseSpeechRecognition) {
        if (!SpeechRecognition) {
          throw Object.assign(new Error(t('Web Speech API is not available on this system.')), {
            name: 'NotSupportedError',
          });
        }
        const recognition = new SpeechRecognition();
        session.recognition = recognition;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        if (recognitionLanguage) {
          recognition.lang = recognitionLanguage;
        }
        const listeningSince = performance.now();
        let triggered = false;
        const heardSpeech = () => {
          if (triggered || microphone.current !== session) {
            return;
          }
          if (performance.now() - listeningSince < ARM_GRACE_MS) {
            return;
          }
          triggered = true;
          triggerStart(0);
        };
        recognition.onspeechstart = heardSpeech;
        recognition.onresult = (event) => {
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i]?.[0]?.transcript?.trim()) {
              heardSpeech();
              return;
            }
          }
        };
        recognition.onerror = (event) => {
          if (microphone.current !== session) {
            return;
          }
          const code = event?.error;
          // "no-speech" / "aborted" are normal while waiting; keep listening by restarting on end.
          if (
            code === 'not-allowed' ||
            code === 'service-not-allowed' ||
            code === 'audio-capture'
          ) {
            disarm();
            setMicIssue(true);
            setMicError(
              code === 'audio-capture'
                ? t('No microphone was found. Connect one, then arm again.')
                : t('Microphone access was denied. Allow it in system settings, then arm again.')
            );
          } else if (code && code !== 'no-speech' && code !== 'aborted') {
            setMicIssue(true);
            setMicError(t('Speech recognition error: {error}', { error: code }));
          }
        };
        recognition.onend = () => {
          if (microphone.current !== session || triggered) {
            return;
          }
          try {
            recognition.start();
          } catch {
            // ignore restart races while stopping
          }
        };
        recognition.start();
        if (microphone.current !== session) {
          return;
        }
        if (latest.current.main.running || latest.current.main.remaining <= 0) {
          disarm();
          return;
        }
        setMicStatus('listening');
        if (interactionSounds) {
          playUiSound('open');
        }
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (microphone.current !== session) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      session.stream = stream;
      session.context = new AudioContext();
      const analyser = session.context.createAnalyser();
      analyser.fftSize = 2048;
      session.context.createMediaStreamSource(stream).connect(analyser);
      await session.context.resume();
      if (microphone.current !== session) {
        return;
      }
      if (latest.current.main.running || latest.current.main.remaining <= 0) {
        disarm();
        return;
      }
      setMicStatus('listening');
      const listeningSince = performance.now();
      const waveform = new Float32Array(analyser.fftSize);
      const spectrum = new Float32Array(analyser.frequencyBinCount);
      let voicedSince = 0;
      let ambientRms = thresholdValue.current / 100;
      const sample = () => {
        if (microphone.current !== session) {
          return;
        }
        const now = performance.now();
        analyser.getFloatTimeDomainData(waveform);
        analyser.getFloatFrequencyData(spectrum);
        const rms = Math.sqrt(
          waveform.reduce((sum, value) => sum + value * value, 0) / waveform.length
        );
        setLevel(rms);
        if (now - listeningSince < ARM_GRACE_MS) {
          ambientRms = ambientRms * 0.85 + rms * 0.15;
          voicedSince = 0;
          return;
        }
        const floor = Math.max(thresholdValue.current / 100, ambientRms * 1.6);
        const voiced = speechLike(waveform, spectrum, session.context.sampleRate, floor);
        if (voiced) {
          voicedSince ||= now;
          if (now - voicedSince >= 650) {
            triggerStart(now - voicedSince);
            return;
          }
        } else {
          voicedSince = 0;
          // Track ambient/background level from non-speech frames to adapt to room noise.
          ambientRms = ambientRms * 0.97 + rms * 0.03;
        }
      };
      const track = stream.getAudioTracks()[0];
      track?.addEventListener('ended', () => {
        if (microphone.current === session) {
          disarm();
          setMicIssue(true);
          setMicError(t('Microphone disconnected or access was revoked.'));
        }
      });
      track?.addEventListener('mute', () => {
        if (microphone.current === session) {
          setMicIssue(true);
          setMicError(t('The system is muting the microphone. Check microphone settings.'));
        }
      });
      track?.addEventListener('unmute', () => {
        if (microphone.current === session) {
          setMicIssue(false);
          setMicError('');
        }
      });
      session.interval = setInterval(sample, 50);
      if (interactionSounds) {
        playUiSound('open');
      }
    } catch (error) {
      if (microphone.current === session) {
        disarm();
        setMicIssue(true);
        setMicError(micErrorMessage(error, t));
      }
    }
  };

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
    disarm();
    setSpeech(i);
    main.reset(Math.round(fmt.speeches[i][1] * 60));
  };

  const resetForFormat = (next) => {
    disarm();
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
    disarm();
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
            disarm();
            aff.stop();
            neg.stop();
            main.toggle();
          }}
        >
          {t(main.running ? 'Pause' : 'Start')}
        </button>
        <button
          disabled={!main.running && main.remaining === Math.round(fmt.speeches[speech][1] * 60)}
          onClick={() => {
            disarm();
            main.reset(Math.round(fmt.speeches[speech][1] * 60));
          }}
        >
          {t('Reset')}
        </button>
        <button onClick={() => speech < fmt.speeches.length - 1 && selectSpeech(speech + 1)}>
          {t('Next')}
        </button>
      </div>

      <div className='timer-auto-start'>
        <button
          type='button'
          disabled={!armed && (main.running || main.remaining <= 0)}
          onClick={armed ? disarm : arm}
          aria-pressed={armed}
        >
          {t(armed ? 'Cancel automatic start' : 'Arm automatic start')}
        </button>
        {!timerAutoStartUseSpeechRecognition && (
          <label>
            {t('Microphone volume threshold (%)')}
            <input
              type='number'
              min='1'
              max='30'
              value={threshold}
              disabled={armed}
              onChange={(event) =>
                setThreshold(Math.min(30, Math.max(1, Number(event.target.value) || 1)))
              }
            />
          </label>
        )}
        <p role='status'>
          {t(
            micStatus === 'requesting'
              ? 'Connecting to the microphone…'
              : micStatus === 'listening'
                ? timerAutoStartUseSpeechRecognition
                  ? 'Listening once for speech with Web Speech API; recognition may depend on system/browser services and background voices may still trigger.'
                  : 'Listening once for sustained speech; adapts to ambient noise, but background voices may still trigger.'
                : timerAutoStartUseSpeechRecognition
                  ? 'Automatic start listens only when armed (Web Speech API) and turns off after starting.'
                  : 'Automatic start listens only when armed and turns off after starting.'
          )}
        </p>
        {armed && micStatus === 'listening' && !timerAutoStartUseSpeechRecognition && (
          <div className='mic-meter'>
            <div
              role='meter'
              aria-label={t('Microphone input level')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(Math.min(1, level / METER_FULL_SCALE) * 100)}
              style={{
                position: 'relative',
                height: 8,
                background: 'var(--background-modifier-border, #8884)',
                borderRadius: 4,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${Math.min(1, level / METER_FULL_SCALE) * 100}%`,
                  height: '100%',
                  background:
                    level >= threshold / 100
                      ? 'var(--text-error, #d33)'
                      : 'var(--text-accent, #48f)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${Math.min(1, threshold / 100 / METER_FULL_SCALE) * 100}%`,
                  width: 2,
                  background: 'currentColor',
                }}
              />
            </div>
            <small>
              {level >= threshold / 100
                ? t('Above threshold: speaking will start the timer.')
                : level < threshold / 100 / 4
                  ? t('Too quiet: speak louder or lower the threshold.')
                  : t('Below threshold.')}
            </small>
          </div>
        )}
        {micError && <p role='alert'>{micError}</p>}
        {micIssue && (
          <button
            type='button'
            onClick={() =>
              Promise.resolve(window.api.openMicrophoneSettings?.())
                .then((opened) => {
                  if (opened === false) {
                    setMicError(
                      t('Open your system sound or privacy settings to allow the microphone.')
                    );
                  }
                })
                .catch((error) => setMicError(error.message))
            }
          >
            {t('Microphone settings')}
          </button>
        )}
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
