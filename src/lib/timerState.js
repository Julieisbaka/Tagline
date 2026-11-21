function remaining(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? Math.min(Math.round(value), fallback) : fallback;
}

export function normalizeTimerState(value, formatId, format) {
  const prep = Math.round((format?.prep ?? 0) * 60);
  const speeches = Array.isArray(format?.speeches) ? format.speeches : [];
  const saved = value && typeof value === 'object' && value.format === formatId ? value : {};
  const speech =
    Number.isInteger(saved.speech) && saved.speech >= 0 && saved.speech < speeches.length
      ? saved.speech
      : 0;
  const speechDuration = Math.round((speeches[speech]?.[1] ?? 0) * 60);

  return {
    format: formatId,
    speech,
    remaining: remaining(saved.remaining, speechDuration),
    affRemaining: remaining(saved.affRemaining, prep),
    negRemaining: remaining(saved.negRemaining, prep),
  };
}
