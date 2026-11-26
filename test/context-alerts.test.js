// Context thresholds (server/lib/features/sessions/context-thresholds.js): each time a session's context fills past
// 50%, 75% or 90% of its window, with the step that pushed it over. Run with `node --test test/context-alerts.test.js`.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { noteContextThresholds } = require('../server/lib/features/sessions/context-thresholds');

const WINDOW = 200000;
let seq = 0;
// a main-agent step that leaves the context at this many tokens
function step(session, tokens, model = session.model) {
  const ts = new Date(Date.now() + seq * 1000).toISOString();
  const window = session.agent === 'codex' ? WINDOW : (tokens > WINDOW || /\[1m]/.test(model) ? 1000000 : WINDOW); // as transcript-steps.js guesses
  session.context = { tokens, window, pct: Math.min(1, tokens / window), ts, model };
  noteContextThresholds(session, { seq: ++seq, ts });
  return seq;
}
const crossingsOf = session => session.contextCrossings.map(crossing => [crossing.threshold, crossing.change]);
// a Claude Code session whose status line reported its 200k window
const known = () => ({ agent: 'claude', model: 'claude-test', observedContext: { model: 'claude-test', window: WINDOW }, contextCrossings: [] });

test('each threshold is noted once, with the step that crossed it and its jump', () => {
  const session = known();
  step(session, 40000);
  const crossedHalf = step(session, 110000);
  step(session, 120000);
  assert.deepEqual(crossingsOf(session), [[0.5, 70000]]);
  assert.equal(session.contextCrossings[0].seq, crossedHalf);
  assert.equal(session.contextCrossings[0].tokens, 110000);
});

test('a jump past two thresholds notes only the higher one', () => {
  const session = known();
  step(session, 20000);
  step(session, 160000);
  assert.deepEqual(crossingsOf(session), [[0.75, 140000]]);
});

test('a compaction arms the thresholds again', () => {
  const session = known();
  step(session, 185000);
  step(session, 30000); // compacted
  step(session, 105000);
  assert.deepEqual(crossingsOf(session), [[0.9, null], [0.5, 75000]]);
});


test('a guessed window does not alert: a 1M model guessed at 200k would cross for nothing', () => {
  const session = { agent: 'claude', model: 'claude-sonnet-5-5', observedContext: null, contextCrossings: [] };
  step(session, 30000);
  step(session, 150000);
  step(session, 211000);
  assert.deepEqual(crossingsOf(session), []);
});

test('a known window: the status line\'s, a model named 1M, or Codex\'s own', () => {
  const observedMillion = { agent: 'claude', model: 'claude-test', observedContext: { model: 'claude-test', window: 1000000 }, contextCrossings: [] };
  step(observedMillion, 150000);
  step(observedMillion, 520000);
  assert.deepEqual(crossingsOf(observedMillion), [[0.5, 370000]], 'measured against the 1M the status line reported');
  const namedMillion = { agent: 'claude', model: 'claude-test[1m]', observedContext: null, contextCrossings: [] };
  step(namedMillion, 760000);
  assert.deepEqual(crossingsOf(namedMillion), [[0.75, null]]);
  const codex = { agent: 'codex', model: 'gpt-test', contextCrossings: [] };
  step(codex, 185000);
  assert.deepEqual(crossingsOf(codex), [[0.9, null]]);
});
