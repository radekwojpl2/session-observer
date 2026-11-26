#!/usr/bin/env node
// session-observer dashboard server. Zero dependencies.
// Tails ~/.claude/session-observer/sessions/<day>/*.jsonl, keeps sessions in memory, reads model steps and token usage from
// each session's transcript, serves the dashboard and pushes live updates over Server-Sent Events.
// The parts live in server/lib (building-blocks/ and features/); this file loads the log and starts listening.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { PORT, HOST, DATA_DIR, LOG_FILE, SESSION_LOG_DIR, DELETED_SESSIONS_FILE, LOAD_DAYS, TOKEN } = require('./lib/building-blocks/config');
const {
  MIGRATED_FIELD, sessionLogName, today, addDays, listDays, sessionFilesInDay, filesNamed, filesOfSession, readDeletedSessions, recordDeletedSession, isDeleted,
  migrateLegacyLog,
} = require('./lib/building-blocks/session-logs');
const { LOOPBACK_NAMES, WILDCARD_ADDRESSES } = require('./lib/features/web/request-guard');
const { FileTail } = require('./lib/building-blocks/file-tail');
const { sessions, sessionSummary } = require('./lib/features/sessions/sessions');
const { loadPins, setPin, clearPins, pinnedIds } = require('./lib/features/sessions/pins');
const { refreshObservedContexts, removeObservedContext, clearObservedContext } = require('./lib/features/sessions/observed-context');
const { broadcast, pingClients, startBroadcasting, withoutBroadcasting } = require('./lib/building-blocks/live-updates');
const transcripts = require('./lib/features/sessions/transcript-steps');
const { clearTranscriptRowsCache } = require('./lib/features/context/transcript-rows');
const { createRequestHandler } = require('./lib/features/web/routes');

const LOG_POLL_MS = 400;
const PING_MS = 15000;
const BUSY_TRANSCRIPT_POLL_MS = 2000;

// ---------- the event log ----------
// sessions/<day>/<session hash>.jsonl, in the folder of the day the session was last active: only the last LOAD_DAYS day
// folders are read at start, so every session active in those days, and older folders when the dashboard asks.
const ALL_DAYS = '0000-00-00';
const firstLoadedDay = () => (LOAD_DAYS ? addDays(today(), 1 - LOAD_DAYS) : ALL_DAYS);
const COPY_FIELDS = [MIGRATED_FIELD, '_session_observer_legacy_offset'];
const logTails = new Map(); // session file name → FileTail
const legacyTail = new FileTail(LOG_FILE);
let loadedFrom = firstLoadedDay();
let deletedSessions = new Map();
let lastReadError = '';

function parseEvent(line) {
  if (!line.trim()) return null;
  let event;
  try { event = JSON.parse(line); } catch { return null; }
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  for (const field of COPY_FIELDS) delete event[field];
  return event;
}

function readTail(tail, fresh) {
  for (const { line } of tail.readNewRecords()) {
    const event = parseEvent(line);
    if (!event) continue;
    fresh.push(event);
  }
}

// One session file: the hook moves it to the day the session was last active, so a known file found in a newer
// folder is the same bytes, and its tail keeps its offset. Should a session be split over days (the first two events of
// a new session, sent at once on both sides of midnight, each create a file), its earlier files are read first.
function readSessionFile(days, name, file, fresh) {
  let tail = logTails.get(name);
  if (!tail) {
    for (const earlier of filesNamed(SESSION_LOG_DIR, name, days)) if (earlier !== file) readTail(new FileTail(earlier), fresh);
    tail = new FileTail(file);
    logTails.set(name, tail);
  } else if (tail.file !== file) {
    if (fs.existsSync(tail.file)) { // split: finish the earlier file, then read the newer one from its start
      readTail(tail, fresh);
      tail = new FileTail(file);
      logTails.set(name, tail);
    } else {
      tail.file = file; // moved
    }
  }
  readTail(tail, fresh);
}

function readNewLogEvents(includeOlderPins = false) {
  const fresh = [];
  try {
    const days = listDays(SESSION_LOG_DIR);
    const newest = new Map(); // session file name → its path in the newest loaded day folder
    for (const day of days) {
      if (day < loadedFrom) continue;
      for (const name of sessionFilesInDay(SESSION_LOG_DIR, day)) newest.set(name, path.join(SESSION_LOG_DIR, day, name));
    }
    if (includeOlderPins) {
      for (const id of pinnedIds()) {
        const name = sessionLogName(id);
        if (newest.has(name)) continue;
        const file = filesNamed(SESSION_LOG_DIR, name, days).at(-1);
        if (file) newest.set(name, file);
      }
    }
    for (const [name, file] of newest) readSessionFile(days, name, file, fresh);
    // Older installed hooks may keep appending to the former combined log until their plugin is updated; the next
    // start moves those lines into the day folders.
    for (const { line } of legacyTail.readNewRecords()) {
      const event = parseEvent(line);
      if (!event || isDeleted(deletedSessions, event)) continue;
      fresh.push(event);
    }
    lastReadError = '';
  } catch (error) {
    // a polling error must not stop the server: report it once, and try again on the next tick
    const message = String(error?.message || error);
    if (message !== lastReadError) console.error('session-observer: reading the event log failed:', message);
    lastReadError = message;
  }
  // in time order: a session's lines imported from the former combined log can sit after its newer ones
  fresh.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
  for (const event of fresh) transcripts.ingestEvent(event);
  const touched = new Set();
  for (const event of fresh) {
    broadcast('event', event);
    const session = sessions.get(event.session_id);
    if (session) touched.add(session);
  }
  for (const session of touched) broadcast('session', sessionSummary(session));
  return fresh.length;
}

// what is loaded, and whether older days are left
function logHistory() {
  const older = listDays(SESSION_LOG_DIR).filter(day => day < loadedFrom);
  return { loadedFrom: loadedFrom === ALL_DAYS ? null : loadedFrom, olderDays: older.length, loadDays: LOAD_DAYS };
}

// the next LOAD_DAYS day folders (that exist) before the loaded ones
function loadOlderDays() {
  const older = listDays(SESSION_LOG_DIR).filter(day => day < loadedFrom);
  if (!older.length) return logHistory();
  readNewLogEvents(); // live events that came just before: these still go out one by one
  const known = new Set(sessions.keys());
  loadedFrom = LOAD_DAYS ? older[Math.max(0, older.length - LOAD_DAYS)] : ALL_DAYS;
  // The older days go out as one 'history' message, not event by event: each page then reloads its sessions and
  // the events of its scope and range once. (The reads other sessions have scheduled stay: a live Stop waits on one.)
  withoutBroadcasting(() => {
    readNewLogEvents();
    refreshObservedContexts(sessions.values());
    for (const session of sessions.values()) {
      if (known.has(session.id)) continue;
      try { transcripts.readTranscripts(session); } catch { /* ignore */ }
    }
  });
  broadcast('history', logHistory());
  return logHistory();
}

function clearLog() {
  clearPins();
  clearObservedContext();
  try { fs.writeFileSync(LOG_FILE, ''); } catch { /* ignore */ }
  let names = [];
  try { names = fs.readdirSync(SESSION_LOG_DIR); } catch { /* no sessions folder: nothing to remove */ }
  for (const name of names) {
    try { fs.rmSync(path.join(SESSION_LOG_DIR, name), { recursive: true, force: true }); } catch { /* ignore */ }
  }
  try { fs.writeFileSync(DELETED_SESSIONS_FILE, ''); } catch { /* ignore */ }
  // an interrupted import's leftovers, or the next start brings the cleared events back
  let dataNames = [];
  try { dataNames = fs.readdirSync(DATA_DIR); } catch { /* no data folder */ }
  for (const name of dataNames) {
    if (/^events[.][0-9]+[.]migrating$/.test(name)) try { fs.unlinkSync(path.join(DATA_DIR, name)); } catch { /* ignore */ }
  }
  deletedSessions = new Map();
  sessions.clear();
  transcripts.resetTranscriptState();
  clearTranscriptRowsCache();
  logTails.clear();
  legacyTail.reset();
  loadedFrom = firstLoadedDay();
}

function reloadAfterSessionDelete(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  readNewLogEvents(); // take in what was appended just before this delete, so it isn't read again afterwards
  setPin(sessionId, false);
  removeObservedContext(sessionId);
  for (const file of filesOfSession(SESSION_LOG_DIR, sessionId)) {
    try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  logTails.delete(sessionLogName(sessionId));
  // its lines in the former combined log are skipped when that log is imported
  recordDeletedSession(DELETED_SESSIONS_FILE, deletedSessions, sessionId);
  transcripts.clearSessionState(sessionId, session);
  clearTranscriptRowsCache(session);
  sessions.delete(sessionId);
  broadcast('session-deleted', { id: sessionId });
  return true;
}

// the log holds prompts, file contents and command output: readable by its owner only (no effect on Windows ACLs)
function protectDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(DATA_DIR, 0o700); } catch { /* ignore */ }
  try { fs.chmodSync(LOG_FILE, 0o600); } catch { /* not there yet */ }
  fs.mkdirSync(SESSION_LOG_DIR, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(SESSION_LOG_DIR, 0o700); } catch { /* ignore */ }
  deletedSessions = readDeletedSessions(DELETED_SESSIONS_FILE);
  migrateLegacyLog({ legacyFile: LOG_FILE, sessionDirectory: SESSION_LOG_DIR, deleted: deletedSessions });
}

// everything already in the log, then every transcript once, before any page is told about changes
function loadExistingEvents() {
  loadPins();
  readNewLogEvents(true);
  refreshObservedContexts(sessions.values());
  transcripts.cancelScheduledReads();
  for (const session of sessions.values()) {
    try { transcripts.readTranscripts(session); } catch { /* ignore */ }
  }
  startBroadcasting();
}

// live sessions: keep picking up model steps even between hook events
function pollBusyTranscripts() {
  for (const session of refreshObservedContexts(sessions.values())) broadcast('session', sessionSummary(session));
  for (const session of sessions.values()) {
    if (session.busy && session.transcript_path) transcripts.scheduleTranscriptRead(session, 0);
  }
}

function warnIfReachableFromOtherMachines() {
  if (LOOPBACK_NAMES.has(HOST.toLowerCase())) return;
  const where = WILDCARD_ADDRESSES.has(HOST) ? `every network interface (${HOST || '0.0.0.0'})` : HOST;
  console.warn(`Listening on ${where}:${PORT}, not only this machine.`);
  console.warn(TOKEN
    ? 'Other machines need OBSERVER_TOKEN; the token travels over plain HTTP, so use a trusted network.'
    : 'Other machines are refused until OBSERVER_TOKEN is set.');
}

// ---------- start ----------
const server = http.createServer(createRequestHandler({ clearLog, deleteSession: reloadAfterSessionDelete, logHistory, loadOlderDays }));
server.on('error', error => {
  if (error.code === 'EADDRINUSE') process.exit(0); // another instance already serves the dashboard
  console.error(error);
  process.exit(1);
});
// Only the instance that holds the port imports the former combined log and reads the day folders: a second start
// exits on EADDRINUSE before it moves any file another server is tailing.
server.listen(PORT, HOST, () => {
  protectDataDir();
  loadExistingEvents();
  setInterval(readNewLogEvents, LOG_POLL_MS);
  setInterval(pingClients, PING_MS);
  setInterval(pollBusyTranscripts, BUSY_TRANSCRIPT_POLL_MS);
  console.log(`Session Observer → http://localhost:${PORT}`);
  warnIfReachableFromOtherMachines();
});
