// A pi or omp (oh-my-pi) session's whole context, for the Context view, read from the agent's own session file (the
// extension names it in every SessionStart as session_file). It answers in the same shape as a Claude Code session's
// context, so the view shows all of them the same way.
//
// The file is JSONL: a header, then entries linked by id / parentId into a tree (/tree in pi starts a branch in the
// same file). The view follows the active branch: from the last entry back to the root.
//   message        user, assistant (text, thinking, toolCall blocks, usage), toolResult, and in pi system messages
//                  that set or patch the system prompt's sections and the tool definitions
//   compaction     a summary that replaced the earlier conversation (pi also stores the prompt as it was then)
//   branch_summary what an abandoned branch did
//   custom_message context an extension added (pi); omp's custom entries with a `reminder` are text it prefixes
//   session_init   omp: a subagent's system prompt and tools (the main session keeps only a digest of its prompt)
// omp keeps a subagent's file in a folder named after its parent's file: <parent>/<task name>.jsonl.
// Entries this reader doesn't know are skipped: the format is the agent's own and can change.
'use strict';
const fs = require('fs');
const path = require('path');
const { readTranscriptRows, clipText, clipDeep, contentText, textLength } = require('../transcript-rows');

const PLAUSIBLE_CHARS_PER_TOKEN = [1.5, 8];

// the entries of the active branch, root first. A file without ids (pi's first format) is linear: all of it.
function activeBranch(rows) {
  const byId = new Map();
  let leaf = null;
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || row.type === 'session') continue;
    byId.set(row.id, row);
    leaf = row;
  }
  if (!leaf) return rows.filter(row => row && row.type !== 'session' && row.type !== 'title');
  const branch = [], seen = new Set();
  for (let row = leaf; row && !seen.has(row.id); row = row.parentId ? byId.get(row.parentId) : null) {
    seen.add(row.id);
    branch.push(row);
  }
  return branch.reverse();
}

const count = value => (Number.isFinite(Number(value)) ? Number(value) : 0);
const contextTokens = usage => count(usage?.input) + count(usage?.cacheRead) + count(usage?.cacheWrite);

// ---- the system prompt and tools
const toolDefinition = tool => ({
  name: String(tool?.name || '?'),
  description: clipText(String(tool?.description || '')),
  schema: tool?.parameters || tool?.inputSchema || null,
});

// pi: a system message sets sections by name (null removes one) and adds or removes tools; replayed in order they
// give the prompt and tools now. A compaction carries the whole prompt as it was, and starts the replay again.
function replaySystemMessage(state, message) {
  if (!message || message.role !== 'system') return;
  if (message.sections && typeof message.sections === 'object') {
    for (const [name, text] of Object.entries(message.sections)) {
      if (text == null) state.sections.delete(name);
      else state.sections.set(name, String(text));
    }
  }
  if (typeof message.content === 'string' && message.content.trim()) state.sections.set('content', message.content);
  for (const tool of message.toolsAdded || []) if (tool?.name) state.tools.set(tool.name, toolDefinition(tool));
  for (const tool of message.toolsRemoved || []) if (tool?.name) state.tools.delete(tool.name);
}

function preludeOf(branch) {
  const state = { sections: new Map(), tools: new Map() };
  let seenSystem = false, ompSystem = null, ompTools = null, latestToolNames = null;
  for (const row of branch) {
    if (row.type === 'compaction' && row.systemMessage) {
      state.sections.clear();
      state.tools.clear();
      replaySystemMessage(state, row.systemMessage);
      seenSystem = true;
    }
    if (row.type === 'message' && row.message?.role === 'system') {
      replaySystemMessage(state, row.message);
      seenSystem = true;
    }
    if (row.type === 'session_init') {
      if (Array.isArray(row.systemPrompt)) ompSystem = row.systemPrompt.join('\n\n');
      else if (typeof row.systemPrompt === 'string') ompSystem = row.systemPrompt;
      if (Array.isArray(row.tools)) ompTools = row.tools;
    }
    const active = row.message?.requestControls?.tools?.active;
    if (Array.isArray(active)) latestToolNames = active;
  }
  // tools named only (omp): no description or schema in the file
  const named = names => names.map(name => (typeof name === 'string' ? { name, description: '', schema: null } : toolDefinition(name)));
  let system = null, tools = null;
  if (seenSystem) {
    system = [...state.sections.values()].join('\n\n');
    tools = [...state.tools.values()];
  } else if (ompSystem != null) {
    system = ompSystem;
    tools = named(latestToolNames || ompTools || []);
  } else if (latestToolNames) {
    tools = named(latestToolNames);
  }
  return {
    system: system != null ? clipText(system) : null,
    tools,
    instructions: [], skills: null, agents: null, mcp: null, deferred: null, // inside the system prompt, not apart
  };
}

// ---- the conversation
function userItems(message, ts) {
  if (typeof message.content === 'string') return [{ kind: 'user', ts, text: clipText(message.content) }];
  const items = [];
  for (const block of Array.isArray(message.content) ? message.content : []) {
    if (block?.type === 'text') items.push({ kind: 'user', ts, text: clipText(block.text || '') });
    else if (block?.type === 'image') items.push({ kind: 'user', ts, text: '[image]' });
  }
  return items;
}

function assistantItems(message, ts) {
  const items = [];
  if (message.usage) items.push({ kind: 'step', ts, model: message.model || null, out: count(message.usage.output), ctx: contextTokens(message.usage) });
  for (const block of Array.isArray(message.content) ? message.content : []) {
    if (block?.type === 'text' && block.text?.trim()) items.push({ kind: 'text', ts, text: clipText(block.text) });
    else if (block?.type === 'thinking' && block.thinking?.trim()) items.push({ kind: 'thinking', ts, text: clipText(block.thinking) });
    else if (block?.type === 'toolCall') items.push({ kind: 'call', ts, id: block.id || null, name: block.name || '?', input: clipDeep(block.arguments ?? {}) });
  }
  if (message.stopReason === 'error' && message.errorMessage) items.push({ kind: 'text', ts, text: clipText(`[error] ${message.errorMessage}`) });
  return items;
}

const sentItem = (ts, label, text) => ({ kind: 'attachment', ts, type: label, role: 'sent', rendered: false, label, text: clipText(text) });

// a system message after the first: the parts of the prompt it changed
function systemChangeItem(message, ts) {
  const parts = [];
  for (const [name, text] of Object.entries(message.sections || {})) parts.push(text == null ? `[${name} removed]` : `[${name}]\n${text}`);
  const added = (message.toolsAdded || []).map(tool => tool?.name).filter(Boolean);
  const removed = (message.toolsRemoved || []).map(tool => tool?.name).filter(Boolean);
  if (added.length) parts.push(`[tools added] ${added.join(', ')}`);
  if (removed.length) parts.push(`[tools removed] ${removed.join(', ')}`);
  return parts.length ? { kind: 'attachment', ts, type: 'system', role: 'pinned', rendered: false, label: 'system prompt change', text: clipText(parts.join('\n\n')) } : null;
}

function conversationItems(branch) {
  const items = [];
  let seenSystem = false;
  for (const row of branch) {
    const ts = row.timestamp || null;
    switch (row.type) {
      case 'message': {
        const message = row.message || {};
        if (message.role === 'user') items.push(...userItems(message, ts));
        else if (message.role === 'assistant') items.push(...assistantItems(message, ts));
        else if (message.role === 'toolResult') {
          items.push({ kind: 'result', ts, id: message.toolCallId || null, error: !!message.isError, text: clipText(contentText(message.content)), agentId: null });
        } else if (message.role === 'system') {
          if (seenSystem) { const item = systemChangeItem(message, ts); if (item) items.push(item); }
          seenSystem = true;
        }
        break;
      }
      case 'compaction':
        items.push({ kind: 'compact', ts, trigger: null, preTokens: row.tokensBefore || null });
        if (row.summary) items.push({ kind: 'summary', ts, text: clipText(String(row.summary)) });
        break;
      case 'branch_summary':
        if (row.summary) items.push({ kind: 'summary', ts, text: clipText(String(row.summary)) });
        break;
      case 'custom_message':
        items.push(sentItem(ts, row.customType || 'extension', contentText(row.content)));
        break;
      case 'custom':
        if (typeof row.data?.reminder === 'string') items.push(sentItem(ts, row.customType || 'reminder', row.data.reminder));
        break;
    }
  }
  return items;
}

// Measured size: the first step's context is everything the model was given up front; with the characters of what
// came before it, that is this session's characters per token.
function measuredSize(prelude, items) {
  const first = items.findIndex(item => item.kind === 'step');
  if (first < 0 || !items[first].ctx || prelude.system == null) return null; // without the prompt, nothing to measure
  let chars = textLength(prelude.system) + JSON.stringify(prelude.tools || []).length;
  for (const item of items.slice(0, first)) chars += textLength(item.text);
  const charsPerToken = chars / items[first].ctx;
  const [lowest, highest] = PLAUSIBLE_CHARS_PER_TOKEN;
  return { firstCtx: items[first].ctx, chars, cpt: charsPerToken >= lowest && charsPerToken <= highest ? charsPerToken : null };
}

// ---- omp's subagents: <file without .jsonl>/<task name>.jsonl, each started by a task call that names it
function subagentContexts(file, items) {
  const folder = path.join(path.dirname(file), path.basename(file, '.jsonl'));
  let names = [];
  try { names = fs.readdirSync(folder).filter(name => name.endsWith('.jsonl')); } catch { return {}; }
  const callByTaskName = new Map();
  for (const item of items) {
    if (item.kind !== 'call') continue;
    for (const task of Array.isArray(item.input?.tasks) ? item.input.tasks : []) if (task?.name) callByTaskName.set(task.name, item.id);
  }
  const subagents = {};
  for (const name of names) {
    const rows = readTranscriptRows(path.join(folder, name));
    if (!rows) continue;
    const branch = activeBranch(rows);
    const id = path.basename(name, '.jsonl');
    const init = branch.find(row => row.type === 'session_init');
    subagents[id] = {
      type: init?.agent || null, description: id, toolUseId: callByTaskName.get(id) || null,
      ...preludeOf(branch), items: conversationItems(branch),
    };
  }
  return subagents;
}

function piSessionContext(session) {
  const file = session.session_file;
  const rows = file && readTranscriptRows(file);
  if (!rows) return { error: `${session.agent} session file not found`, transcript: file || null };
  const branch = activeBranch(rows);
  const prelude = preludeOf(branch);
  const items = conversationItems(branch);
  return {
    session: session.id, agent: session.agent, transcript: file, model: session.model, context: session.context,
    window: session.context?.window || null,
    ...prelude,
    items,
    subagents: subagentContexts(file, items),
    wire: null,
    measured: measuredSize(prelude, items),
  };
}

module.exports = { piSessionContext, activeBranch, preludeOf, conversationItems };
