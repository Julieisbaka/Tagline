const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { registerFloatingTimer } = require('../electron/floatingTimer.cjs');

test('floating timer is authorized, synchronized, and closed with its owner', () => {
  const ipc = new EventEmitter();
  const owner = new EventEmitter();
  owner.webContents = new EventEmitter();
  owner.getBounds = () => ({ x: 0, y: 0, width: 1000, height: 800 });
  const windows = [];
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.isLoading = () => this.loading;
      this.webContents.send = (...args) => {
        this.sent = args;
      };
      this.loading = true;
      windows.push(this);
    }
    loadFile() {}
    isDestroyed() {
      return !!this.destroyed;
    }
    destroy() {
      this.destroyed = true;
      this.emit('closed');
    }
    showInactive() {
      this.shown = true;
    }
    getBounds() {
      return { x: 5000, y: 5000, width: 220, height: 110 };
    }
  }
  const screen = {
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 800 } }),
  };
  registerFloatingTimer({
    ipcMain: ipc,
    BrowserWindow: Window,
    screen,
    getWindow: () => owner,
    assertModelSender: (event) => {
      if (!event.allowed) {
        throw Error('Unauthorized');
      }
    },
  });
  const state = { label: '1AC', time: '8:00', status: 'Armed' };
  ipc.emit('timer:overlay', {}, state);
  assert.equal(windows.length, 0);
  ipc.emit('timer:overlay', { allowed: true }, state);
  assert.equal(windows[0].options.alwaysOnTop, true);
  ipc.emit('timer:overlay', { allowed: true }, { ...state, time: '7:59' });
  windows[0].loading = false;
  windows[0].webContents.emit('did-finish-load');
  assert.equal(windows[0].sent[1].time, '7:59');
  assert.equal(windows[0].shown, true);
  windows[0].emit('moved');
  ipc.emit('timer:overlay', { allowed: true }, null);
  assert.equal(windows[0].destroyed, true);
  assert.equal(owner.listenerCount('closed'), 0);
  ipc.emit('timer:overlay', { allowed: true }, state);
  assert.equal(windows[1].options.x, 780);
  assert.equal(windows[1].options.y, 690);
  owner.emit('closed');
  assert.equal(windows[1].destroyed, true);
});
