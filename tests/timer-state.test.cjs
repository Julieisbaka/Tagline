const test = require('node:test');
const assert = require('node:assert/strict');

test('timer state restores only valid values for the active format', async () => {
  const { normalizeTimerState } = await import('../src/lib/timerState.js');
  const format = {
    prep: 8,
    speeches: [
      ['1AC', 8],
      ['1NC', 10],
    ],
  };

  assert.deepEqual(
    normalizeTimerState(
      {
        format: 'highschool',
        speech: 1,
        remaining: 321,
        affRemaining: 99,
        negRemaining: 0,
      },
      'highschool',
      format
    ),
    {
      format: 'highschool',
      speech: 1,
      remaining: 321,
      affRemaining: 99,
      negRemaining: 0,
    }
  );
  assert.deepEqual(
    normalizeTimerState(
      {
        format: 'college',
        speech: 1,
        remaining: 10,
        affRemaining: 10,
      },
      'highschool',
      format
    ),
    {
      format: 'highschool',
      speech: 0,
      remaining: 480,
      affRemaining: 480,
      negRemaining: 480,
    }
  );
});
