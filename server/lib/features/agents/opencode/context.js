// An OpenCode session's whole context, for the Context view, read from OpenCode's own database (opencode.db, SQLite):
// its messages and their parts (text, reasoning, tool calls with their full input and output, steps with their
// tokens, compactions), and its subagents, which are sessions of their own. It answers in the same shape as a Claude
// Code session's context, so the view shows both the same way.
//
// The database is OpenCode's own record, not a stable interface: parts this reader doesn't know are skipped. It is
// opened read-only, with Node's built-in node:sqlite (Node 22.5 or later). The system prompt isn't stored there: it
// comes from the InstructionsLoaded event the plugin recorded (cut at OBSERVER_MAX_FIELD characters like any field).
'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const { clipText, clipDeep } = require('../../context/transcript-rows');

// where OpenCode keeps its database: the path its plugin recorded (OpenCode's own XDG_DATA_HOME), an explicit
// OBSERVER_OPENCODE_DB, or OpenCode's default
function databasePathOf(session, env = process.env) {
  const recorded = (session.events || []).find(event => event.event === 'SessionStart' && event.data?.opencode_db)?.data.opencode_db;
  return env.OBSERVER_OPENCODE_DB || recorded || path.join(env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'opencode', 'opencode.db');
}

function openDatabase(file) {
  let sqlite;
  try { sqlite = require('node:sqlite'); } catch { return { error: "OpenCode's Context view needs Node 22.5 or later (node:sqlite)" }; }
  if (!fs.existsSync(file)) return { error: 'OpenCode database not found' };
  try { return { db: new sqlite.DatabaseSync(file, { readOnly: true }) }; } catch (error) { return { error: `OpenCode database could not be read (${error.message})` }; }
}

const parseRow = row => { try { return { ...row, data: JSON.parse(row.data) }; } catch { return null; } };
const iso = ms => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const count = value => (Number.isFinite(value) ? value : 0);

// a message's parts, in order (their ids sort by creation)
const partsOf = (db, messageId) => db.prepare('SELECT id, data FROM part WHERE message_id = ? ORDER BY id').all(messageId).map(parseRow).filter(Boolean);
const messagesOf = (db, sessionId) => db.prepare('SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id').all(sessionId).map(parseRow).filter(Boolean);

function userItems(message, parts, ts) {
  const items = [];
  for (const { data: part } of parts) {
    if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
      items.push(part.synthetic
        ? { kind: 'attachment', ts, type: 'synthetic', role: 'sent', rendered: false, label: 'OpenCode', text: clipText(part.text) }
        : { kind: 'user', ts, text: clipText(part.text.trim()) });
    } else if (part.type === 'file') {
      items.push({ kind: 'attachment', ts, type: 'file', role: 'sent', rendered: false, label: part.filename || part.url || 'file', text: clipText(part.url || '') });
    }
  }
  return items;
}

// an assistant message: each step's items, with the step itself placed before what it produced
function assistantItems(message, parts, ts) {
  const items = [];
  let stepStart = null;
  for (const { data: part } of parts) {
    const at = iso(part.time?.start) || ts;
    switch (part.type) {
      case 'step-start': stepStart = items.length; break;
      case 'reasoning': if (part.text?.trim()) items.push({ kind: 'thinking', ts: at, text: clipText(part.text) }); break;
      case 'text': if (part.text?.trim()) items.push({ kind: 'text', ts: at, text: clipText(part.text) }); break;
      case 'tool': {
        const state = part.state || {};
        items.push({ kind: 'call', ts: iso(state.time?.start) || ts, id: part.callID || part.id, name: part.tool, input: clipDeep(state.input || {}) });
        if (state.status === 'completed' || state.status === 'error') {
          items.push({ kind: 'result', ts: iso(state.time?.end) || ts, id: part.callID || part.id, error: state.status === 'error', text: clipText(String(state.status === 'error' ? state.error ?? '' : state.output ?? '')), agentId: null });
        }
        break;
      }
      case 'step-finish': {
        const tokens = part.tokens || {}, cache = tokens.cache || {};
        const step = { kind: 'step', ts, model: message.data.modelID || null, out: count(tokens.output) + count(tokens.reasoning), ctx: count(tokens.input) + count(cache.read) + count(cache.write) };
        items.splice(stepStart ?? items.length, 0, step);
        stepStart = null;
        break;
      }
      case 'compaction': items.push({ kind: 'compact', ts, trigger: part.auto ? 'auto' : 'manual', preTokens: null }); break;
      default: break; // patch, snapshot, agent, … : not part of what the model saw
    }
  }
  return items;
}

function conversationItems(db, sessionId) {
  const items = [];
  for (const message of messagesOf(db, sessionId)) {
    const ts = iso(message.data.time?.created ?? message.time_created);
    const parts = partsOf(db, message.id);
    if (message.data.role === 'user') items.push(...userItems(message, parts, ts));
    else if (message.data.summary === true) {
      const text = parts.map(({ data: part }) => (part.type === 'text' ? part.text : '')).join('\n').trim();
      if (text) items.push({ kind: 'summary', ts, text: clipText(text) });
    } else items.push(...assistantItems(message, parts, ts));
  }
  return items;
}

// the task call that started a child session: its part names the child (state.metadata.sessionId)
function taskCallOf(db, parentId, childId) {
  for (const { data: part } of db.prepare("SELECT data FROM part WHERE session_id = ? AND data LIKE '%\"tool\":\"task\"%'").all(parentId).map(parseRow).filter(Boolean)) {
    if (part.state?.metadata?.sessionId === childId) return { id: part.callID || null, type: part.state?.input?.subagent_type || null, description: part.state?.input?.description || null };
  }
  return { id: null, type: null, description: null };
}

function subagentContexts(db, sessionId) {
  const subagents = {};
  for (const child of db.prepare('SELECT id, title FROM session WHERE parent_id = ? ORDER BY time_created').all(sessionId)) {
    const call = taskCallOf(db, sessionId, child.id);
    subagents[child.id] = {
      type: call.type, description: call.description || child.title || null, toolUseId: call.id,
      system: null, tools: null, instructions: [], items: conversationItems(db, child.id),
    };
  }
  return subagents;
}

// the instruction files the plugin found in the system prompt (AGENTS.md, CLAUDE.md, …), the latest of each. A file
// in the session's folder is the project's; OpenCode's global ones get no label (the view's "global" means ~/.claude).
function recordedInstructionFiles(session) {
  const files = new Map();
  const cwd = (session.cwd || '').replace(/\\/g, '/').toLowerCase();
  for (const event of session.events || []) {
    const data = event.data || {};
    if (event.event !== 'InstructionsLoaded' || data.from !== 'system prompt' || typeof data.content !== 'string') continue;
    const inProject = cwd && String(data.file_path).replace(/\\/g, '/').toLowerCase().startsWith(cwd + '/');
    files.set(data.file_path, { path: data.file_path, type: inProject ? 'Project' : null, content: clipText(data.content) });
  }
  return [...files.values()];
}

// the system prompt the plugin recorded last for this session
function recordedSystemPrompt(session) {
  const events = (session.events || []).filter(event => event.event === 'InstructionsLoaded' && typeof event.data?.system_prompt === 'string');
  const text = events.at(-1)?.data.system_prompt;
  return text ? clipText(text) : null;
}

function opencodeSessionContext(session) {
  const file = databasePathOf(session);
  const { db, error } = openDatabase(file);
  if (error) return { error, transcript: file };
  try {
    if (!db.prepare('SELECT id FROM session WHERE id = ?').get(session.id)) return { error: 'session not in the OpenCode database', transcript: file };
    return {
      session: session.id, agent: 'opencode', transcript: file, model: session.model, context: session.context,
      window: session.context?.window || null,
      // (tools: the database doesn't keep their definitions; a list, as the view expects one beside a system prompt)
      system: recordedSystemPrompt(session), tools: [], instructions: recordedInstructionFiles(session), skills: null, agents: null, mcp: null,
      items: conversationItems(db, session.id),
      subagents: subagentContexts(db, session.id),
      wire: null,
      measured: null,
    };
  } catch (readError) {
    return { error: `OpenCode database could not be read (${readError.message})`, transcript: file };
  } finally {
    db.close();
  }
}

module.exports = { opencodeSessionContext, databasePathOf };
