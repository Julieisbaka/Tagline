import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n.js';
import SettingRow from './SettingRow.jsx';

export default function TimerSoundSettings({ settings, update }) {
  const { t } = useI18n();
  const audio = useRef(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    if (!settings.timerSoundName) {
      audio.current = null;
      return undefined;
    }
    window.api.readTimerSound().then((sound) => {
      if (!sound) throw new Error(t('The saved timer sound is missing. Choose it again.'));
      if (active) {
        const player = new Audio(sound.data);
        player.preload = 'auto';
        audio.current = player;
      }
    }).catch((failure) => {
      if (active) setError(failure.message);
    });
    return () => {
      active = false;
      audio.current?.pause();
      audio.current = null;
    };
  }, [settings.timerSoundName, t]);

  const choose = async () => {
    setBusy(true);
    setError('');
    try {
      const sound = await window.api.importTimerSound();
      if (sound) update({ timerSoundName: sound.name, timerSoundEnabled: true });
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };

  const preview = () => {
    setError('');
    if (!audio.current) {
      setError(t('The timer sound is still loading. Try again in a moment.'));
      return;
    }
    audio.current.currentTime = 0;
    audio.current.play().catch((failure) => setError(failure.message));
  };

  const clear = async () => {
    setBusy(true);
    setError('');
    try {
      await window.api.clearTimerSound();
      audio.current?.pause();
      audio.current = null;
      update({ timerSoundName: '', timerSoundEnabled: false });
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };

  return <section className="timer-sound-settings">
    <h4>{t('Timer sound')}</h4>
    <p>{t('Choose a sound file to play when a speech or prep timer reaches zero. Without a custom sound, Tagline uses its built-in beep.')}</p>
    {settings.timerSoundName ? <>
      <p>{t('Custom sound: {name}', { name: settings.timerSoundName })}</p>
      <SettingRow label={t('Use custom timer sound')} description={t('Play your selected audio file instead of the built-in beep when a timer ends.')}>
        <input type="checkbox" data-setting="timerSoundEnabled" checked={!!settings.timerSoundEnabled}
          onChange={(event) => update({ timerSoundEnabled: event.target.checked })} />
      </SettingRow>
      <div className="settings-actions">
        <button disabled={busy} onClick={preview}>{t('Preview sound')}</button>
        <button disabled={busy} onClick={choose}>{t('Choose another sound')}</button>
        <button disabled={busy} onClick={clear}>{t('Use built-in beep')}</button>
      </div>
    </> : <button disabled={busy} onClick={choose}>{t('Choose timer sound file')}</button>}
    {error && <p className="error-text" role="alert">{error}</p>}
  </section>;
}
