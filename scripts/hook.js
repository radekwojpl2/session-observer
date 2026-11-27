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
const DEFAULT_AGENT = 'claude';
// which agent sent the event: Codex's hook commands pass --agent codex, Claude Code's pass nothing. Only an agent the
// registry knows counts (loaded here, not at the top: a missing or broken module must not make the hook fail).
function agentFromArguments(args) {
  const flag = args.indexOf('--agent');
  const named = flag >= 0 ? args[flag + 1] : null;
  try { return named && require('../server/lib/features/agents/registry').isKnownAgent(named) ? named : DEFAULT_AGENT; } catch { return DEFAULT_AGENT; }
}

// loaded when needed, not at the top: a missing or broken module must not make the hook fail
const recorderModule = () => require('../server/lib/building-blocks/event-recorder');

// where each agent puts its session id in the commands it runs (its manifest's parentEnv)
function parentSources() {
  const { AGENT_IDS, agentById } = require('../server/lib/features/agents/registry');
  return AGENT_IDS.map(id => ({ agent: id, ...agentById(id).parentEnv })).filter(source => source.session);
}

// the agent sessions this one was started from, as its environment shows (see event-recorder.js)
function parentSessions(ownId, env = process.env) {
  return recorderModule().parentsFromEnvironment(ownId, env, null, parentSources());
}

// Appends one event to its session's log and returns it. Hook commands call it with the agent's payload; an agent's
// in-process plugin calls it with an event it translated. `extraParents`: sessions known to have started this one.
// owner-only: the log holds prompts, file contents and command output (mode applies when created; no-op on Windows)
// one file per session, in the folder of the UTC day it was last active (moved there by its first event of the day)
function recordEvent(payload, eventName, agent, extraParents = [], native = null) {
  const recorder = recorderModule().createRecorder({ agent: agent || DEFAULT_AGENT, logDir: SESSION_LOG_DIR, parentSources: parentSources() });
  return recorder.record(eventName, payload, { sessionId: payload && payload.session_id, parents: extraParents, native });
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

// starts the dashboard server in the background unless it already runs (or autostart is off). `node`: the Node to
// run it with: this process's own, unless an in-process plugin runs on another runtime (Bun) and passes 'node'
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
  child.on('error', () => {}); // no Node there: no dashboard, but never a crash
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
  if (event && event.event === 'SessionStart') await ensureServer();
}

if (require.main === module) main().catch(() => {}).finally(() => process.exit(0));

module.exports = { parentSessions, recordEvent, ensureServer };
