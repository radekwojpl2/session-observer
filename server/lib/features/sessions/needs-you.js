// What a session is waiting on you for, as its events arrive: a permission to approve, a question to answer, or an
// MCP server asking for input. Each wait ends when its own answer arrives (the tool's result, the elicitation's
// result), or when the turn ends one way or another (Stop, an interrupt, a new prompt, the session ending).
// A call refused at its prompt, and an interrupt, send no hook at all: the transcript shows them (endWaitsFromTranscript).
//
// A PermissionRequest carries no tool_use_id (Claude Code's and Codex's alike). Such a permission is tied to the call it
// asks about: the latest PreToolUse of the same agent and tool, with no result yet, whose input fields all come back
// unchanged in the permission's input (Codex adds a description). Its wait then ends with that call's result, and
// another call that finishes meanwhile (one run in parallel) leaves it alone. A permission with no such call gets a
// key of its own, and ends with a result of the same agent and tool whose input fields all come back in it.
'use strict';
const { toolsWithRole } = require('../agents/registry');
const crypto = require('crypto');
const { QUESTION_TOOLS } = require('./event-categories');
const { isRunningBackgroundSubagent } = require('./subagent-list');

const WAITS_KEPT_MAX = 10;
const CALLS_KEPT_MAX = 50;
const TEXT_MAX = 300;
const ASYNC_QUESTION_TOOLS = toolsWithRole('asyncQuestion'); // ask, and also wait for your next message (Codex)
const ENDS_EVERY_WAIT = new Set(['UserPromptSubmit', 'Stop', 'StopFailure', 'SessionEnd']);
const ANSWERS_A_TOOL = new Set(['PostToolUse', 'PostToolUseFailure', 'PermissionDenied']);

const clip = text => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX);

// the questions a question tool asks: Claude Code's AskUserQuestion has { questions: [{ question }] }, Codex's
// request_user_input a { prompt } or { message }
function questionText(input) {
  if (Array.isArray(input?.questions)) return input.questions.map(question => question?.question || '').filter(Boolean).join(' | ');
  return input?.prompt || input?.message || input?.question || '';
}

// the most telling argument of a call, for "permission to run …"
const callArgument = input => input?.command || input?.file_path || input?.path || input?.url || input?.pattern || input?.description || '';

function addWait(session, wait) {
  const waits = session.needsYou;
  const index = waits.findIndex(existing => existing.key === wait.key);
  if (index >= 0) waits[index] = { ...waits[index], ...wait, since: waits[index].since };
  else waits.push(wait);
  if (waits.length > WAITS_KEPT_MAX) waits.splice(0, waits.length - WAITS_KEPT_MAX);
}

const removeWaits = (session, matches) => { session.needsYou = session.needsYou.filter(wait => !matches(wait)); };

// the same input gives the same key, whatever the order of its fields
function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
  }
  return JSON.stringify(value ?? null);
}
const callKey = (agentId, tool, input) =>
  crypto.createHash('sha1').update(stableJson([agentId ?? null, tool || null, input ?? null])).digest('hex').slice(0, 16);

// every field of a call's input, unchanged in the other input (which may have more)
function fieldsIn(part, whole) {
  if (!part || typeof part !== 'object' || Array.isArray(part)) return stableJson(part) === stableJson(whole);
  return Object.keys(part).every(field => stableJson(part[field]) === stableJson(whole?.[field]));
}
const callOf = data => ({ agentId: data.agent_id ?? null, tool: data.tool_name || null, input: data.tool_input ?? null });
// a call, and a permission that asks about it
const asksAbout = (call, permission) =>
  call.agentId === permission.agentId && call.tool === permission.tool && fieldsIn(call.input, permission.input);

// per session: the calls without a result yet, so a permission asked without a call id can find its call; and the
// permissions that found none, so a later result can end them
const openCalls = new WeakMap();       // session → [{ id, agentId, tool, input }]
const unlinkedPermissions = new WeakMap(); // session → Map(wait key → { agentId, tool, input })
const listOf = (map, session, empty) => {
  if (!map.has(session)) map.set(session, empty());
  return map.get(session);
};

function noteOpenCall(session, data) {
  const calls = listOf(openCalls, session, () => []);
  calls.push({ id: data.tool_use_id, ...callOf(data) });
  if (calls.length > CALLS_KEPT_MAX) calls.splice(0, calls.length - CALLS_KEPT_MAX);
}

const closeOpenCall = (session, toolUseId) =>
  openCalls.set(session, listOf(openCalls, session, () => []).filter(call => call.id !== toolUseId));

// the key of a permission's wait: its own call id, the id of the call it asks about, or a key of its own
function permissionKey(session, data) {
  if (data.tool_use_id) return 'tool:' + data.tool_use_id;
  const permission = callOf(data);
  const call = listOf(openCalls, session, () => []).findLast(candidate => asksAbout(candidate, permission));
  if (call) return 'tool:' + call.id;
  const key = 'permission:' + callKey(permission.agentId, permission.tool, permission.input);
  const unlinked = listOf(unlinkedPermissions, session, () => new Map());
  unlinked.set(key, permission);
  if (unlinked.size > CALLS_KEPT_MAX) unlinked.delete(unlinked.keys().next().value);
  return key;
}

// the keys of the permissions with no call that this result answers
function unlinkedAnsweredBy(session, data) {
  const unlinked = unlinkedPermissions.get(session);
  if (!unlinked) return new Set();
  const call = callOf(data);
  const keys = new Set([...unlinked].filter(([, permission]) => asksAbout(call, permission)).map(([key]) => key));
  for (const key of keys) unlinked.delete(key);
  return keys;
}

function waitFields(event, data) {
  return { since: event.ts, agentId: data.agent_id ?? null, agentType: data.agent_type ?? null };
}

// updates session.needsYou for one event
function trackNeedsYou(session, event, data) {
  const name = event.event, toolUseId = data.tool_use_id || null;
  if (name === 'Interrupt') {
    // (made from the transcript, read late: a wait that began after it stays)
    removeWaits(session, wait => wait.since <= event.ts);
    return;
  }
  if (ENDS_EVERY_WAIT.has(name)) {
    // (a background agent goes on after its turn, and keeps waiting on you; only the session's end ends that.
    // The async Codex input tool finishes its hook call before the user replies: its wait survives the Stop and
    // ends when the next prompt arrives.)
    const turnStopped = name === 'Stop' || name === 'StopFailure';
    session.needsYou = name === 'SessionEnd' ? [] : session.needsYou.filter(wait => isRunningBackgroundSubagent(session, wait.agentId)
      || (turnStopped && ASYNC_QUESTION_TOOLS.has(wait.tool)));
    if (name === 'SessionEnd') { openCalls.delete(session); unlinkedPermissions.delete(session); }
    return;
  }
  if (name === 'PreToolUse' && toolUseId) noteOpenCall(session, data);
  if (name === 'SubagentStop' && data.agent_id != null) {
    removeWaits(session, wait => wait.agentId === data.agent_id);
    return;
  }
  if (name === 'PreToolUse' && QUESTION_TOOLS.has(data.tool_name)) {
    addWait(session, { key: 'tool:' + (toolUseId || event.seq), kind: 'question', tool: data.tool_name, text: clip(questionText(data.tool_input)), ...waitFields(event, data) });
  } else if (name === 'PermissionRequest' && !QUESTION_TOOLS.has(data.tool_name)) {
    // (Claude Code asks permission for AskUserQuestion too: its question is already the wait)
    addWait(session, { key: permissionKey(session, data), kind: 'permission', tool: data.tool_name || null, text: clip(callArgument(data.tool_input)), ...waitFields(event, data) });
  } else if (name === 'Elicitation') {
    addWait(session, { key: 'elicitation:' + (data.server_name || ''), kind: 'mcp', tool: data.server_name || null, text: clip(data.message), ...waitFields(event, data) });
  } else if (name === 'ElicitationResult') {
    removeWaits(session, wait => wait.key === 'elicitation:' + (data.server_name || ''));
  } else if (name === 'Notification' && data.notification_type === 'permission_prompt' && !session.needsYou.length) {
    // Claude Code's own "needs your permission" notice, for when no PermissionRequest came first
    addWait(session, { key: 'notification', kind: 'permission', tool: null, text: clip(data.message), ...waitFields(event, data) });
  } else if (ANSWERS_A_TOOL.has(name) && !(name === 'PostToolUse' && ASYNC_QUESTION_TOOLS.has(data.tool_name))) {
    // a tool's result answers its own wait (the permission was given or refused: the call has finished), and a
    // permission about this call that had no call to tie it to (an async question's result comes before your answer)
    const sameAgent = wait => wait.agentId === (data.agent_id ?? null);
    const answered = unlinkedAnsweredBy(session, data);
    if (toolUseId) closeOpenCall(session, toolUseId);
    removeWaits(session, wait => (toolUseId && wait.key === 'tool:' + toolUseId) || answered.has(wait.key)
      || (wait.key === 'notification' && sameAgent(wait)));
  }
}

// what only the transcript shows: a call's tool_result (also when you refused the call at its prompt: no hook comes
// then), or an interrupt ("[Request interrupted by user…]"). Each ends the waits that began before it, of the same
// agent (an interrupt of the main agent: every wait); the transcript is read late, so a newer wait stays. A subagent's
// row without an agentId stands for any subagent, never for the main agent.
function endWaitsFromTranscript(session, { ts, toolUseId = null, agentId = null, subagent = agentId != null, interrupted = false }) {
  const beganBefore = wait => !ts || wait.since <= ts;
  const sameAgent = wait => (subagent ? wait.agentId != null && (agentId == null || wait.agentId === agentId) : wait.agentId == null);
  if (interrupted) {
    removeWaits(session, wait => beganBefore(wait) && (!subagent || sameAgent(wait)));
    return;
  }
  removeWaits(session, wait => beganBefore(wait) && ((toolUseId && wait.key === 'tool:' + toolUseId)
    || (wait.key === 'notification' && sameAgent(wait))));
}

module.exports = { trackNeedsYou, endWaitsFromTranscript };
