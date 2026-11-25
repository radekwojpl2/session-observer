// A Codex session's whole context, for the Context view, read from Codex's session file (its "rollout", which every
// Codex hook event points to as transcript_path). It answers in the same shape as a Claude Code session's context,
// so the view shows both the same way.
//
// The rollout is Codex's own record, not a stable interface: rows this reader doesn't know are skipped. Reasoning is
// stored encrypted, so it shows only when Codex kept a summary of it.
'use strict';
const { readTranscriptRows, clipText, clipDeep, textLength } = require('../transcript-rows');
const { codexPreludeOf, messageParts, partRole, kindLabel, payloadOf, isMessage } = require('./rollout-prelude');
const { tokensOf } = require('../../sessions/codex-model-steps');

const PLAUSIBLE_CHARS_PER_TOKEN = [1.5, 8];

// a tool call's input: a function's JSON arguments, a custom tool's free text, or the call itself
function callInput(payload) {
  if (typeof payload.arguments === 'string') {
    try { return JSON.parse(payload.arguments); } catch { return { arguments: payload.arguments }; }
  }
  if (typeof payload.input === 'string') return { input: payload.input };
  if (payload.action && typeof payload.action === 'object') return payload.action; // local_shell_call, web_search_call
  return payload.arguments ?? payload.input ?? {};
}

// a tool's output as text: a string, a list of content parts, or { content | output }
function outputText(output) {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return output.map(part => (typeof part?.text === 'string' ? part.text : JSON.stringify(part))).join('\n');
  if (output && typeof output === 'object') {
    if (typeof output.content === 'string') return output.content;
    if (typeof output.output === 'string') return output.output;
  }
  return output == null ? '' : JSON.stringify(output);
}

const isCall = type => /_call$/.test(type);
const isCallOutput = type => /_call_output$/.test(type);

// one part of a message as an item, or null for the parts pinned on top (they show in the conversation only when
// they change later, as the Claude Code view does)
function partItem(role, part, ts) {
  switch (partRole(role, part.kind)) {
    case 'prompt': return { kind: 'user', ts, text: clipText(part.text.trim()) };
    case 'reply': return part.text.trim() ? { kind: 'text', ts, text: clipText(part.text) } : null;
    case 'sent': return { kind: 'attachment', ts, type: part.kind, role: 'sent', rendered: false, label: kindLabel(part.kind), text: clipText(part.text) };
    default: return { kind: 'attachment', ts, type: part.kind, role: 'pinned', rendered: false, label: kindLabel(part.kind), text: clipText(part.text) };
  }
}

function responseItems(payload, ts) {
  const type = payload.type || '';
  if (type === 'message') return messageParts(payload).map(part => partItem(payload.role, part, ts)).filter(Boolean);
  if (type === 'reasoning') {
    const summary = (Array.isArray(payload.summary) ? payload.summary : []).map(part => part?.text || '').join('\n\n').trim();
    return summary ? [{ kind: 'thinking', ts, text: clipText(summary) }] : [];
  }
  if (isCallOutput(type)) {
    const text = clipText(outputText(payload.output));
    // output with no call: context an app added on its own
    if (!payload.call_id) return [{ kind: 'attachment', ts, type, role: 'sent', rendered: false, label: payload.name || type, text }];
    return [{ kind: 'result', ts, id: payload.call_id, error: payload.status === 'failed' || payload.success === false, text, agentId: null }];
  }
  if (isCall(type)) {
    const name = payload.name || type.replace(/_call$/, '');
    return [{ kind: 'call', ts, id: payload.call_id || payload.id || null, name, input: clipDeep(callInput(payload)) }];
  }
  return [];
}

const ASSISTANT_KINDS = new Set(['thinking', 'text', 'call']);

// The conversation as the view's items. Codex writes a request's token use after the reply it produced, so each model
// step is placed before that reply's items, where the Claude Code view expects it.
function codexConversationItems(rows) {
  const items = [];
  let replyStart = null, model = null;
  for (const row of rows) {
    const ts = row.timestamp || null, payload = payloadOf(row);
    if (row.type === 'turn_context' && payload.model) model = payload.model;
    if (row.type === 'compacted') {
      items.push({ kind: 'compact', ts, trigger: null, preTokens: null });
      if (typeof payload.message === 'string' && payload.message.trim()) items.push({ kind: 'summary', ts, text: clipText(payload.message) });
      replyStart = null;
      continue;
    }
    if (row.type === 'token_usage_record' && payload.usage) {
      const tokens = tokensOf(payload.usage);
      const step = { kind: 'step', ts, model, out: tokens.output, ctx: tokens.context, cached: tokens.cache_read };
      items.splice(replyStart ?? items.length, 0, step);
      replyStart = null;
      continue;
    }
    if (row.type !== 'response_item') continue;
    for (const item of responseItems(payload, ts)) {
      if (ASSISTANT_KINDS.has(item.kind)) replyStart ??= items.length;
      else replyStart = null;
      items.push(item);
    }
  }
  return items;
}

// Measured size: the first step's context is everything the model was given up front; with the characters of what
// came before it, that is this session's characters per token.
function measuredSize(rows, prelude, items) {
  const firstStep = items.find(item => item.kind === 'step');
  if (!firstStep?.ctx) return null;
  let chars = textLength(prelude.system) + JSON.stringify(prelude.tools || []).length;
  for (const row of rows) {
    if (row.type === 'token_usage_record') break;
    if (!isMessage(row)) continue;
    const payload = payloadOf(row);
    for (const part of messageParts(payload)) if (partRole(payload.role, part.kind) !== 'system') chars += textLength(part.text);
  }
  const charsPerToken = chars / firstStep.ctx;
  const [lowest, highest] = PLAUSIBLE_CHARS_PER_TOKEN;
  return { firstCtx: firstStep.ctx, chars, cpt: charsPerToken >= lowest && charsPerToken <= highest ? charsPerToken : null };
}

// the context window Codex reports for the latest turn
function reportedWindow(rows) {
  for (let index = rows.length - 1; index >= 0; index--) {
    const window = Number(payloadOf(rows[index]).model_context_window);
    if (rows[index].type === 'event_msg' && window > 0) return window;
  }
  return null;
}

function codexSessionContext(session) {
  const rollout = session.transcript_path;
  const rows = rollout && readTranscriptRows(rollout);
  if (!rows) return { error: 'Codex session file not found', transcript: rollout || null };
  const prelude = codexPreludeOf(rows);
  const items = codexConversationItems(rows);
  return {
    session: session.id, agent: 'codex', transcript: rollout, model: session.model, context: session.context,
    window: reportedWindow(rows),
    ...prelude,
    items,
    subagents: {},
    wire: null,
    measured: measuredSize(rows, prelude, items),
  };
}

module.exports = { codexSessionContext };
