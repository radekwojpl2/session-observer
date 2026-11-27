// The agents' own session files, read alongside their hook events. Hooks don't see everything (individual model
// calls, what the model wrote, a call refused at its prompt), so each agent's server hooks
// (features/agents/<agent>/server.js) name the files to read (sessionFiles) and turn each line into events
// (readSessionFileRow): Claude Code reads its transcripts, Codex its rollout file. An agent that reports its model
// requests in its own events (Codex) has them become ModelSteps right as they arrive (modelStepFrom).
// This file tails the files, reads them soon after each hook event, and pushes what they add to the open pages.
'use strict';
const { FileTail } = require('../../building-blocks/file-tail');
const { sessions, ingest, sessionSummary } = require('./sessions');
const { broadcast, isBroadcasting } = require('../../building-blocks/live-updates');
const { noteContextThresholds } = require('./context-thresholds');
const { agentServer, allAgentServers } = require('../agents/registry');

const REMEMBERED_STEPS_MAX = 2000;    // recent ModelSteps kept by message id
const READ_DELAY_MS = 700;            // a burst of hook events triggers one read
const WAITING_READ_MS = 1500;         // while a session waits on you: no hook may come, so the file is read again
const WAITING_READ_IDLE_MAX_MS = 30 * 60000; // ...until neither a hook nor the file has shown anything for this long

const sessionFileTails = new Map();   // file → FileTail
const seenMessageIds = new Map();     // session id → Set(message id)
const stepByMessageId = new Map();    // message id → its ModelStep event, so later lines can add to it
const scheduledReads = new Map();     // session id → timer
const fileWrittenAt = new Map();      // session id → the newest line's timestamp read from its files (ms)

// the agent's hooks for its session files; null when it has none, or the session names no file
const sessionFileHooks = session => {
  const hooks = agentServer(session.agent);
  return session.transcript_path && hooks?.sessionFiles && hooks?.readSessionFileRow ? hooks : null;
};

// takes an event into its session and, unless it came from a session file itself, reads the files soon after.
// An agent that reports its model requests (Codex) has one become a ModelStep right here instead.
function ingestEvent(event) {
  const own = agentServer(event.agent);
  own?.noteEvent?.(event);
  if (event.event === 'SubagentStart' && !event.synthetic && isBroadcasting()) readBeforeSubagentStart(event);
  const isOwnStep = !!own?.modelStepFrom?.(event);
  const session = ingest(event);
  if (isOwnStep) {
    own.addStepUsage(session, event);
    if (!event.data.subagent && event.data.tokens.context) noteContextThresholds(session, event);
    if (event.data.msg_id) rememberStep(event.data.msg_id, event);
  }
  if (!event.synthetic && sessionFileHooks(session)) scheduleTranscriptRead(session);
  return session;
}

// a subagent call refused at its prompt shows only in the session file, which is read late: for an agent that says so
// (Claude Code), a SubagentStart reads it first, so a refused call is out of the queue before the new subagent takes
// its description (subagent-list.js). (Live only: the start-up load reads every file once, after the log.)
function readBeforeSubagentStart(event) {
  const session = sessions.get(event.session_id);
  if (!session || !sessionFileHooks(session)?.readBeforeSubagentStart || !session.subagentDescriptionsWaiting.length) return;
  try { readTranscripts(session); } catch { /* ignore */ }
}

function scheduleTranscriptRead(session, delay = READ_DELAY_MS) {
  if (scheduledReads.has(session.id)) return;
  scheduledReads.set(session.id, setTimeout(() => {
    scheduledReads.delete(session.id);
    try { readTranscripts(session); } catch { /* ignore */ }
  }, delay));
}

function cancelScheduledReads() {
  for (const timer of scheduledReads.values()) clearTimeout(timer);
  scheduledReads.clear();
}

function tailOf(file) {
  let tail = sessionFileTails.get(file);
  if (!tail) {
    tail = new FileTail(file);
    sessionFileTails.set(file, tail);
  }
  return tail;
}

function seenIdsOf(sessionId) {
  let seen = seenMessageIds.get(sessionId);
  if (!seen) {
    seen = new Set();
    seenMessageIds.set(sessionId, seen);
  }
  return seen;
}

function rememberStep(messageId, step) {
  stepByMessageId.set(messageId, step);
  if (stepByMessageId.size > REMEMBERED_STEPS_MAX) stepByMessageId.delete(stepByMessageId.keys().next().value);
}

// a later line of a response we already have: tool calls usually arrive here, so add them to its ModelStep and send
// that step again (same seq: the dashboard updates it in place)
function addLateToolCalls(messageId, toolCalls, fresh) {
  const step = stepByMessageId.get(messageId);
  if (!step) return;
  const knownIds = step.data.tool_ids;
  const newCalls = toolCalls.filter(call => !knownIds.includes(call.id));
  if (!newCalls.length) return;
  for (const call of newCalls) {
    step.data.tools.push(call.name);
    knownIds.push(call.id);
  }
  fresh.push(step);
}

function ingestAll(events, fresh) {
  for (const event of events) {
    ingestEvent(event);
    fresh.push(event);
  }
}

// what an agent's readSessionFileRow gets to work with: the message ids already read, the events to push, and ways
// to take events in and find or update an earlier step
function readerFor(session, fresh) {
  return {
    seen: seenIdsOf(session.id),
    fresh,
    ingestEvent,
    ingestAll: events => ingestAll(events, fresh),
    rememberStep,
    stepOf: messageId => stepByMessageId.get(messageId),
    addLateToolCalls: (messageId, toolCalls) => addLateToolCalls(messageId, toolCalls, fresh),
  };
}

// (the line's own time, not the time it was read: a restart reads old files again, and they are no sign of life)
function noteFileTime(session, row) {
  const writtenAt = Date.parse(row?.timestamp);
  if (writtenAt > (fileWrittenAt.get(session.id) || 0)) fileWrittenAt.set(session.id, writtenAt);
}

// what a read can change in a session without making an event: its waits, and the subagent calls waiting
const summaryShape = session => JSON.stringify([session.needsYou, session.busy, session.subagentDescriptionsWaiting.length]);

function readTranscripts(session) {
  const hooks = sessionFileHooks(session);
  if (!hooks) return;
  const fresh = []; // events to push to the open pages
  const read = readerFor(session, fresh);
  const before = summaryShape(session);
  for (const { file, isSubagent } of hooks.sessionFiles(session)) {
    for (const line of tailOf(file).readNewLines()) {
      if (!line) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      noteFileTime(session, row);
      hooks.readSessionFileRow(session, row, isSubagent, read);
    }
  }
  for (const event of fresh) broadcast('event', event);
  // (a waiting session is read every 1.5s, mostly to find nothing: the pages hear only of a change)
  if (fresh.length || summaryShape(session) !== before) broadcast('session', sessionSummary(session));
  scheduleReread(session);
}

// a call refused at its prompt sends no hook: the file is read again while the session waits on you, until it has
// gone quiet (a session closed while it waits sends nothing more, and must not be read forever)
function scheduleReread(session) {
  if (session.ended || !session.needsYou.length) return;
  const lastSign = Math.max(Date.parse(session.last) || 0, fileWrittenAt.get(session.id) || 0);
  if (Date.now() - lastSign <= WAITING_READ_IDLE_MAX_MS) scheduleTranscriptRead(session, WAITING_READ_MS);
}

function resetTranscriptState() {
  seenMessageIds.clear();
  stepByMessageId.clear();
  sessionFileTails.clear();
  fileWrittenAt.clear();
  for (const hooks of allAgentServers()) hooks.reset?.();
}

function clearSessionState(sessionId, session) {
  const timer = scheduledReads.get(sessionId);
  if (timer) clearTimeout(timer);
  scheduledReads.delete(sessionId);
  seenMessageIds.delete(sessionId);
  for (const [id, step] of stepByMessageId) if (step.session_id === sessionId) stepByMessageId.delete(id);
  const hooks = session && sessionFileHooks(session);
  if (hooks) for (const { file } of hooks.sessionFiles(session)) sessionFileTails.delete(file);
  for (const each of allAgentServers()) each.clearSession?.(sessionId);
}

module.exports = {
  ingestEvent, scheduleTranscriptRead, cancelScheduledReads, readTranscripts, resetTranscriptState, clearSessionState,
};
