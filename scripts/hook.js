#!/usr/bin/env node
// session-observer hook: receives any Claude Code or Codex hook event on stdin and
// appends it as one JSON line to the local event log. Never blocks the agent:
// it runs as an async hook, always exits 0, and swallows every error.
// Usage: hook.js <EventName> [--agent codex]   (no --agent: Claude Code)
'use strict';
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const net = require('net');

const DATA_DIR = process.env.OBSERVER_DATA_DIR || path.join(os.homedir(), '.claude', 'session-observer');
const SESSION_LOG_DIR = path.join(DATA_DIR, 'sessions');
const PORT = Number(process.env.OBSERVER_PORT || 4777);
const MAX_STRING = Number(process.env.OBSERVER_MAX_FIELD || 8000); // chars kept per string field
const MAX_ARRAY_ITEMS = 200;
const MAX_DEPTH = 8;
// pi and omp (oh-my-pi) have no hook commands: their extension (pi-extension/) records events in its own process
const AGENTS = new Set(['claude', 'codex', 'pi', 'omp']);
const DEFAULT_AGENT = 'claude';
// which agent sent the event: Codex's hook commands pass --agent codex, Claude Code's pass nothing
function agentFromArguments(args) {
  const flag = args.indexOf('--agent');
  const named = flag >= 0 ? args[flag + 1] : null;
  return AGENTS.has(named) ? named : DEFAULT_AGENT;
}

// the payload with long strings and arrays cut short, so one huge tool output can't bloat the log
function truncate(value, depth = 0) {
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + `… [+${value.length - MAX_STRING} chars]` : value;
  }
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map(item => truncate(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) items.push(`… [+${value.length - MAX_ARRAY_ITEMS} items]`);
    return items;
  }
  const truncated = {};
  for (const [key, item] of Object.entries(value)) truncated[key] = truncate(item, depth + 1);
  return truncated;
}

// the agent sessions this one was started from, as its environment shows: Claude Code puts its session id into every
// command it runs, Codex its session id and the id of the tool call, and the pi / omp extension its main session's id
// (OBSERVER_PARENT_*). They carry on down a chain of agents, so a session can see several; the server takes the one
// that started last, its direct parent.
function parentSessions(ownId, env = process.env) {
  const parents = [];
  const add = (agent, sessionId, toolCallId) => {
    if (!sessionId || sessionId === ownId || parents.some(parent => parent.session_id === sessionId)) return;
    parents.push(toolCallId ? { agent, session_id: sessionId, tool_call_id: toolCallId } : { agent, session_id: sessionId });
  };
  add('codex', env.CODEX_SESSION_ID || env.CODEX_THREAD_ID, env.CODEX_TOOL_CALL_ID);
  add('claude', env.CLAUDE_CODE_SESSION_ID);
  if (AGENTS.has(env.OBSERVER_PARENT_AGENT)) add(env.OBSERVER_PARENT_AGENT, env.OBSERVER_PARENT_SESSION);
  return parents;
}

function isPortInUse(port) {
  return new Promise(resolve => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.setTimeout(300);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}

// starts the dashboard server in the background unless it already runs (or autostart is off). `node`: the Node to run
// it with, this process's own unless it is another runtime (omp runs on Bun)
async function ensureServer(node = process.execPath) {
  if (process.env.OBSERVER_AUTOSTART === '0') return;
  if (await isPortInUse(PORT)) return;
  const serverScript = path.join(__dirname, '..', 'server', 'server.js');
  const child = spawn(node, [serverScript], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, OBSERVER_PORT: String(PORT), OBSERVER_DATA_DIR: DATA_DIR },
  });
  child.on('error', () => {}); // no Node on PATH: no dashboard, but never a crash
  child.unref();
}

async function readStdin() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

async function main() {
  const input = await readStdin();
  let payload;
  try { payload = JSON.parse(input); } catch { payload = { raw: input }; }

  const eventName = payload.hook_event_name || process.argv[2] || 'Unknown';
  const event = recordEvent(payload, eventName, agentFromArguments(process.argv.slice(2)));
  if (event.event === 'SessionStart') await ensureServer();
}

// Appends one event to its session's log file and returns it. Also called by the pi / omp extension, in the agent's
// own process; `extraParents` are sessions it knows started this one (an omp subagent's orchestrator).
function recordEvent(payload, eventName, agent, extraParents = []) {
  const event = {
    ts: new Date().toISOString(),
    event: eventName,
    session_id: payload.session_id || 'unknown',
    agent: AGENTS.has(agent) ? agent : DEFAULT_AGENT,
    data: truncate(payload),
  };
  const parents = parentSessions(event.session_id);
  for (const parent of extraParents) {
    if (parent?.session_id && parent.session_id !== event.session_id && !parents.some(known => known.session_id === parent.session_id)) parents.push(parent);
  }
  if (parents.length) event.parents = parents;

  // owner-only: the log holds prompts, file contents and command output (mode applies when created; no-op on Windows)
  // one file per session, in the folder of the UTC day it was last active (moved there by its first event of the day)
  // loaded here, not at the top: a missing or broken module must not make the hook fail
  const { appendSessionEvent } = require('../server/lib/building-blocks/session-logs');
  appendSessionEvent(SESSION_LOG_DIR, event.session_id, event.ts, JSON.stringify(event) + '\n');
  return event;
}

if (require.main === module) main().catch(() => {}).finally(() => process.exit(0));

module.exports = { parentSessions, recordEvent, ensureServer };
