// Session Observer for pi and omp (oh-my-pi). Neither runs hook commands: they load extensions, which subscribe to
// events in the agent's own process. This one turns those events into the hook events the dashboard already reads
// (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop…) and writes them with scripts/hook.js, in process.
// The model's replies come as they finish, so each becomes a ModelStep (tokens, tool calls) and its text ModelText
// events: the server reads no pi transcript.
//
// scripts/setup-pi.js installs it: a one-line file in ~/.pi/agent/extensions and ~/.omp/agent/extensions that loads
// this one with its agent's name. Like a hook, it must never break the agent: every handler swallows its errors and
// returns nothing, so it never blocks a tool or changes a result.
'use strict';
const path = require('path');
const crypto = require('crypto');

const HOOK_SCRIPT = path.join(__dirname, '..', 'scripts', 'hook.js');
const TEXT_MAX = 2000;     // characters kept of one reply or thinking block (as the server keeps from transcripts)
const SUMMARY_MAX = 4000;  // characters kept of a tool's output or the last reply
// omp keeps a subagent started without a session file under /tmp/omp-task-*/ (no header names its parent)
const PROMPT_PART = 7000;  // characters per part of a recorded system prompt (the hook cuts any field at 8000)
const INSTRUCTION_FILE = /<(project_instructions|file) path="([^"]+)">/g;
const TASK_FILE =/[\\/]omp-task-[^\\/]+[\\/][^\\/]+\.jsonl$/;

const registered = new WeakSet(); // the extension APIs already subscribed to (both shims may load in one process)

let hook = null;
function observer() {
  if (!hook) hook = require(HOOK_SCRIPT);
  return hook;
}

// calls fn, and swallows whatever it throws: an observer error must never reach the agent
function quietly(fn) {
  try { fn(); } catch { /* ignore */ }
}

const call = (object, method) => {
  try { return object && typeof object[method] === 'function' ? object[method]() : undefined; } catch { return undefined; }
};
const clip = (text, max) => (text.length > max ? text.slice(0, max) + '…' : text);

// the plain text of a prompt, message or tool result: a string, { content }, or an array of content blocks
function textOf(value, max = SUMMARY_MAX) {
  if (typeof value === 'string') return clip(value, max);
  if (!value || typeof value !== 'object') return '';
  const content = Array.isArray(value) ? value : value.content ?? value.text;
  if (typeof content === 'string') return clip(content, max);
  if (!Array.isArray(content)) return '';
  const parts = content.map(block => (block?.type === 'text' ? String(block.text ?? '') : block?.type === 'image' ? '[image]' : ''));
  return clip(parts.filter(Boolean).join('\n'), max);
}

// "<time>_<id>.jsonl" → "<id>"
function idFromSessionFile(file) {
  const name = path.basename(String(file), '.jsonl');
  const cut = name.lastIndexOf('_');
  return cut >= 0 ? name.slice(cut + 1) : name;
}

// the system prompt as text: pi's before_agent_start has it as a string, omp's as a list of parts
function systemPromptOf(event, ctx) {
  let prompt = event?.systemPrompt;
  if (prompt == null && typeof ctx?.getSystemPrompt === 'function') prompt = ctx.getSystemPrompt();
  if (Array.isArray(prompt)) prompt = prompt.filter(part => typeof part === 'string').join('\n\n');
  return typeof prompt === 'string' ? prompt : '';
}

const modelName = model => (model && typeof model === 'object' ? [model.provider, model.id].filter(Boolean).join('/') : '');
const count = value => (Number.isFinite(Number(value)) ? Number(value) : 0);

function forAgent(agent) {
  const isOmp = agent === 'omp';
  const node = process.versions.bun ? 'node' : process.execPath; // the dashboard server runs on Node, omp on Bun
  let rootSession = '';                 // omp: the first main session in this process, a subagent's fallback parent
  const toolInputs = new Map();         // tool call id → its input, until its result
  const lastReplies = new Map();        // session id → the main agent's last reply, for its Stop
  const promptDigests = new Map();      // session id → the digest of the system prompt last recorded

  function sessionOf(ctx) {
    const id = call(ctx?.sessionManager, 'getSessionId');
    return id ? String(id) : `${agent}-pid-${process.pid}`;
  }

  // an omp subagent (its task tool runs them in this process, each in its own session): the session it was started
  // from, and its name. pi has no subagents (a pi header's parentSession is a /fork).
  function subagentOf(ctx) {
    if (!isOmp) return null;
    const header = call(ctx?.sessionManager, 'getHeader');
    const file = String(call(ctx?.sessionManager, 'getSessionFile') || '');
    const parentFile = typeof header?.parentSession === 'string' ? header.parentSession : '';
    if (!parentFile && !TASK_FILE.test(file)) return null;
    return { parent: parentFile ? idFromSessionFile(parentFile) : rootSession, name: file ? path.basename(file, '.jsonl') : '' };
  }

  function record(eventName, ctx, fields = {}) {
    const sessionId = sessionOf(ctx);
    const cwd = typeof ctx?.cwd === 'string' && ctx.cwd ? ctx.cwd : process.cwd();
    const subagent = subagentOf(ctx);
    const parents = subagent?.parent ? [{ agent, session_id: subagent.parent }] : [];
    observer().recordEvent({ hook_event_name: eventName, session_id: sessionId, cwd, ...fields }, eventName, agent, parents);
    return sessionId;
  }

  function onSessionStart(event, ctx) {
    const subagent = subagentOf(ctx);
    const sessionId = sessionOf(ctx);
    if (!subagent) {
      if (isOmp && !rootSession) rootSession = sessionId;
      // what this session runs (claude, codex, another pi) names it as its parent, like Claude Code's own variable
      process.env.OBSERVER_PARENT_AGENT = agent;
      process.env.OBSERVER_PARENT_SESSION = sessionId;
    }
    record('SessionStart', ctx, {
      source: event?.reason || 'startup',
      model: modelName(ctx?.model) || null,
      session_file: call(ctx?.sessionManager, 'getSessionFile') || null,
      agent_type: subagent?.name || null,
    });
    observer().ensureServer(node).catch(() => {});
  }

  // The system prompt each turn is sent with, recorded when it changes. omp keeps only a digest of it in its session
  // file, so the Context view reads it from here; pi keeps it, but this marks when it changed. Instruction files
  // (AGENTS.md…) are inside it: pi wraps each in <project_instructions path=…>, omp in <file path=…>.
  function recordSystemPrompt(event, ctx) {
    const text = systemPromptOf(event, ctx);
    if (!text) return;
    const sessionId = sessionOf(ctx);
    const digest = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
    if (promptDigests.get(sessionId) === digest) return;
    promptDigests.set(sessionId, digest);
    const files = [...new Set([...text.matchAll(INSTRUCTION_FILE)].map(match => match[2]))];
    const parts = [];
    for (let start = 0; start < text.length; start += PROMPT_PART) parts.push(text.slice(start, start + PROMPT_PART));
    record('InstructionsLoaded', ctx, {
      files, path: files.length ? null : 'system prompt', digest, system_prompt_chars: text.length, system_prompt_parts: parts,
    });
  }

  function onPrompt(event, ctx) {
    if (event?.reason === 'revive') return; // omp waking a parked subagent: no new prompt
    quietly(() => recordSystemPrompt(event, ctx));
    record('UserPromptSubmit', ctx, { prompt: textOf(event?.prompt ?? event?.message) });
  }

  function onToolStart(event, ctx) {
    const input = event?.args ?? event?.input ?? {};
    if (event?.toolCallId) toolInputs.set(event.toolCallId, input);
    record('PreToolUse', ctx, {
      tool_name: String(event?.toolName || '?'), tool_input: input, tool_use_id: event?.toolCallId || null,
      parent_tool_use_id: event?.parentToolCallId || null,
    });
  }

  // every finished call ends here, including one blocked, refused or with bad arguments (pi's tool_execution_end)
  function onToolEnd(event, ctx) {
    const id = event?.toolCallId || null;
    const input = (id && toolInputs.get(id)) || event?.args || {};
    if (id) toolInputs.delete(id);
    const text = textOf(event?.result);
    const base = { tool_name: String(event?.toolName || '?'), tool_input: input, tool_use_id: id, duration_ms: event?.durationMs ?? null };
    if (event?.isError) record('PostToolUseFailure', ctx, { ...base, error: text || 'failed' });
    else record('PostToolUse', ctx, { ...base, tool_response: text });
  }

  // a finished assistant message: one model request, as the transcript reader makes them for Claude Code
  function onMessageEnd(event, ctx) {
    const message = event?.message;
    if (message?.role !== 'assistant') return;
    const blocks = Array.isArray(message.content) ? message.content : [];
    const calls = blocks.filter(block => block?.type === 'toolCall' || block?.type === 'tool_use');
    const usage = message.usage || {};
    const tokens = { input: count(usage.input), output: count(usage.output), cache_read: count(usage.cacheRead), cache_write: count(usage.cacheWrite) };
    tokens.context = tokens.input + tokens.cache_read + tokens.cache_write;
    const msgId = message.responseId || `${sessionOf(ctx)}:${message.timestamp || Date.now()}`;
    const sessionId = record('ModelStep', ctx, {
      model: message.model || modelName(ctx?.model) || null, provider: message.provider || null,
      stop_reason: message.stopReason || null, subagent: false, agent_id: null, msg_id: msgId,
      tools: calls.map(block => String(block.name || '?')), tool_ids: calls.map(block => block.id || null),
      tokens, model_context_window: count(ctx?.model?.contextWindow) || null, cost: count(usage.cost?.total) || null,
      error: message.errorMessage || null,
    });
    for (const block of blocks) {
      const raw = block?.type === 'text' ? block.text : block?.type === 'thinking' ? block.thinking : null;
      const text = raw ? String(raw).trim() : '';
      if (text) record('ModelText', ctx, { kind: block.type, text: clip(text, TEXT_MAX), msg_id: msgId, subagent: false, agent_id: null });
    }
    const reply = textOf(message);
    if (reply) lastReplies.set(sessionId, reply);
  }

  function recordStop(ctx, fields) {
    const sessionId = sessionOf(ctx);
    record('Stop', ctx, { last_assistant_message: lastReplies.get(sessionId) || null, ...fields });
    lastReplies.delete(sessionId);
  }

  return function sessionObserver(api) {
    if (!api || typeof api.on !== 'function' || registered.has(api)) return;
    registered.add(api);
    const on = (name, handler) => quietly(() => api.on(name, (event, ctx) => { quietly(() => handler(event, ctx)); }));

    on('session_start', onSessionStart);
    on('before_agent_start', onPrompt);
    on('tool_execution_start', onToolStart);
    on('tool_execution_end', onToolEnd);
    on('message_end', onMessageEnd);
    // the turn is over: pi's agent_settled (agent_end may still retry or continue); omp's session_stop for the main
    // session, and agent_end without willContinue for a subagent (omp sends it no session_stop)
    on('agent_settled', (event, ctx) => recordStop(ctx, { aborted: !!event?.aborted }));
    on('session_stop', (event, ctx) => recordStop(ctx, {}));
    on('agent_end', (event, ctx) => { if (subagentOf(ctx) && !event?.willContinue) recordStop(ctx, {}); });
    on('session_before_compact', (event, ctx) => record('PreCompact', ctx, { trigger: event?.reason || null }));
    on('session_compact', (event, ctx) => record('PostCompact', ctx, { trigger: event?.reason || null, tokens_before: event?.compactionEntry?.tokensBefore ?? null }));
    on('model_select', (event, ctx) => record('ModelChange', ctx, { to_model: modelName(event?.model) || null, from_model: modelName(event?.previousModel) || null }));
    on('session_shutdown', (event, ctx) => record('SessionEnd', ctx, { reason: event?.reason || 'exit' }));
  };
}

module.exports = { forAgent, textOf, idFromSessionFile };
