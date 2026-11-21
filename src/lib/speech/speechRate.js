/** Migrate the former word-rate proxy while preserving its estimated duration. */
export function speechRateFromSettings(settings) {
  if (Number.isFinite(settings.syllablesPerMinute) && settings.syllablesPerMinute > 0) {
    return settings.syllablesPerMinute;
  }
  if (Number.isFinite(settings.wpm) && settings.wpm > 0) {
    return settings.wpm * 1.5;
  }
  return 375;
}
