// Context alerts: the server keeps each time a session's context filled past a threshold
// (server/lib/features/sessions/context-thresholds.js), and the dashboard alerts for the new ones
// (server/dashboard/features/context-alerts/model.js, run in a vm). Run with `node --test test/context-alerts.test.js`.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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

function loadModel() {
  const file = path.join(__dirname, '..', 'server', 'dashboard', 'features', 'context-alerts', 'model.js');
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return (sessions, now) => Array.from(vm.runInContext('newContextCrossings', context)(sessions, now), due => `${due.session.id}:${due.crossing.threshold}`);
}
const crossing = (threshold, ts) => ({ threshold, ts, seq: 1, tokens: 1, window: 2, pct: 0.5 });

test('dashboard: the first look only records, then each new crossing alerts once', () => {
  const due = loadModel();
  const now = Date.parse('2026-01-01T01:00:00Z');
  assert.deepEqual(due([{ id: 'a', contextCrossings: [crossing(0.5, '2026-01-01T00:59:00Z')] }], now), []);
  const session = { id: 'a', contextCrossings: [crossing(0.5, '2026-01-01T00:59:00Z'), crossing(0.75, '2026-01-01T00:59:30Z')] };
  assert.deepEqual(due([session], now), ['a:0.75']);
  assert.deepEqual(due([session], now), []);
});

test('dashboard: an old crossing (from a load of older days) does not alert', () => {
  const due = loadModel();
  const now = Date.parse('2026-01-01T01:00:00Z');
  due([], now);
  assert.deepEqual(due([{ id: 'old', contextCrossings: [crossing(0.9, '2026-01-01T00:10:00Z')] }], now), []);
});
