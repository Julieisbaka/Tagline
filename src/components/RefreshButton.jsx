import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n.js';
import { REFRESH_TURN_MS, refreshTurns } from '../lib/refreshAnimation.js';
import Icon from './Icon.jsx';

export default function RefreshButton({ onRefresh }) {
  const { t } = useI18n();
  const button = useRef(null);
  const animation = useRef(null);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => animation.current?.cancel(), []);
  const refresh = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    const icon = button.current.querySelector('svg');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const spin = motion.matches ? null : icon.animate([
      { transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' },
    ], { duration: REFRESH_TURN_MS, iterations: Infinity });
    animation.current = spin;
    const stopMotion = () => { if (motion.matches) spin?.cancel(); };
    motion.addEventListener('change', stopMotion);
    try { await onRefresh(); }
    catch (error) { window.dispatchEvent(new CustomEvent('app-error', { detail: error.message })); }
    finally {
      if (spin?.playState === 'running') {
        spin.effect.updateTiming({ iterations: refreshTurns(Number(spin.currentTime)) });
        try { await spin.finished; }
        catch (error) {
          if (error.name !== 'AbortError') window.dispatchEvent(new CustomEvent('app-error', { detail: error.message }));
        }
      }
      spin?.cancel();
      motion.removeEventListener('change', stopMotion);
      animation.current = null;
      running.current = false;
      setBusy(false);
    }
  };
  return <button ref={button} className="icon-btn" title={t('Refresh')} aria-label={t('Refresh')}
    aria-busy={busy} disabled={busy} onClick={refresh}><Icon name="refresh" /></button>;
}
