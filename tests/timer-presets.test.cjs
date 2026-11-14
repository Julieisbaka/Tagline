const { test } = require('node:test');
const assert = require('node:assert/strict');

test('timer presets copy and paste as JSON', async () => {
  const { presetFromJson, presetToJson } = await import('../src/lib/timerPresets.js');
  const preset = {
    label: 'Policy',
    prep: 3,
    speeches: [
      ['1AC', 8],
      ['1NC', 8],
    ],
  };
  assert.deepEqual(presetFromJson(presetToJson(preset)), preset);
  assert.throws(() => presetFromJson('not json'), /not valid/);
  assert.throws(() => presetFromJson('{}'), /missing/);
  assert.throws(
    () => presetFromJson(JSON.stringify({ name: 'X', prep: 1, speeches: [['A', 0]] })),
    /invalid speech/
  );
});
