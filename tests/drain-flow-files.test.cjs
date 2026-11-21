const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');

const loadDrainer = async () => {
  const { drainFlowFiles } = await import(
    pathToFileURL(path.join(root, 'src', 'lib', 'drainFlowFiles.js')).href
  );
  return drainFlowFiles;
};

test('a failed flow file is reported and the rest of the OS queue is drained', async () => {
  const drainFlowFiles = await loadDrainer();
  const queue = ['first.flow', 'broken.flow', 'last.flow'];
  const opened = [];
  const notices = [];
  let reads = 0;
  await drainFlowFiles({
    nextFlowFile: async () => {
      reads += 1;
      return queue.shift() ?? null;
    },
    openFlowFile: async (file) => {
      if (file === 'broken.flow') {
        throw new Error('bad flow');
      }
      opened.push(file);
      return { path: file };
    },
    onOpened: (result) => opened.push(`opened:${result.path}`),
    notify: (message) => notices.push(message),
  });
  assert.deepEqual(opened, ['first.flow', 'opened:first.flow', 'last.flow', 'opened:last.flow']);
  assert.deepEqual(notices, ['bad flow']);
  assert.equal(reads, 4, 'the queue must be read through to the empty slot');
});

test('a queue read failure is reported without leaving a rejected drain', async () => {
  const drainFlowFiles = await loadDrainer();
  const notices = [];
  await drainFlowFiles({
    nextFlowFile: async () => {
      throw new Error('queue unavailable');
    },
    openFlowFile: async () => {
      throw new Error('should not be called');
    },
    onOpened: () => {
      throw new Error('should not be called');
    },
    notify: (message) => notices.push(message),
  });
  assert.deepEqual(notices, ['queue unavailable']);
});

test('disposing stops the drain without reporting an error', async () => {
  const drainFlowFiles = await loadDrainer();
  let disposed = false;
  let reads = 0;
  const opened = [];
  const notices = [];
  await drainFlowFiles({
    nextFlowFile: async () => {
      reads += 1;
      return 'one.flow';
    },
    openFlowFile: async (file) => {
      disposed = true;
      return { path: file };
    },
    onOpened: (result) => {
      if (!disposed) {
        opened.push(result.path);
      }
    },
    notify: (message) => notices.push(message),
    isDisposed: () => disposed,
  });
  assert.deepEqual(opened, []);
  assert.deepEqual(notices, []);
  assert.equal(reads, 1, 'no further queue reads after disposal');
});
