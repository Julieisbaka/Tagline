/** Heuristic for sustained, audible speech-band sound; not speech recognition. */
export function speechLike(waveform, spectrum, sampleRate, threshold) {
  const rms = Math.sqrt(waveform.reduce((sum, value) => sum + value * value, 0) / waveform.length);
  if (rms < threshold || !waveform.length) {
    return false;
  }
  let total = 0;
  let voice = 0;
  let peak = 0;
  const powers = [];
  for (let i = 1; i < spectrum.length; i++) {
    const power = 10 ** (spectrum[i] / 10);
    const frequency = (i * sampleRate) / waveform.length;
    total += power;
    if (frequency >= 100 && frequency <= 4000) {
      voice += power;
      peak = Math.max(peak, power);
      powers.push(power);
    }
  }
  return (
    total > 0 && voice / total >= 0.6 && powers.filter((power) => power > peak * 0.02).length >= 4
  );
}
