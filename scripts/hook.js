#!/usr/bin/env node
// session-observer hook: receives any Claude Code or Codex hook event on stdin and
// appends it as one JSON line to the local event log. Never blocks the agent:
// it runs as an async hook, always exits 0, and swallows every error.
// Usage: hook.js <EventName> [--agent codex]   (no --agent: Claude Code)
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const net = require('net');

const DATA_DIR = process.env.OBSERVER_DATA_DIR || path.join(os.homedir(), '.claude', 'session-observer');
const LOG_FILE = path.join(DATA_DIR, 'events.jsonl');
const PORT = Number(process.env.OBSERVER_PORT || 4777);
const MAX_STRING = Number(process.env.OBSERVER_MAX_FIELD || 8000); // chars kept per string field
const MAX_ARRAY_ITEMS = 200;
const MAX_DEPTH = 8;
const AGENTS = new Set(['claude', 'codex']);
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

function isPortInUse(port) {
  return new Promise(resolve => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.setTimeout(300);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.once('error', () => resolve(false));
  });
}

// starts the dashboard server in the background unless it already runs (or autostart is off)
async function ensureServer() {
  if (process.env.OBSERVER_AUTOSTART === '0') return;
  if (await isPortInUse(PORT)) return;
  const serverScript = path.join(__dirname, '..', 'server', 'server.js');
  const child = spawn(process.execPath, [serverScript], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, OBSERVER_PORT: String(PORT), OBSERVER_DATA_DIR: DATA_DIR },
  });
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

  const event = {
    ts: new Date().toISOString(),
    event: payload.hook_event_name || process.argv[2] || 'Unknown',
    session_id: payload.session_id || 'unknown',
    agent: agentFromArguments(process.argv.slice(2)),
    data: truncate(payload),
  };

  // owner-only: the log holds prompts, file contents and command output (mode applies when created; no-op on Windows)
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  fs.appendFileSync(LOG_FILE, JSON.stringify(event) + '\n', { mode: 0o600 });

  if (event.event === 'SessionStart') await ensureServer();
}

main().catch(() => {}).finally(() => process.exit(0));
