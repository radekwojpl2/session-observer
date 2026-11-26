// Alerts (server/dashboard/features/alerts/model.js): which sessions newly need you, newly finished a turn, or newly
// filled their context past a threshold.
// Runs session-activity.js and the alerts model in a vm. Zero dependencies — run with `node --test test/alerts.test.js`.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD = path.join(__dirname, '..', 'server', 'dashboard');
const FILES = ['features/events/model/session-activity.js', 'features/alerts/model.js'].map(file => path.join(DASHBOARD, file));

function loadAlerts(mode) {
  const context = vm.createContext({
    storage: { get: () => mode, set: () => {} },
    SETTING_KEYS: { alerts: 'so.notify' },
  });
  for (const file of FILES) vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return (sessions, now) => Array.from(vm.runInContext('newAlerts', context)(sessions, now), alert => `${alert.session.id}:${alert.kind}`);
}

const now = () => new Date().toISOString();
const session = (id, fields = {}) => ({ id, last: now(), ended: null, busy: false, needsYou: [], ...fields });
const permission = since => ({ kind: 'permission', tool: 'Bash', since });

test('the first look only records: waits already open do not alert', () => {
  const alerts = loadAlerts('needsYou');
  assert.deepEqual(alerts([session('a', { needsYou: [permission('t1')] })]), []);
  assert.deepEqual(alerts([session('a', { needsYou: [permission('t1')] })]), []);
});

test('a new wait alerts once', () => {
  const alerts = loadAlerts('needsYou');
  alerts([session('a', { busy: true })]);
  assert.deepEqual(alerts([session('a', { busy: true, needsYou: [permission('t1')] })]), ['a:needsYou']);
  assert.deepEqual(alerts([session('a', { busy: true, needsYou: [permission('t1')] })]), []);
  // answered, then a second permission later
  alerts([session('a', { busy: true })]);
  assert.deepEqual(alerts([session('a', { busy: true, needsYou: [permission('t2')] })]), ['a:needsYou']);
});

test('a finished turn alerts only in "also when done" mode', () => {
  for (const [mode, expected] of [['needsYou', []], ['alsoDone', ['a:done']]]) {
    const alerts = loadAlerts(mode);
    alerts([session('a', { busy: true })]);
    assert.deepEqual(alerts([session('a')]), expected, mode);
  }
});

test('a turn that ends right after a wait still counts as done', () => {
  const alerts = loadAlerts('alsoDone');
  alerts([session('a', { busy: true })]);
  assert.deepEqual(alerts([session('a', { busy: true, needsYou: [permission('t1')] })]), ['a:needsYou']);
  assert.deepEqual(alerts([session('a')]), ['a:done']);
});

test('stale and ended sessions do not alert', () => {
  const alerts = loadAlerts('alsoDone');
  const old = new Date(Date.now() - 60 * 60000).toISOString();
  alerts([session('a', { busy: true }), session('b', { busy: true })]);
  assert.deepEqual(alerts([
    session('a', { last: old, needsYou: [permission('t1')] }),
    session('b', { ended: now() }),
  ]), []);
});

const crossing = (threshold, ts) => ({ threshold, ts, seq: 1, tokens: 1, window: 2, pct: 0.5 });
const atOne = Date.parse('2026-01-01T01:00:00Z');

test('a context crossing alerts once, in both modes, and not at the first look', () => {
  for (const mode of ['needsYou', 'alsoDone']) {
    const alerts = loadAlerts(mode);
    assert.deepEqual(alerts([session('a', { contextCrossings: [crossing(0.5, '2026-01-01T00:59:00Z')] })], atOne), [], mode);
    const crossed = session('a', { contextCrossings: [crossing(0.5, '2026-01-01T00:59:00Z'), crossing(0.75, '2026-01-01T00:59:30Z')] });
    assert.deepEqual(alerts([crossed], atOne), ['a:context'], mode);
    assert.deepEqual(alerts([crossed], atOne), [], mode);
  }
  assert.deepEqual(loadAlerts('off')([session('a')], atOne), []);
});

test('an old context crossing (from a load of older days) does not alert', () => {
  const alerts = loadAlerts('needsYou');
  alerts([], atOne);
  assert.deepEqual(alerts([session('old', { contextCrossings: [crossing(0.9, '2026-01-01T00:10:00Z')] })], atOne), []);
});
