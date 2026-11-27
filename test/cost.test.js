'use strict';
// What model steps cost (server/lib/features/cost): the price table, a step's estimate, the agent's own cost, and a
// prices.json in the data folder.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// a data folder of the test's own, with a prices.json in it, before the modules read the config
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-cost-'));
process.env.OBSERVER_DATA_DIR = dataDir;
fs.writeFileSync(path.join(dataDir, 'prices.json'), JSON.stringify({
  'deepseek-v4.1-flash': { input: 0.3, output: 1.2 },
  'claude-opus-5-5': { input: 1, output: 2, cache_read: 0.5 },
  'broken-model': { output: 3 },
}));
const { priceKey, estimateStepCost, BUILT_IN_PRICES } = require('../server/lib/features/cost/prices');
const { newSessionCost, addStepCost } = require('../server/lib/features/cost/step-cost');

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test('model ids are matched without provider prefixes, dates, versions or the 1M mark', () => {
  assert.equal(priceKey('claude-sonnet-4-20250514'), 'claude-sonnet-4');
  assert.equal(priceKey('us.anthropic.claude-haiku-4-5-20251001-v1:0'), 'claude-haiku-4-5');
  assert.equal(priceKey('claude-opus-4-6[1m]'), 'claude-opus-4-6');
  assert.equal(priceKey('openai/GPT-6-Luna'), 'gpt-6-luna');
  assert.equal(priceKey({ id: 'x' }), '');
});

test('a step is priced from its tokens: input, output, cache reads, and 5-minute and 1-hour cache writes', () => {
  // claude-sonnet-5-5: $2 input, $10 output, $0.10 cache read, $2.50 5-minute write, $4 1-hour write (per million)
  const tokens = { input: 1000000, output: 100000, cache_read: 2000000, cache_write: 300000, cache_write_1h: 200000 };
  near(estimateStepCost('claude-sonnet-5-5', tokens), 2 + 1 + 0.2 + 0.1 * 2.5 + 0.2 * 4);
  assert.equal(estimateStepCost('no-such-model', tokens), null);
});

test('a long prompt pays the long-context price', () => {
  // claude-haiku-5-5 over 100K prompt tokens: $0.50 input and $2.50 output, instead of $0.10 and $0.50
  near(estimateStepCost('claude-haiku-5-5', { input: 100000, output: 1000000 }), 0.01 + 0.5);
  near(estimateStepCost('claude-haiku-5-5', { input: 60000, cache_read: 50000, output: 1000000 }), 0.03 + 0.0025 + 2.5);
  // gpt-6-luna over 272K: $0.20 input instead of $0.10, and writing the cache costs nothing
  near(estimateStepCost('gpt-6-luna', { input: 300000, cache_write: 10000 }), 0.06);
});

test('prices.json adds models and replaces built-in ones; a missing cache price is the input price', () => {
  near(estimateStepCost('deepseek-v4.1-flash', { input: 1000000, cache_read: 1000000, output: 1000000 }), 0.3 + 0.3 + 1.2);
  near(estimateStepCost('claude-opus-5-5', { input: 1000000, cache_read: 1000000, cache_write: 1000000 }), 1 + 0.5 + 1);
  assert.equal(estimateStepCost('broken-model', { output: 1000000 }), null, 'a price without input is ignored');
  assert.equal(BUILT_IN_PRICES['claude-opus-5-5'].input, 4, 'the built-in table itself is unchanged');
});

test("a session adds up its steps: the agent's own cost first, an estimate otherwise, and counts what has no price", () => {
  const session = { model: 'claude-sonnet-5-5', cost: newSessionCost() };
  const steps = [
    { data: { model: 'gpt-6-luna', cost: 0.25, tokens: { input: 1 } } },          // OpenCode says what it cost
    { data: { tokens: { input: 1000000 } } },                                     // the session's model: $2
    { data: { model: 'mystery', tokens: { input: 10 } } },                        // no price
    { data: { model: '<synthetic>', tokens: { input: 0, output: 0 } } },          // no tokens: free
  ];
  for (const step of steps) addStepCost(session, step);
  assert.deepEqual(steps.map(step => step.cost_usd), [0.25, 2, null, 0]);
  near(session.cost.usd, 2.25);
  assert.deepEqual({ ...session.cost, usd: 0 }, { usd: 0, priced: 3, unpriced: 1, reported: 1 });
});
