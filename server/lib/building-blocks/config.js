// Settings from the environment, and the files the server reads.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const SERVER_DIR = path.join(__dirname, '..', '..');

const PORT = Number(process.env.OBSERVER_PORT || 4777);
const HOST = process.env.OBSERVER_HOST || '127.0.0.1'; // local only by default
const DATA_DIR = process.env.OBSERVER_DATA_DIR || path.join(os.homedir(), '.claude', 'session-observer');
const LOG_FILE = path.join(DATA_DIR, 'events.jsonl');

const MAX_EVENTS_PER_SESSION = Number(process.env.OBSERVER_MAX_EVENTS || 5000);
const MAX_ALL_EVENTS = Number(process.env.OBSERVER_MAX_ALL_EVENTS || 10000);
const CONTEXT_WINDOW = Number(process.env.OBSERVER_CONTEXT_WINDOW || 200000);
// a Codex session's context window when Codex doesn't report one
const CODEX_CONTEXT_WINDOW = Number(process.env.OBSERVER_CODEX_CONTEXT_WINDOW || 272000);
// characters kept per text in the Context view, so one huge output can't stall the page
const CONTEXT_FIELD_MAX = Number(process.env.OBSERVER_CONTEXT_FIELD || 100000);
// a peer that isn't this machine needs this token (see request-guard.js)
const TOKEN = String(process.env.OBSERVER_TOKEN || '');
const EXTRA_ALLOWED_HOSTS = String(process.env.OBSERVER_ALLOWED_HOSTS || '')
  .split(',').map(host => host.trim().toLowerCase()).filter(Boolean);

const DASHBOARD_PAGE = path.join(SERVER_DIR, 'dashboard.html');
const DASHBOARD_ASSETS_DIR = path.join(SERVER_DIR, 'dashboard'); // the page's stylesheet and scripts

// this server's version, shown in the dashboard header: the server outlives plugin updates until it is restarted
function readPluginVersion() {
  try {
    const manifest = path.join(SERVER_DIR, '..', '.claude-plugin', 'plugin.json');
    return JSON.parse(fs.readFileSync(manifest, 'utf8')).version || null;
  } catch {
    return null;
  }
}
const VERSION = readPluginVersion();

module.exports = {
  PORT, HOST, DATA_DIR, LOG_FILE, MAX_EVENTS_PER_SESSION, MAX_ALL_EVENTS, CONTEXT_WINDOW, CODEX_CONTEXT_WINDOW, CONTEXT_FIELD_MAX,
  TOKEN, EXTRA_ALLOWED_HOSTS, DASHBOARD_PAGE, DASHBOARD_ASSETS_DIR, VERSION,
};
