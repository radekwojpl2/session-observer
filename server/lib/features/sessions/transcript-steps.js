// Model steps and token usage, read from each Claude Code session's transcript. An agent whose server hooks say
// otherwise (features/agents/<agent>/server.js, e.g. Codex) makes its steps from its own events, and reads its own
// session file for what the model wrote.
//
// Hooks don't see individual model calls, so each assistant API response in the transcript (and in the subagent
// transcripts) becomes a synthetic "ModelStep" event, and every block of text or thinking it wrote a "ModelText".
'use strict';
const fs = require('fs');
const path = require('path');
const { CONTEXT_WINDOW } = require('../../building-blocks/config');
const { FileTail } = require('../../building-blocks/file-tail');
const { sessions, ingest, sessionSummary } = require('./sessions');
const { endWaitsFromTranscript } = require('./needs-you');
const { dropSubagentCall } = require('./subagent-list');
const { broadcast, isBroadcasting } = require('../../building-blocks/live-updates');
const { noteContextThresholds } = require('./context-thresholds');
const { ONE_MILLION_WINDOW, contextTokensOf, hasOneMillionWindow } = require('../../building-blocks/token-usage');
const { agentServer, allAgentServers } = require('../agents/registry');

const MODEL_TEXT_MAX = 2000;          // characters kept of one text / thinking block
const REMEMBERED_STEPS_MAX = 2000;    // recent ModelSteps kept by message id
const READ_DELAY_MS = 700;            // a burst of hook events triggers one read
const WAITING_READ_MS = 1500;         // while a session waits on you: no hook may come, so the transcript is read again
const WAITING_READ_IDLE_MAX_MS = 30 * 60000; // ...until neither a hook nor the transcript has shown anything for this long
const INTERRUPTED = '[Request interrupted by user'; // the line Claude Code writes when you interrupt or refuse a call

const transcriptTails = new Map();    // transcript file → FileTail
const seenMessageIds = new Map();     // session id → Set(message id)
const stepByMessageId = new Map();    // message id → its ModelStep event, so later lines can add their tool calls
const scheduledReads = new Map();     // session id → timer
const transcriptWrittenAt = new Map(); // session id → the newest line's timestamp read from its transcripts (ms)

const readsTranscript = session => !!session.transcript_path;
// the agent reads its own session file (its server hooks), instead of as a Claude Code transcript
const readsOwnSessionFile = session => !!agentServer(session.agent)?.transcriptRowEvents;

// takes an event into its session and, unless it came from the transcript itself, reads the transcript soon after.
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
  if (!event.synthetic && readsTranscript(session)) scheduleTranscriptRead(session);
  return session;
}

// a subagent call refused at its prompt shows only in the transcript, which is read late: a SubagentStart reads it
// first, so a refused call is out of the queue before the new subagent takes its description (subagent-list.js).
// (Live only: the start-up load reads every transcript once, after the log.)
function readBeforeSubagentStart(event) {
  const session = sessions.get(event.session_id);
  if (!session || !readsTranscript(session) || readsOwnSessionFile(session) || !session.subagentDescriptionsWaiting.length) return;
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

// the folder a transcript keeps its subagents' transcripts in: <transcript>/subagents/
const subagentDirOf = transcriptPath =>
  path.join(path.dirname(transcriptPath), path.basename(transcriptPath, '.jsonl'), 'subagents');

function transcriptFilesOf(session) {
  const mainTranscript = session.transcript_path;
  const files = [{ file: mainTranscript, isSubagent: false }];
  if (agentServer(session.agent)?.readsSubagentTranscripts === false) return files; // (Codex keeps them in files of their own)
  const subagentDir = subagentDirOf(mainTranscript);
  try {
    for (const name of fs.readdirSync(subagentDir)) {
      if (name.endsWith('.jsonl')) files.push({ file: path.join(subagentDir, name), isSubagent: true });
    }
  } catch { /* no subagents */ }
  return files;
}

function tailOf(file) {
  let tail = transcriptTails.get(file);
  if (!tail) {
    tail = new FileTail(file);
    transcriptTails.set(file, tail);
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

const contentBlocks = message => (Array.isArray(message.content) ? message.content : []);

// the tool calls in one transcript line of a response: name, and the tool_use id the hooks report as tool_use_id
const toolCallsOf = message => contentBlocks(message)
  .filter(block => block && block.type === 'tool_use')
  .map(block => ({ name: block.name, id: block.id || null }));

const isSubagentRow = (row, isSubagentFile) => isSubagentFile || !!row.isSidechain;

// what the model wrote: one ModelText per finished text / thinking block (thinking is often stored empty)
function modelTextEvents(session, row, message, isSubagentFile) {
  const events = [];
  for (const block of contentBlocks(message)) {
    const raw = block && (block.type === 'text' ? block.text : block.type === 'thinking' ? block.thinking : null);
    const text = raw ? String(raw).trim() : '';
    if (!text) continue;
    events.push({
      ts: row.timestamp || new Date().toISOString(), event: 'ModelText', session_id: session.id, synthetic: true,
      data: {
        kind: block.type,
        text: text.length > MODEL_TEXT_MAX ? text.slice(0, MODEL_TEXT_MAX) + '…' : text,
        msg_id: message.id || null,
        subagent: isSubagentRow(row, isSubagentFile),
        agent_id: row.agentId || null,
      },
    });
  }
  return events;
}

function modelStepEvent(session, row, message, toolCalls, isSubagentFile) {
  const usage = message.usage;
  return {
    ts: row.timestamp || new Date().toISOString(),
    event: 'ModelStep',
    session_id: session.id,
    synthetic: true,
    data: {
      model: message.model, stop_reason: message.stop_reason, subagent: isSubagentRow(row, isSubagentFile),
      agent_id: row.agentId || null, msg_id: message.id || null,
      tools: toolCalls.map(call => call.name), tool_ids: toolCalls.map(call => call.id),
      tokens: {
        input: usage.input_tokens || 0, output: usage.output_tokens || 0,
        cache_read: usage.cache_read_input_tokens || 0, cache_write: usage.cache_creation_input_tokens || 0,
        context: contextTokensOf(usage),
      },
    },
  };
}

function addUsage(session, message) {
  const usage = message.usage, totals = session.usage;
  totals.input += usage.input_tokens || 0;
  totals.output += usage.output_tokens || 0;
  totals.cache_read += usage.cache_read_input_tokens || 0;
  totals.cache_write += usage.cache_creation_input_tokens || 0;
  totals.turns++;
  if (message.model) totals.models[message.model] = (totals.models[message.model] || 0) + 1;
}

// how full the main agent's context window is after this response
function contextWindowUse(session, row, message) {
  const tokens = contextTokensOf(message.usage);
  const model = message.model || session.model;
  const window = hasOneMillionWindow(model) || tokens > CONTEXT_WINDOW ? ONE_MILLION_WINDOW : CONTEXT_WINDOW;
  return { tokens, window, pct: Math.min(1, tokens / window), ts: row.timestamp, model };
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

// an interrupt of the main agent: you pressed Esc or refused a call at its prompt. No hook comes then (no Stop), so
// this event ends the turn instead.
function interruptEvent(session, row) {
  return { ts: row.timestamp, event: 'Interrupt', session_id: session.id, synthetic: true, data: {} };
}

// a user line: tool results, and an interrupt. They end waits that no hook ends (needs-you.js), and an interrupt of
// the main agent also ends its turn.
function readUserRow(session, row, message, isSubagentFile, fresh) {
  // (a subagent's row in the main transcript, as older Claude Code wrote them, may have no agentId: still a subagent's)
  const subagent = isSubagentRow(row, isSubagentFile);
  const where = { ts: row.timestamp || null, subagent, agentId: subagent ? row.agentId || null : null };
  const isInterrupt = typeof message.content === 'string'
    ? message.content.startsWith(INTERRUPTED)
    : contentBlocks(message).some(block => block?.type === 'text' && String(block.text || '').startsWith(INTERRUPTED));
  if (typeof message.content !== 'string') {
    for (const block of contentBlocks(message)) {
      if (block?.type !== 'tool_result' || !block.tool_use_id) continue;
      endWaitsFromTranscript(session, { ...where, toolUseId: block.tool_use_id });
      // (a subagent call refused at its prompt started no subagent)
      if (block.is_error) dropSubagentCall(session, block.tool_use_id);
    }
  }
  if (!isInterrupt) return;
  endWaitsFromTranscript(session, { ...where, interrupted: true });
  // (only from the logged part of the session, as with the model's steps)
  if (!subagent && row.timestamp && !(session.started && row.timestamp < session.started)) {
    const event = interruptEvent(session, row);
    ingestEvent(event);
    fresh.push(event);
  }
}

// One API response spans several lines (one per content block): its first line becomes the ModelStep, and every
// non-empty text / thinking block, on whichever line it comes, also becomes a ModelText.
function readTranscriptRow(session, row, isSubagentFile, seen, fresh) {
  const message = row.message;
  // (row.type: a transcript also holds copies of the requests sent, whose messages must not count again)
  if (message && message.role === 'user' && row.type === 'user') readUserRow(session, row, message, isSubagentFile, fresh);
  if (!message || message.role !== 'assistant' || !message.usage) return;
  const messageId = message.id || row.uuid;
  // only responses from the logged part of the session: after "Clear log" the log restarts at the next hook event,
  // and the transcript's earlier history must not come back without its prompts and tools
  if (session.started && row.timestamp && row.timestamp < session.started) {
    if (messageId) seen.add(messageId);
    return;
  }
  const texts = modelTextEvents(session, row, message, isSubagentFile);
  const toolCalls = toolCallsOf(message);
  if (messageId && seen.has(messageId)) {
    addLateToolCalls(messageId, toolCalls, fresh);
    ingestAll(texts, fresh);
    return;
  }
  if (messageId) seen.add(messageId);

  addUsage(session, message);
  const isMainStep = !isSubagentRow(row, isSubagentFile);
  if (isMainStep) session.context = contextWindowUse(session, row, message);
  const step = modelStepEvent(session, row, message, toolCalls, isSubagentFile);
  const sessionModel = session.model; // a subagent's step must not change the session's model
  ingestEvent(step);
  if (isMainStep) noteContextThresholds(session, step);
  if (messageId) rememberStep(messageId, step);
  if (isSubagentFile) session.model = sessionModel;
  fresh.push(step);
  ingestAll(texts, fresh);
}

// (the line's own time, not the time it was read: a restart reads old transcripts again, and they are no sign of life)
function noteTranscriptTime(session, row) {
  const writtenAt = Date.parse(row?.timestamp);
  if (writtenAt > (transcriptWrittenAt.get(session.id) || 0)) transcriptWrittenAt.set(session.id, writtenAt);
}

// what a read can change in a session without making an event: its waits, and the subagent calls waiting
const summaryShape = session => JSON.stringify([session.needsYou, session.busy, session.subagentDescriptionsWaiting.length]);

function readTranscripts(session) {
  if (!readsTranscript(session)) return;
  const seen = seenIdsOf(session.id);
  const fresh = []; // events to push to the open pages
  const before = summaryShape(session);
  const ownRowEvents = agentServer(session.agent)?.transcriptRowEvents;
  for (const { file, isSubagent } of transcriptFilesOf(session)) {
    for (const line of tailOf(file).readNewLines()) {
      if (!line) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      noteTranscriptTime(session, row);
      if (ownRowEvents) ingestAll(ownRowEvents(session, row, id => stepByMessageId.get(id)), fresh);
      else readTranscriptRow(session, row, isSubagent, seen, fresh);
    }
  }
  for (const event of fresh) broadcast('event', event);
  // (a waiting session is read every 1.5s, mostly to find nothing: the pages hear only of a change)
  if (fresh.length || summaryShape(session) !== before) broadcast('session', sessionSummary(session));
  scheduleReread(session);
}

// a call refused at its prompt sends no hook: the transcript is read again while the session waits on you, until it
// has gone quiet (a session closed while it waits sends nothing more, and must not be read forever)
function scheduleReread(session) {
  if (session.ended || !session.needsYou.length) return;
  const lastSign = Math.max(Date.parse(session.last) || 0, transcriptWrittenAt.get(session.id) || 0);
  if (Date.now() - lastSign <= WAITING_READ_IDLE_MAX_MS) scheduleTranscriptRead(session, WAITING_READ_MS);
}

function resetTranscriptState() {
  seenMessageIds.clear();
  stepByMessageId.clear();
  transcriptTails.clear();
  transcriptWrittenAt.clear();
  for (const hooks of allAgentServers()) hooks.reset?.();
}

function clearSessionState(sessionId, session) {
  const timer = scheduledReads.get(sessionId);
  if (timer) clearTimeout(timer);
  scheduledReads.delete(sessionId);
  seenMessageIds.delete(sessionId);
  for (const [id, step] of stepByMessageId) if (step.session_id === sessionId) stepByMessageId.delete(id);
  if (session?.transcript_path) for (const { file } of transcriptFilesOf(session)) transcriptTails.delete(file);
  for (const hooks of allAgentServers()) hooks.clearSession?.(sessionId);
}

module.exports = {
  ingestEvent, scheduleTranscriptRead, cancelScheduledReads, readTranscripts, resetTranscriptState, clearSessionState, subagentDirOf,
};
