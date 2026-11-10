/** Heuristic for sustained, audible speech-like sound; not speech recognition.
 *  Uses RMS gate + speech-band energy/shape checks to reject steady ambient noise
 *  and non-speech transients better than a plain level trigger. */
export function speechLike(waveform, spectrum, sampleRate, threshold) {
  if (!waveform.length || !spectrum.length) {
    return false;
  }
  const rms = Math.sqrt(waveform.reduce((sum, value) => sum + value * value, 0) / waveform.length);
  // Require signal clearly above the configured sensitivity floor to ignore room noise.
  if (rms < threshold * 1.15) {
    return false;
  }

  let total = 0;
  let speech = 0; // core speech band
  let low = 0; // rumble / handling noise
  let high = 0; // hiss / broadband noise
  let peak = 0;
  const speechPowers = [];
  for (let i = 1; i < spectrum.length; i++) {
    const power = 10 ** (spectrum[i] / 10);
    const frequency = (i * sampleRate) / waveform.length;
    total += power;
    if (frequency >= 85 && frequency <= 3400) {
      speech += power;
      peak = Math.max(peak, power);
      speechPowers.push(power);
    } else if (frequency < 85) {
      low += power;
    } else if (frequency > 4000) {
      high += power;
    }
  }
  if (total <= 0 || speech <= 0 || speechPowers.length < 4) {
    return false;
  }

  const speechRatio = speech / total;
  const lowRatio = low / total;
  const highRatio = high / total;
  const significant = speechPowers.filter((power) => power > peak * 0.02).length;
  const active = speechPowers.filter((power) => power > peak * 0.08).length;

  // Spectral flatness in speech band (geometric/arithmetic mean). Noise is flatter (~1),
  // speech has formant peaks and is less flat.
  let logSum = 0;
  let linSum = 0;
  for (const power of speechPowers) {
    const p = power + 1e-12;
    logSum += Math.log(p);
    linSum += p;
  }
  const n = speechPowers.length;
  const flatness = Math.exp(logSum / n) / (linSum / n);

  // Speech: most energy in speech band, not dominated by rumble/hiss, structured (not flat),
  // and spread across multiple speech frequencies rather than a single narrow tone/click.
  return (
    speechRatio >= 0.55 &&
    lowRatio <= 0.35 &&
    highRatio <= 0.3 &&
    flatness <= 0.6 &&
    significant >= 4 &&
    active >= 2
  );
}
