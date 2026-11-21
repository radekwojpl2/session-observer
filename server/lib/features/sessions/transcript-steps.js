// Model steps and token usage, read from each Claude Code session's transcript. Codex sessions: their steps come from
// a hook (codex-model-steps.js), and what the model wrote from Codex's session file (codex-rollout-texts.js).
//
// Hooks don't see individual model calls, so each assistant API response in the transcript (and in the subagent
// transcripts) becomes a synthetic "ModelStep" event, and every block of text or thinking it wrote a "ModelText".
'use strict';
const fs = require('fs');
const path = require('path');
const { CONTEXT_WINDOW } = require('../../building-blocks/config');
const { FileTail } = require('../../building-blocks/file-tail');
const { ingest, sessionSummary } = require('./sessions');
const { endWaitsFromTranscript } = require('./needs-you');
const { broadcast } = require('../../building-blocks/live-updates');
const { ONE_MILLION_WINDOW, contextTokensOf, hasOneMillionWindow } = require('../../building-blocks/token-usage');
const { CODEX, isCodexModelRequest, noteCodexEvent, toCodexModelStep, addCodexUsage, resetCodexSteps } = require('./codex-model-steps');
const { codexRolloutTexts, resetCodexRolloutTexts } = require('./codex-rollout-texts');

const MODEL_TEXT_MAX = 2000;          // characters kept of one text / thinking block
const REMEMBERED_STEPS_MAX = 2000;    // recent ModelSteps kept by message id
const READ_DELAY_MS = 700;            // a burst of hook events triggers one read
const WAITING_READ_MS = 1500;         // while a session waits on you: no hook may come, so the transcript is read again
const INTERRUPTED = '[Request interrupted by user'; // the line Claude Code writes when you interrupt or refuse a call

const transcriptTails = new Map();    // transcript file → FileTail
const seenMessageIds = new Map();     // session id → Set(message id)
const stepByMessageId = new Map();    // message id → its ModelStep event, so later lines can add their tool calls
const scheduledReads = new Map();     // session id → timer

const readsTranscript = session => !!session.transcript_path;
const isCodex = session => session.agent === CODEX;

// takes an event into its session and, unless it came from the transcript itself, reads the transcript soon after.
// A Codex model request becomes a ModelStep right here (with the tool calls it started) instead.
function ingestEvent(event) {
  noteCodexEvent(event);
  const isCodexStep = isCodexModelRequest(event);
  if (isCodexStep) toCodexModelStep(event);
  const session = ingest(event);
  if (isCodexStep) {
    addCodexUsage(session, event);
    if (event.data.msg_id) rememberStep(event.data.msg_id, event);
  }
  if (!event.synthetic && readsTranscript(session)) scheduleTranscriptRead(session);
  return session;
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
  if (isCodex(session)) return files; // (Codex keeps its subagents in rollouts of their own)
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
  const window = hasOneMillionWindow(message.model || session.model) || tokens > CONTEXT_WINDOW ? ONE_MILLION_WINDOW : CONTEXT_WINDOW;
  return { tokens, window, pct: Math.min(1, tokens / window), ts: row.timestamp };
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
  const where = { ts: row.timestamp || null, agentId: isSubagentRow(row, isSubagentFile) ? row.agentId || null : null };
  const isInterrupt = typeof message.content === 'string'
    ? message.content.startsWith(INTERRUPTED)
    : contentBlocks(message).some(block => block?.type === 'text' && String(block.text || '').startsWith(INTERRUPTED));
  if (typeof message.content !== 'string') {
    for (const block of contentBlocks(message)) {
      if (block?.type === 'tool_result' && block.tool_use_id) endWaitsFromTranscript(session, { ...where, toolUseId: block.tool_use_id });
    }
  }
  if (!isInterrupt) return;
  endWaitsFromTranscript(session, { ...where, interrupted: true });
  // (only from the logged part of the session, as with the model's steps)
  if (where.agentId == null && row.timestamp && !(session.started && row.timestamp < session.started)) {
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
  if (!isSubagentRow(row, isSubagentFile)) session.context = contextWindowUse(session, row, message);
  const step = modelStepEvent(session, row, message, toolCalls, isSubagentFile);
  const sessionModel = session.model; // a subagent's step must not change the session's model
  ingestEvent(step);
  if (messageId) rememberStep(messageId, step);
  if (isSubagentFile) session.model = sessionModel;
  fresh.push(step);
  ingestAll(texts, fresh);
}

function readTranscripts(session) {
  if (!readsTranscript(session)) return;
  const seen = seenIdsOf(session.id);
  const fresh = []; // events to push to the open pages
  for (const { file, isSubagent } of transcriptFilesOf(session)) {
    for (const line of tailOf(file).readNewLines()) {
      if (!line) continue;
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      if (isCodex(session)) ingestAll(codexRolloutTexts(session, row, id => stepByMessageId.get(id)), fresh);
      else readTranscriptRow(session, row, isSubagent, seen, fresh);
    }
  }
  for (const event of fresh) broadcast('event', event);
  broadcast('session', sessionSummary(session));
  if (session.needsYou.length && !session.ended) scheduleTranscriptRead(session, WAITING_READ_MS);
}

function resetTranscriptState() {
  seenMessageIds.clear();
  stepByMessageId.clear();
  transcriptTails.clear();
  resetCodexSteps();
  resetCodexRolloutTexts();
}

module.exports = {
  ingestEvent, scheduleTranscriptRead, cancelScheduledReads, readTranscripts, resetTranscriptState, subagentDirOf,
};
