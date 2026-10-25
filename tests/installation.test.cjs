const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { uninstallApplication } = require('../electron/uninstall.cjs');

function harness() {
  const calls = [];
  const app = {
    isPackaged: true,
    getPath: (name) => name === 'exe'
      ? 'C:\\Program Files\\Tagline\\Tagline.exe'
      : 'C:\\Users\\user\\AppData\\Roaming\\Tagline',
  };
  const shell = { showItemInFolder: (file) => calls.push(['reveal', file]) };
  const spawnProcess = (command, args, options) => {
    calls.push(['spawn', command, args, options]);
    const child = new EventEmitter();
    child.unref = () => calls.push(['unref']);
    process.nextTick(() => child.emit('spawn'));
    return child;
  };
  return { calls, app, shell, spawnProcess };
}

test('Windows uninstall waits for app exit and removes profile only after successful uninstall', async () => {
  const state = harness();
  const result = await uninstallApplication({
    ...state,
    removeProfile: true,
    platform: 'win32',
    processId: 4321,
    fileSystem: { access: async () => {} },
    environment: {},
  });

  assert.deepEqual(result, { manual: false });
  const [, command, args, options] = state.calls.find(([kind]) => kind === 'spawn');
  assert.equal(command, 'powershell.exe');
  assert.ok(args.includes('-Command'));
  assert.match(args[args.indexOf('-Command') + 1], /Start-Process -FilePath.*-Wait/);
  assert.match(args[args.indexOf('-Command') + 1], /-not \(Test-Path/);
  assert.equal(options.env.TAGLINE_PARENT_PID, '4321');
  assert.equal(options.env.TAGLINE_REMOVE_PROFILE, '1');
  assert.equal(options.env.TAGLINE_PROFILE, state.app.getPath('userData'));
  assert.deepEqual(state.calls.some(([kind]) => kind === 'reveal'), false);
});

test('Windows uninstall reports a missing uninstaller without starting cleanup', async () => {
  const state = harness();
  await assert.rejects(uninstallApplication({
    ...state,
    removeProfile: false,
    platform: 'win32',
    fileSystem: { access: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } },
  }), /uninstaller could not be found/i);
  assert.equal(state.calls.some(([kind]) => kind === 'spawn'), false);
});

test('macOS reveals the app and schedules only profile removal when requested', async () => {
  const state = harness();
  state.app.getPath = (name) => name === 'exe'
    ? '/Applications/Tagline.app/Contents/MacOS/Tagline'
    : '/Users/user/Library/Application Support/Tagline';
  const result = await uninstallApplication({
    ...state,
    removeProfile: true,
    platform: 'darwin',
    processId: 987,
    environment: {},
  });

  assert.deepEqual(result, { manual: true });
  assert.deepEqual(state.calls.filter(([kind]) => kind === 'reveal'), [
    ['reveal', '/Applications/Tagline.app'],
  ]);
  const [, command, args] = state.calls.find(([kind]) => kind === 'spawn');
  assert.equal(command, 'sh');
  assert.equal(args[args.length - 1], state.app.getPath('userData'));
  assert.equal(args[args.length - 2], '1');
});

test('development builds and invalid choices cannot start uninstall', async () => {
  const state = harness();
  state.app.isPackaged = false;
  await assert.rejects(uninstallApplication({ ...state, removeProfile: false }), /packaged builds/i);
  state.app.isPackaged = true;
  await assert.rejects(uninstallApplication({ ...state, removeProfile: 'yes' }), /Invalid profile removal choice/);
  assert.equal(state.calls.length, 0);
});
