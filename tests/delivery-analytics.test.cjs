const { test } = require('node:test');
const assert = require('node:assert/strict');

test('delivery analytics counts conservative filler tokens and measured pace', async () => {
  const { analyzeDelivery } = await import('../src/lib/deliveryAnalytics.js');
  assert.deepEqual(analyzeDelivery('Um, this is, uh, important. Um!', 3), {
    words: 6,
    fillers: { um: 2, uh: 1 },
    fillerCount: 3,
    wpm: 120,
  });
  assert.equal(analyzeDelivery('Um umbrella uh-huh').fillerCount, 1);
  assert.deepEqual(analyzeDelivery('Like, um, so yeah. SO YEAH!').fillers, {
    like: 1,
    um: 1,
    'so yeah': 2,
  });
  assert.equal(analyzeDelivery('alike so yes yeah likeable').fillerCount, 0);
  assert.equal(analyzeDelivery('so. Yeah').fillerCount, 0);
  assert.equal(analyzeDelivery('so, yeah').fillers['so yeah'], 1);
  assert.equal(analyzeDelivery('One two').wpm, null);
  assert.equal(analyzeDelivery('', 3).wpm, null);
  assert.throws(() => analyzeDelivery('hello', 0), /Duration/);
  assert.throws(() => analyzeDelivery('hello', Infinity), /Duration/);
});
