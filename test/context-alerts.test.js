// Context thresholds (server/lib/features/sessions/context-thresholds.js): each time a session's context fills past
// 50%, 75% or 90% of its window, with the step that pushed it over. Run with `node --test test/context-alerts.test.js`.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { noteContextThresholds } = require('../server/lib/features/sessions/context-thresholds');

const WINDOW = 200000;
let seq = 0;
// a main-agent step that leaves the context at this many tokens
function step(session, tokens) {
  const ts = new Date(Date.now() + seq * 1000).toISOString();
  session.context = { tokens, window: WINDOW, pct: tokens / WINDOW, ts };
  noteContextThresholds(session, { seq: ++seq, ts });
  return seq;
}
const crossingsOf = session => session.contextCrossings.map(crossing => [crossing.threshold, crossing.change]);

test('each threshold is noted once, with the step that crossed it and its jump', () => {
  const session = { contextCrossings: [] };
  step(session, 40000);
  const crossedHalf = step(session, 110000);
  step(session, 120000);
  assert.deepEqual(crossingsOf(session), [[0.5, 70000]]);
  assert.equal(session.contextCrossings[0].seq, crossedHalf);
  assert.equal(session.contextCrossings[0].tokens, 110000);
});

test('a jump past two thresholds notes only the higher one', () => {
  const session = { contextCrossings: [] };
  step(session, 20000);
  step(session, 160000);
  assert.deepEqual(crossingsOf(session), [[0.75, 140000]]);
});

test('a compaction arms the thresholds again', () => {
  const session = { contextCrossings: [] };
  step(session, 185000);
  step(session, 30000); // compacted
  step(session, 105000);
  assert.deepEqual(crossingsOf(session), [[0.9, null], [0.5, 75000]]);
});

