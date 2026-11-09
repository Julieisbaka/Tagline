/** Central UI feedback sounds. Disabled unless the interactionSounds setting is enabled. */
let enabled = false;
let context = null;

/**
 * Update whether UI sounds play.
 * @param {boolean} value - Whether sounds are enabled.
 * @returns {void}
 */
export function setUiSoundSettings(value) {
  enabled = !!value;
  if (!enabled) {
    context?.close().catch(() => {});
    context = null;
  }
}

/**
 * Play a short synthesized UI sound.
 * @param {'click'|'open'|'close'|'save'|'error'|'success'} kind - Sound kind.
 * @returns {void}
 */
export function playUiSound(kind) {
  if (!enabled) {return;}
  try {
    context ||= new AudioContext();
    if (context.state === 'suspended') {context.resume();}
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const config = {
      click: { frequency: 660, duration: 0.04, volume: 0.03 },
      open: { frequency: 520, duration: 0.07, volume: 0.04 },
      close: { frequency: 380, duration: 0.07, volume: 0.04 },
      save: { frequency: 740, duration: 0.06, volume: 0.04 },
      success: { frequency: 880, duration: 0.09, volume: 0.05 },
      error: { frequency: 220, duration: 0.12, volume: 0.05 },
    }[kind] || { frequency: 500, duration: 0.05, volume: 0.03 };
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(config.frequency, now);
    gain.gain.setValueAtTime(config.volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + config.duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + config.duration);
  } catch {
    // Audio is optional; ignore unavailable devices.
  }
}
