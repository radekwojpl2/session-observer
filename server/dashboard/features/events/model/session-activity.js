'use strict';
// Session Observer dashboard — what a session is doing now, shared by the sessions list, the header and Home:
//   needsYou — waiting on you: a permission, a question, an MCP server asking (the server tracks these)
//   working  — a turn is running
//   yourTurn — the turn is done and the session is still open: it waits for your next prompt
//   inactive — open, but nothing happened for a while
//   ended    — the session ended
const LIVE_SESSION_MS = 30 * 60000; // a session with an event this recent counts as live
const SESSION_ACTIVITY_ORDER = ['needsYou', 'working', 'yourTurn', 'inactive', 'ended']; // most urgent first

const waitsOf = session => (session.ended ? [] : session.needsYou || []);

function sessionActivity(session) {
  if (session.ended) return 'ended';
  if (waitsOf(session).length) return 'needsYou';
  if (session.busy) return 'working';
  return Date.now() - Date.parse(session.last) < LIVE_SESSION_MS ? 'yourTurn' : 'inactive';
}

// the sessions waiting on you, longest-waiting first
const sessionsNeedingYou = sessions => sessions
  .filter(session => sessionActivity(session) === 'needsYou')
  .sort((a, b) => (waitsOf(a)[0].since || '').localeCompare(waitsOf(b)[0].since || ''));

const byActivityThenRecent = (a, b) =>
  SESSION_ACTIVITY_ORDER.indexOf(sessionActivity(a)) - SESSION_ACTIVITY_ORDER.indexOf(sessionActivity(b))
  || (b.last || '').localeCompare(a.last || '');
