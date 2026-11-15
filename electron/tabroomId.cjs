const ORIGIN = 'https://www.tabroom.com';

function tournamentId(value) {
  let id = typeof value === 'number' ? String(value) : value;
  if (typeof id !== 'string' || id.length > 2048) {
    throw new Error('Enter a valid Tabroom tournament ID or URL.');
  }
  id = id.trim();
  if (!/^\d+$/.test(id)) {
    let url;
    try {
      url = new URL(id);
    } catch {
      throw new Error('Enter a valid Tabroom tournament ID or URL.');
    }
    if (
      url.origin !== ORIGIN ||
      url.username ||
      url.password ||
      url.searchParams.getAll('tourn_id').length !== 1
    ) {
      throw new Error('Use an https://www.tabroom.com URL with one tourn_id.');
    }
    id = url.searchParams.get('tourn_id');
  }
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) < 1) {
    throw new Error('Enter a valid Tabroom tournament ID.');
  }
  return String(Number(id));
}

module.exports = { ORIGIN, tournamentId };
