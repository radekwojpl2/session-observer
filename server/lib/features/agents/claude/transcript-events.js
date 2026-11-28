// What Claude Code's transcripts add to the hook events. Hooks don't see individual model calls, so each assistant API
// response in the transcript (and in the subagent transcripts beside it) becomes a synthetic "ModelStep" event, and
// every block of text or thinking it wrote a "ModelText". User lines end waits that no hook ends (a call refused at
// its prompt, an interrupt), and an interrupt of the main agent also ends its turn.
// The generic reader (features/sessions/transcript-steps.js) tails the files and calls readSessionFileRow per line.
'use strict';
const fs = require('fs');
const path = require('path');
const { CONTEXT_WINDOW } = require('../../../building-blocks/config');
const { ONE_MILLION_WINDOW, contextTokensOf, hasOneMillionWindow } = require('../../../building-blocks/token-usage');
const { endWaitsFromTranscript } = require('../../sessions/needs-you');
const { dropSubagentCall } = require('../../sessions/subagent-list');
const { noteContextThresholds } = require('../../sessions/context-thresholds');

const MODEL_TEXT_MAX = 2000; // characters kept of one text / thinking block
const INTERRUPTED = '[Request interrupted by user'; // the line Claude Code writes when you interrupt or refuse a call

// the folder a transcript keeps its subagents' transcripts in: <transcript>/subagents/
const subagentDirOf = transcriptPath =>
  path.join(path.dirname(transcriptPath), path.basename(transcriptPath, '.jsonl'), 'subagents');

// the main transcript, and each subagent's
function sessionFiles(session) {
  const mainTranscript = session.transcript_path;
  const files = [{ file: mainTranscript, isSubagent: false }];
  const subagentDir = subagentDirOf(mainTranscript);
  try {
    for (const name of fs.readdirSync(subagentDir)) {
      if (name.endsWith('.jsonl')) files.push({ file: path.join(subagentDir, name), isSubagent: true });
    }
  } catch { /* no subagents */ }
  return files;
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
        cache_write_1h: usage.cache_creation?.ephemeral_1h_input_tokens || 0, // Claude Code caches mostly for an hour, which costs more
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

// an interrupt of the main agent: you pressed Esc or refused a call at its prompt. No hook comes then (no Stop), so
// this event ends the turn instead.
function interruptEvent(session, row) {
  return { ts: row.timestamp, event: 'Interrupt', session_id: session.id, synthetic: true, data: {} };
}

// a user line: tool results, and an interrupt. They end waits that no hook ends (needs-you.js), and an interrupt of
// the main agent also ends its turn.
function readUserRow(session, row, message, isSubagentFile, read) {
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
  if (!subagent && row.timestamp && !(session.started && row.timestamp < session.started)) read.ingestAll([interruptEvent(session, row)]);
}

// One API response spans several lines (one per content block): its first line becomes the ModelStep, and every
// non-empty text / thinking block, on whichever line it comes, also becomes a ModelText.
// `read`: the generic reader's { seen, ingestEvent, ingestAll, rememberStep, addLateToolCalls, fresh }
function readSessionFileRow(session, row, isSubagentFile, read) {
  const message = row.message;
  // (row.type: a transcript also holds copies of the requests sent, whose messages must not count again)
  if (message && message.role === 'user' && row.type === 'user') readUserRow(session, row, message, isSubagentFile, read);
  if (!message || message.role !== 'assistant' || !message.usage) return;
  const messageId = message.id || row.uuid;
  // only responses from the logged part of the session: after "Clear log" the log restarts at the next hook event,
  // and the transcript's earlier history must not come back without its prompts and tools
  if (session.started && row.timestamp && row.timestamp < session.started) {
    if (messageId) read.seen.add(messageId);
    return;
  }
  const texts = modelTextEvents(session, row, message, isSubagentFile);
  const toolCalls = toolCallsOf(message);
  if (messageId && read.seen.has(messageId)) {
    read.addLateToolCalls(messageId, toolCalls);
    read.ingestAll(texts);
    return;
  }
  if (messageId) read.seen.add(messageId);

  addUsage(session, message);
  const isMainStep = !isSubagentRow(row, isSubagentFile);
  if (isMainStep) session.context = contextWindowUse(session, row, message);
  const step = modelStepEvent(session, row, message, toolCalls, isSubagentFile);
  const sessionModel = session.model; // a subagent's step must not change the session's model
  read.ingestEvent(step);
  if (isMainStep) noteContextThresholds(session, step);
  if (messageId) read.rememberStep(messageId, step);
  if (isSubagentFile) session.model = sessionModel;
  read.fresh.push(step);
  read.ingestAll(texts);
}

module.exports = { readSessionFileRow, sessionFiles, subagentDirOf };
