// Model steps for Codex sessions. Codex reports every model request in a PostModelRequest hook event: each one is
// turned into the same ModelStep the transcript reader makes for Claude Code, and its token counts are added up.
// What the model wrote is not in the hook: codex-rollout-texts.js reads it from Codex's session file.
//
// Codex starts a response's tool calls while the response still streams, so their PreToolUse hooks come before the
// PostModelRequest. The calls an agent started since its previous step are that step's: their tool_use_ids match the
// hooks, and the step moves to just before the first of them, where the request was.
'use strict';
const { contextWindow: CODEX_CONTEXT_WINDOW } = require('./manifest');

const CODEX = 'codex';
const isCodexModelRequest = event => event.agent === CODEX && event.event === 'PostModelRequest';

// session id → agent id ('' for the main agent) → the PreToolUse events since that agent's last step
const callsSinceStep = new Map();
const agentKeyOf = data => (data.agent_id == null ? '' : String(data.agent_id));

// remembers a Codex tool call until the model step that asked for it arrives; a new prompt starts afresh
function noteCodexEvent(event) {
  if (event.agent !== CODEX) return;
  const data = event.data || {};
  if (event.event === 'UserPromptSubmit' || event.event === 'SessionEnd') { callsSinceStep.delete(event.session_id); return; }
  if (event.event !== 'PreToolUse' || !data.tool_name) return;
  if (!callsSinceStep.has(event.session_id)) callsSinceStep.set(event.session_id, new Map());
  const byAgent = callsSinceStep.get(event.session_id), key = agentKeyOf(data);
  if (!byAgent.has(key)) byAgent.set(key, []);
  byAgent.get(key).push({ name: data.tool_name, id: data.tool_use_id || null, ts: event.ts });
}

function takeCallsSinceStep(event) {
  const byAgent = callsSinceStep.get(event.session_id), key = agentKeyOf(event.data || {});
  const calls = byAgent?.get(key) || [];
  byAgent?.delete(key);
  return calls;
}

const resetCodexSteps = () => callsSinceStep.clear();
const clearCodexSession = sessionId => callsSinceStep.delete(sessionId);

// the step's time: just before its first tool call, when that came earlier
function stepTime(ts, calls) {
  const first = calls.map(call => Date.parse(call.ts)).filter(Number.isFinite).reduce((a, b) => Math.min(a, b), Infinity);
  return first < Date.parse(ts) ? new Date(first - 1).toISOString() : ts;
}

const count = value => (Number.isFinite(Number(value)) ? Number(value) : 0);

// Codex's token_usage, in the ModelStep's terms. The hook docs don't spell its fields out: these are the OpenAI names
// (input_tokens includes the cached part), with Anthropic-style names accepted too.
function tokensOf(usage) {
  if (!usage || typeof usage !== 'object') return { input: 0, output: 0, cache_read: 0, cache_write: 0, context: 0 };
  const cacheRead = count(usage.cached_input_tokens ?? usage.cache_read_input_tokens ?? usage.input_tokens_details?.cached_tokens);
  const cacheWrite = count(usage.cache_creation_input_tokens);
  const inputWithCache = usage.cached_input_tokens != null || usage.input_tokens_details != null;
  const input = inputWithCache ? Math.max(0, count(usage.input_tokens) - cacheRead) : count(usage.input_tokens);
  return { input, output: count(usage.output_tokens), cache_read: cacheRead, cache_write: cacheWrite, context: input + cacheRead + cacheWrite };
}

// rewrites a Codex PostModelRequest event, in place, into a ModelStep (the request's own fields stay in data)
function toCodexModelStep(event) {
  const data = event.data || {};
  const calls = takeCallsSinceStep(event);
  event.event = 'ModelStep';
  event.ts = stepTime(event.ts, calls);
  event.data = {
    ...data,
    model: data.model || null,
    stop_reason: data.status || null, // completed, failed or cancelled
    subagent: data.agent_id != null,
    agent_id: data.agent_id ?? null,
    msg_id: data.response_id || null, // what the model wrote carries the same id (codex-rollout-texts.js)
    tools: calls.map(call => call.name), tool_ids: calls.map(call => call.id),
    tokens: tokensOf(data.token_usage),
  };
  return event;
}

// adds a Codex step's tokens to the session's totals and, for the main agent, its context window use
function addCodexUsage(session, step) {
  const { tokens, model, subagent, token_usage: usage } = step.data;
  const totals = session.usage;
  totals.input += tokens.input;
  totals.output += tokens.output;
  totals.cache_read += tokens.cache_read;
  totals.cache_write += tokens.cache_write;
  totals.turns++;
  if (model) totals.models[model] = (totals.models[model] || 0) + 1;
  if (subagent || !tokens.context) return;
  const window = count(usage?.model_context_window ?? step.data.model_context_window) || CODEX_CONTEXT_WINDOW;
  session.context = { tokens: tokens.context, window, pct: Math.min(1, tokens.context / window), ts: step.ts };
}

module.exports = { CODEX, isCodexModelRequest, noteCodexEvent, toCodexModelStep, addCodexUsage, resetCodexSteps, clearCodexSession, tokensOf };
