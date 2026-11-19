const test = require('node:test');
const assert = require('node:assert/strict');
const { waitFor, rendererWait } = require('./helpers/wait.cjs');

test('waitFor retries transient errors and returns the successful value', async () => {
  let calls = 0;
  assert.equal(
    await waitFor(
      () => {
        if (++calls === 1) {
          throw new Error('not ready');
        }
        return calls === 3 && 'ready';
      },
      { interval: 1 }
    ),
    'ready'
  );
  assert.equal(calls, 3);
});

test('waitFor retains the last error and diagnostics on timeout', async () => {
  const cause = new Error('renderer unavailable');
  await assert.rejects(
    waitFor(
      () => {
        throw cause;
      },
      {
        timeout: 5,
        interval: 1,
        message: 'not ready',
        details: () => '\ncontext',
      }
    ),
    (error) => error.message === 'not ready\ncontext' && error.cause === cause
  );
});

test('rendererWait reports the requested label', async () => {
  const wait = rendererWait(() => false, { timeout: 1 });
  await assert.rejects(wait('expression', 'element'), /Timed out: element/);
});
