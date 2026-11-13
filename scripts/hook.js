#!/usr/bin/env node
// session-observer hook: receives any Claude Code hook event on stdin and
// appends it as one JSON line to the local event log. Never blocks Claude:
// it runs as an async hook, always exits 0, and swallows every error.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const net = require('net');

const DATA_DIR = process.env.OBSERVER_DATA_DIR || path.join(os.homedir(), '.claude', 'session-observer');
const LOG_FILE = path.join(DATA_DIR, 'events.jsonl');
const PORT = Number(process.env.OBSERVER_PORT || 4777);
const MAX_STR = Number(process.env.OBSERVER_MAX_FIELD || 8000); // chars kept per string field

function truncate(value, depth = 0) {
  if (typeof value === 'string') {
    return value.length > MAX_STR ? value.slice(0, MAX_STR) + `… [+${value.length - MAX_STR} chars]` : value;
  }
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const arr = value.slice(0, 200).map(v => truncate(v, depth + 1));
    if (value.length > 200) arr.push(`… [+${value.length - 200} items]`);
    return arr;
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = truncate(v, depth + 1);
  return out;
}

function portInUse(port) {
  return new Promise(resolve => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    sock.setTimeout(300);
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('timeout', () => { sock.destroy(); resolve(false); });
    sock.once('error', () => resolve(false));
  });
}

async function ensureServer() {
  if (process.env.OBSERVER_AUTOSTART === '0') return;
  if (await portInUse(PORT)) return;
  const server = path.join(__dirname, '..', 'server', 'server.js');
  const child = spawn(process.execPath, [server], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, OBSERVER_PORT: String(PORT), OBSERVER_DATA_DIR: DATA_DIR },
  });
  child.unref();
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = { raw }; }

  const event = {
    ts: new Date().toISOString(),
    event: payload.hook_event_name || process.argv[2] || 'Unknown',
    session_id: payload.session_id || 'unknown',
    data: truncate(payload),
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(LOG_FILE, JSON.stringify(event) + '\n');

  if (event.event === 'SessionStart') await ensureServer();
}

main().catch(() => {}).finally(() => process.exit(0));
