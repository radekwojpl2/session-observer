'use strict';
// Session Observer dashboard — context alerts: the times a session's context filled past 50%, 75% or 90% of its window
// that are new since the last look. The server keeps them (server/lib/features/sessions/context-thresholds.js), each
// with the model step that pushed the context over. The ones there at the first look, and old ones a load of older
// days brings in, are only recorded, so they do not alert.
const CONTEXT_ALERT_FRESH_MS = 10 * 60000;

let contextAlertsPrimed = false;
const seenCrossingKeys = new Set();
// (by time, not seq: a restarted server numbers the events again)
const crossingKey = (session, crossing) => `${session.id}|${crossing.threshold}|${crossing.ts}`;

// the crossings due now: [{ key, session, crossing }]
function newContextCrossings(sessions, now = Date.now()) {
  const due = [];
  for (const session of sessions) {
    for (const crossing of session.contextCrossings || []) {
      const key = crossingKey(session, crossing);
      if (seenCrossingKeys.has(key)) continue;
      seenCrossingKeys.add(key);
      if (now - Date.parse(crossing.ts) <= CONTEXT_ALERT_FRESH_MS) due.push({ key, session, crossing });
    }
  }
  if (!contextAlertsPrimed) {
    contextAlertsPrimed = true;
    return [];
  }
  return due;
}
