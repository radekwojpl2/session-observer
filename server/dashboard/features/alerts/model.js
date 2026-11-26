'use strict';
// Session Observer dashboard — alerts: which sessions newly need you, newly finished a turn, or newly filled their context
// past 50%, 75% or 90% of its window, since the last look.
//   off      — no alerts
//   needsYou — a session starts waiting on you (a permission, a question, an MCP server asking), or its context fills
//              past a threshold
//   alsoDone — that, and a running turn ends (the session waits for your next prompt)
// The sessions seen at the first look are only recorded, so opening the page does not alert for old waits. A context
// crossing (kept by the server: server/lib/features/sessions/context-thresholds.js) alerts once, and only while it is
// recent, so a load of older days does not bring old ones back.
const ALERT_MODES = ['off', 'needsYou', 'alsoDone'];
const TURN_RUNNING = ['working', 'needsYou']; // a wait answered and a turn ended between two looks is still a finished turn
const CONTEXT_ALERT_FRESH_MS = 10 * 60000;

let alertMode = ALERT_MODES.includes(storage.get(SETTING_KEYS.alerts)) ? storage.get(SETTING_KEYS.alerts) : 'off';
let alertsPrimed = false;
let alertedWaitKeys = new Set();     // the waits already seen, so each one alerts once
const lastAlertActivity = new Map(); // session id → its activity at the last look
const alertedCrossingKeys = new Set(); // the context crossings already seen

const alertWaitKey = (session, wait) => [session.id, wait.kind, wait.tool || '', wait.agentId ?? '', wait.since || ''].join('|');
// (by time, not seq: a restarted server numbers the events again)
const alertCrossingKey = (session, crossing) => [session.id, crossing.threshold, crossing.ts].join('|');

// the context crossings of a session not seen before that are still recent
function freshContextCrossings(session, now) {
  const fresh = [];
  for (const crossing of session.contextCrossings || []) {
    const key = alertCrossingKey(session, crossing);
    if (alertedCrossingKeys.has(key)) continue;
    alertedCrossingKeys.add(key);
    if (now - Date.parse(crossing.ts) <= CONTEXT_ALERT_FRESH_MS) fresh.push(crossing);
  }
  return fresh;
}

// the alerts due now: [{ session, kind: 'needsYou', waits } | { session, kind: 'done' } | { session, kind: 'context', crossing }]
function newAlerts(sessions, now = Date.now()) {
  const due = [];
  const waitKeys = new Set();
  for (const session of sessions) {
    const activity = sessionActivity(session);
    const waits = waitsOf(session);
    const fresh = waits.filter(wait => !alertedWaitKeys.has(alertWaitKey(session, wait)));
    for (const wait of waits) waitKeys.add(alertWaitKey(session, wait));
    if (fresh.length) due.push({ session, kind: 'needsYou', waits: fresh });
    else if (TURN_RUNNING.includes(lastAlertActivity.get(session.id)) && activity === 'yourTurn') due.push({ session, kind: 'done' });
    lastAlertActivity.set(session.id, activity);
    for (const crossing of freshContextCrossings(session, now)) due.push({ session, kind: 'context', crossing });
  }
  // only the waits still open are kept, so the set stays small
  alertedWaitKeys = waitKeys;
  if (!alertsPrimed) {
    alertsPrimed = true;
    return [];
  }
  return due.filter(alert => alert.kind !== 'done' || alertMode === 'alsoDone');
}
