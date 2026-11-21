// What a session is waiting on you for, as its events arrive: a permission to approve, a question to answer, or an
// MCP server asking for input. Each wait ends when its own answer arrives (the tool's result, the elicitation's
// result), or when the turn ends one way or another (Stop, an interrupt, a new prompt, the session ending).
// A call refused at its prompt, and an interrupt, send no hook at all: the transcript shows them (endWaitsFromTranscript).
'use strict';
const { QUESTION_TOOLS } = require('./event-categories');

const WAITS_KEPT_MAX = 10;
const TEXT_MAX = 300;
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
    session.needsYou = [];
    return;
  }
  if (name === 'SubagentStop' && data.agent_id != null) {
    removeWaits(session, wait => wait.agentId === data.agent_id);
    return;
  }
  if (name === 'PreToolUse' && QUESTION_TOOLS.has(data.tool_name)) {
    addWait(session, { key: 'tool:' + (toolUseId || event.seq), kind: 'question', tool: data.tool_name, text: clip(questionText(data.tool_input)), ...waitFields(event, data) });
  } else if (name === 'PermissionRequest' && !QUESTION_TOOLS.has(data.tool_name)) {
    // (Claude Code asks permission for AskUserQuestion too: its question is already the wait)
    addWait(session, { key: 'tool:' + (toolUseId || 'permission'), kind: 'permission', tool: data.tool_name || null, text: clip(callArgument(data.tool_input)), ...waitFields(event, data) });
  } else if (name === 'Elicitation') {
    addWait(session, { key: 'elicitation:' + (data.server_name || ''), kind: 'mcp', tool: data.server_name || null, text: clip(data.message), ...waitFields(event, data) });
  } else if (name === 'ElicitationResult') {
    removeWaits(session, wait => wait.key === 'elicitation:' + (data.server_name || ''));
  } else if (name === 'Notification' && data.notification_type === 'permission_prompt' && !session.needsYou.length) {
    // Claude Code's own "needs your permission" notice, for when no PermissionRequest came first
    addWait(session, { key: 'notification', kind: 'permission', tool: null, text: clip(data.message), ...waitFields(event, data) });
  } else if (ANSWERS_A_TOOL.has(name)) {
    // a tool's result answers its own wait, and a permission asked without a call id (the permission was given or
    // refused: the call has finished)
    const sameAgent = wait => wait.agentId === (data.agent_id ?? null);
    removeWaits(session, wait => (toolUseId && wait.key === 'tool:' + toolUseId)
      || ((wait.key === 'tool:permission' || wait.key === 'notification') && sameAgent(wait)));
  }
}

// what only the transcript shows: a call's tool_result (also when you refused the call at its prompt: no hook comes
// then), or an interrupt ("[Request interrupted by user…]"). Each ends the waits that began before it, of the same
// agent (an interrupt of the main agent: every wait); the transcript is read late, so a newer wait stays.
function endWaitsFromTranscript(session, { ts, toolUseId = null, agentId = null, interrupted = false }) {
  const beganBefore = wait => !ts || wait.since <= ts;
  const sameAgent = wait => wait.agentId === agentId;
  if (interrupted) {
    removeWaits(session, wait => beganBefore(wait) && (agentId == null || sameAgent(wait)));
    return;
  }
  removeWaits(session, wait => beganBefore(wait) && ((toolUseId && wait.key === 'tool:' + toolUseId)
    || ((wait.key === 'tool:permission' || wait.key === 'notification') && sameAgent(wait))));
}

module.exports = { trackNeedsYou, endWaitsFromTranscript };
