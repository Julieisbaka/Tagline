const { parentPort } = require('node:worker_threads');
const { normalizeSnapshot } = require('./tabroomData.cjs');
const { tournamentId } = require('./tabroomId.cjs');

const MAX_JSON = 32 * 1024 * 1024;
const PAGE_SIZE = 20000;

parentPort.once('message', ({ mode, input, id }) => {
  try {
    const bytes = Buffer.from(input);
    if (mode === 'file' && bytes.byteLength > MAX_JSON) {
      throw new Error('Tournament JSON must be a string no larger than 32 MiB.');
    }
    let data;
    try {
      data = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    } catch {
      throw new Error(
        mode === 'network'
          ? 'Tabroom did not return valid JSON. Check the tournament ID or sign in again.'
          : 'The JSON file is not valid JSON.'
      );
    }
    let tournament;
    if (mode === 'network') {
      if (!data || typeof data !== 'object' || Array.isArray(data) || String(data.id) !== id) {
        throw new Error('Tabroom returned unexpected tournament data.');
      }
      tournament = id;
    } else if (mode === 'file') {
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('This JSON does not contain a Tabroom tournament snapshot.');
      }
      if (!['categories', 'events', 'judges', 'schools'].some((key) => Array.isArray(data[key]))) {
        throw new Error('This JSON does not contain Tabroom tournament collections.');
      }
      try {
        tournament = tournamentId(data.id);
      } catch {
        throw new Error('This JSON does not contain a valid Tabroom tournament ID.');
      }
    } else {
      throw new Error('Invalid Tabroom worker request.');
    }

    const formatted = JSON.stringify(data, null, 2);
    const snapshot = normalizeSnapshot(data);
    const summary = {
      id: tournament,
      name: typeof data.name === 'string' ? data.name : '',
      start: typeof data.start === 'string' ? data.start : '',
      end: typeof data.end === 'string' ? data.end : '',
      bytes: bytes.byteLength,
      pages: Math.ceil(formatted.length / PAGE_SIZE),
      sections: Object.entries(data)
        .filter(([, item]) => Array.isArray(item))
        .map(([name, items]) => ({ name, count: items.length })),
      preview: formatted.slice(0, PAGE_SIZE),
      metadata: snapshot.metadata,
      warnings: snapshot.warnings,
      collections: Object.fromEntries(
        Object.entries(snapshot.collections).map(([kind, collection]) => [
          kind,
          { available: collection.available, count: collection.rows.length },
        ])
      ),
    };
    data = null;
    const result =
      mode === 'network' ? { summary, snapshot, formatted, raw: input } : { summary, snapshot };
    parentPort.postMessage(result, mode === 'network' ? [input] : []);
  } catch (error) {
    parentPort.postMessage({ error: error.message || 'Tabroom JSON processing failed.' });
  } finally {
    parentPort.close();
  }
});
