const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { registerTimerSound } = require('../electron/timerSound.cjs');

test('timer sound import validates audio, persists it in the profile, and supports clearing', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-timer-sound-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'bell.wav');
  const wav = Buffer.alloc(46);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(2, 40);
  wav.writeInt16LE(1200, 44);
  await fs.writeFile(source, wav);

  const handlers = new Map();
  let selected = { canceled: false, filePaths: [source] };
  const dialog = { showOpenDialog: async () => selected };
  registerTimerSound({
    app: { getPath: () => root },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    dialog,
    getWindow: () => null,
  });

  assert.equal(await handlers.get('timerSound:read')(), null);
  assert.deepEqual(await handlers.get('timerSound:import')(), { name: 'bell.wav' });
  assert.deepEqual(await handlers.get('timerSound:read')(), {
    name: 'bell.wav',
    data: `data:audio/wav;base64,${wav.toString('base64')}`,
  });

  selected = { canceled: true, filePaths: [] };
  assert.equal(await handlers.get('timerSound:import')(), null);
  assert.equal((await handlers.get('timerSound:read')()).name, 'bell.wav');

  await handlers.get('timerSound:clear')();
  assert.equal(await handlers.get('timerSound:read')(), null);
});

test('timer sound import rejects files whose extension does not match their audio data', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tagline-timer-sound-invalid-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'not-audio.wav');
  await fs.writeFile(source, 'not a WAV file');
  const handlers = new Map();
  registerTimerSound({
    app: { getPath: () => root },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [source] }) },
    getWindow: () => null,
  });

  await assert.rejects(handlers.get('timerSound:import')(), /not a valid audio file/);
});
