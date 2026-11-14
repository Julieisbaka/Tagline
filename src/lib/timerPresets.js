export function presetToJson(preset) {
  return JSON.stringify({
    name: preset.label,
    prep: preset.prep,
    speeches: preset.speeches,
  });
}

export function presetFromJson(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Preset JSON is not valid.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Preset JSON must be an object.');
  }
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const prep = value.prep;
  if (
    !name ||
    !Number.isFinite(prep) ||
    prep < 0 ||
    !Array.isArray(value.speeches) ||
    value.speeches.length === 0
  ) {
    throw new Error('Preset JSON is missing a name, prep time, or speeches.');
  }
  const speeches = value.speeches.map((speech) => {
    if (
      !Array.isArray(speech) ||
      speech.length !== 2 ||
      typeof speech[0] !== 'string' ||
      !speech[0].trim() ||
      !Number.isFinite(speech[1]) ||
      speech[1] <= 0
    ) {
      throw new Error('Preset JSON contains an invalid speech.');
    }
    return [speech[0].trim(), speech[1]];
  });
  return { label: name, prep, speeches };
}
