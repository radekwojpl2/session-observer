#!/usr/bin/env node
// session-observer dashboard server. Zero dependencies.
// Tails ~/.claude/session-observer/events.jsonl, keeps sessions in memory,
// reads model steps + token usage from each session's transcript, serves the
// dashboard and pushes live updates over Server-Sent Events.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.OBSERVER_PORT || 4777);
const HOST = process.env.OBSERVER_HOST || '127.0.0.1'; // local only by default
const DATA_DIR = process.env.OBSERVER_DATA_DIR || path.join(os.homedir(), '.claude', 'session-observer');
const LOG_FILE = path.join(DATA_DIR, 'events.jsonl');
const MAX_EVENTS_PER_SESSION = Number(process.env.OBSERVER_MAX_EVENTS || 5000);
const MAX_ALL_EVENTS = Number(process.env.OBSERVER_MAX_ALL_EVENTS || 10000);
const CONTEXT_WINDOW = Number(process.env.OBSERVER_CONTEXT_WINDOW || 200000);
const DASHBOARD = path.join(__dirname, 'dashboard.html');

// ---------- classification ----------
const QUESTION_TOOLS = new Set(['AskUserQuestion']);
const SUBAGENT_TOOLS = new Set(['Agent', 'Task', 'SendMessage']);
const TASK_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TaskStop']);

function classify(ev) {
  const d = ev.data || {};
  const tool = d.tool_name || '';
  switch (ev.event) {
    case 'ModelStep': return 'model';
    case 'UserPromptSubmit':
    case 'UserPromptExpansion': return 'prompt';
    case 'PermissionRequest':
    case 'PermissionDenied': return 'permission';
    case 'PostToolUseFailure':
    case 'StopFailure': return 'error';
    case 'SubagentStart':
    case 'SubagentStop':
    case 'TeammateIdle': return 'subagent';
    case 'TaskCreated':
    case 'TaskCompleted': return 'task';
    case 'Notification':
    case 'MessageDisplay': return 'notification';
    case 'Elicitation':
    case 'ElicitationResult': return 'question';
    case 'PreCompact':
    case 'PostCompact': return 'compact';
    case 'InstructionsLoaded': return 'context';
    case 'SessionStart':
    case 'SessionEnd':
    case 'Setup':
    case 'Stop': return 'lifecycle';
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolBatch':
      if (tool === 'Skill') return 'skill';
      if (QUESTION_TOOLS.has(tool)) return 'question';
      if (SUBAGENT_TOOLS.has(tool)) return 'subagent';
      if (TASK_TOOLS.has(tool)) return 'task';
      if (tool.startsWith('mcp__')) return 'mcp';
      return 'tool';
    default: return 'env'; // ConfigChange, CwdChanged, FileChanged, Worktree*, model switches...
  }
}

// ---------- state ----------
const sessions = new Map(); // id -> session
let seq = 0;

function getSession(id) {
  let s = sessions.get(id);
  if (!s) {
    s = {
      id, cwd: null, started: null, last: null, ended: false, endReason: null,
      model: null, permission_mode: null, transcript_path: null, source: null,
      title: null, turns: 0, busy: false, subagents: 0, lastTool: null,
      counts: {}, tools: {}, skills: {}, mcp: {}, agents: {},
      toolMs: 0, toolCalls: 0, failures: 0, modelSteps: 0,
      usage: { input: 0, output: 0, cache_read: 0, cache_write: 0, turns: 0, models: {} },
      context: null,
      events: [], pending: new Map(),
    };
    sessions.set(id, s);
  }
  return s;
}

function toolArg(d) {
  const ti = d.tool_input || {};
  return ti.command || ti.file_path || ti.path || ti.pattern || ti.url || ti.query || ti.skill || ti.description || '';
}

function insertSorted(arr, ev) {
  // events almost always arrive in order; model steps from the transcript can be slightly late
  let i = arr.length;
  while (i > 0 && arr[i - 1].ts > ev.ts) i--;
  arr.splice(i, 0, ev);
}

function ingest(ev) {
  ev.seq = ++seq;
  ev.category = classify(ev);
  const d = ev.data || {};
  const s = getSession(ev.session_id);
  if (!s.started || ev.ts < s.started) s.started = ev.ts;
  if (!s.last || ev.ts > s.last) s.last = ev.ts;
  if (d.cwd) s.cwd = d.cwd;
  if (d.transcript_path && !d.agent_transcript_path) s.transcript_path = d.transcript_path;
  else if (d.transcript_path && !s.transcript_path) s.transcript_path = d.transcript_path;
  if (d.permission_mode) s.permission_mode = d.permission_mode;
  if (d.model) s.model = typeof d.model === 'string' ? d.model : (d.model.id || d.model.display_name || s.model);
  if (d.to_model) s.model = d.to_model;
  s.counts[ev.category] = (s.counts[ev.category] || 0) + 1;

  switch (ev.event) {
    case 'SessionStart': s.ended = false; s.source = d.source || s.source; break;
    case 'SessionEnd': s.ended = true; s.busy = false; s.endReason = d.reason || null; s.pending.clear(); break;
    case 'UserPromptSubmit':
      s.turns++; s.busy = true;
      if (!s.title && d.prompt) s.title = String(d.prompt).replace(/\s+/g, ' ').trim().slice(0, 140);
      break;
    case 'Stop': case 'StopFailure': s.busy = false; s.pending.clear(); break;
    case 'SubagentStart': s.subagents++; break;
    case 'ModelStep': s.modelSteps++; break;
  }

  const tool = d.tool_name;
  if (ev.event === 'PreToolUse' && tool) {
    s.toolCalls++;
    s.tools[tool] = (s.tools[tool] || 0) + 1;
    s.lastTool = { name: tool, arg: String(toolArg(d)).slice(0, 200), ts: ev.ts };
    if (tool === 'Skill') {
      const name = (d.tool_input && (d.tool_input.skill || d.tool_input.name)) || '?';
      s.skills[name] = (s.skills[name] || 0) + 1;
    }
    if (tool.startsWith('mcp__')) {
      const server = tool.split('__')[1] || '?';
      s.mcp[server] = (s.mcp[server] || 0) + 1;
    }
    if (SUBAGENT_TOOLS.has(tool)) {
      const t = (d.tool_input && (d.tool_input.subagent_type || d.tool_input.description)) || tool;
      s.agents[t] = (s.agents[t] || 0) + 1;
    }
    if (d.tool_use_id) s.pending.set(d.tool_use_id, Date.parse(ev.ts));
  }
  if ((ev.event === 'PostToolUse' || ev.event === 'PostToolUseFailure') && d.tool_use_id) {
    const start = s.pending.get(d.tool_use_id);
    if (start) {
      ev.duration_ms = Date.parse(ev.ts) - start;
      s.toolMs += ev.duration_ms;
      s.pending.delete(d.tool_use_id);
    }
  }
  if (ev.category === 'error') s.failures++;

  insertSorted(s.events, ev);
  if (s.events.length > MAX_EVENTS_PER_SESSION) s.events.splice(0, s.events.length - MAX_EVENTS_PER_SESSION);

  if (ev.event !== 'ModelStep' && s.transcript_path) scheduleTranscript(s);
  return s;
}

// ---------- model steps + token usage from the transcript ----------
// Hooks don't see individual model calls, so each assistant API response in the
// transcript (and subagent transcripts) becomes a synthetic "ModelStep" event.
const tails = new Map(); // file -> { offset, partial }
const seenMsgs = new Map(); // session id -> Set(message id)
const transcriptTimers = new Map();

function scheduleTranscript(s, delay = 700) {
  if (transcriptTimers.has(s.id)) return;
  transcriptTimers.set(s.id, setTimeout(() => {
    transcriptTimers.delete(s.id);
    try { readTranscripts(s); } catch { /* ignore */ }
  }, delay));
}

function readTail(file) {
  let stat;
  try { stat = fs.statSync(file); } catch { return []; }
  let t = tails.get(file);
  if (!t) { t = { offset: 0, partial: '' }; tails.set(file, t); }
  if (stat.size < t.offset) { t.offset = 0; t.partial = ''; }
  if (stat.size === t.offset) return [];
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(stat.size - t.offset);
  fs.readSync(fd, buf, 0, buf.length, t.offset);
  fs.closeSync(fd);
  t.offset = stat.size;
  const lines = (t.partial + buf.toString('utf8')).split('\n');
  t.partial = lines.pop();
  return lines;
}

function readTranscripts(s) {
  const main = s.transcript_path;
  if (!main) return;
  const files = [[main, false]];
  const subDir = path.join(path.dirname(main), path.basename(main, '.jsonl'), 'subagents');
  try { for (const f of fs.readdirSync(subDir)) if (f.endsWith('.jsonl')) files.push([path.join(subDir, f), true]); } catch { /* none */ }

  let seen = seenMsgs.get(s.id);
  if (!seen) { seen = new Set(); seenMsgs.set(s.id, seen); }
  const fresh = [];
  for (const [file, isSub] of files) {
    for (const line of readTail(file)) {
      if (!line) continue;
      let row; try { row = JSON.parse(line); } catch { continue; }
      const m = row.message;
      if (!m || m.role !== 'assistant' || !m.usage) continue;
      const key = m.id || row.uuid;
      if (key && seen.has(key)) continue; // one API response spans several lines
      if (key) seen.add(key);
      const u = m.usage;
      s.usage.input += u.input_tokens || 0;
      s.usage.output += u.output_tokens || 0;
      s.usage.cache_read += u.cache_read_input_tokens || 0;
      s.usage.cache_write += u.cache_creation_input_tokens || 0;
      s.usage.turns++;
      if (m.model) s.usage.models[m.model] = (s.usage.models[m.model] || 0) + 1;
      const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      if (!isSub && !row.isSidechain) {
        const window = /\[1m\]|-1m/i.test(m.model || s.model || '') || ctx > CONTEXT_WINDOW ? 1000000 : CONTEXT_WINDOW;
        s.context = { tokens: ctx, window, pct: Math.min(1, ctx / window), ts: row.timestamp };
      }
      const tools = Array.isArray(m.content) ? m.content.filter(c => c && c.type === 'tool_use').map(c => c.name) : [];
      const ev = {
        ts: row.timestamp || new Date().toISOString(),
        event: 'ModelStep',
        session_id: s.id,
        synthetic: true,
        data: {
          model: m.model, stop_reason: m.stop_reason, subagent: isSub || !!row.isSidechain,
          agent_id: row.agentId || null, tools,
          tokens: { input: u.input_tokens || 0, output: u.output_tokens || 0, cache_read: u.cache_read_input_tokens || 0, cache_write: u.cache_creation_input_tokens || 0, context: ctx },
        },
      };
      // keep model on the event without overwriting the session's model with a subagent's
      const keepModel = s.model;
      ingest(ev);
      if (isSub) s.model = keepModel;
      fresh.push(ev);
    }
  }
  if (initialLoadDone && fresh.length) {
    for (const ev of fresh) broadcast('event', ev);
    broadcast('session', summary(s));
  } else if (initialLoadDone) {
    broadcast('session', summary(s));
  }
}

function summary(s) {
  const { events, pending, ...rest } = s;
  return { ...rest, eventCount: events.length, running: pending.size };
}

// ---------- log tailing ----------
let offset = 0;
let partial = '';
function readNew() {
  let stat;
  try { stat = fs.statSync(LOG_FILE); } catch { return; }
  if (stat.size < offset) { offset = 0; partial = ''; } // file truncated / cleared
  if (stat.size === offset) return;
  const fd = fs.openSync(LOG_FILE, 'r');
  const buf = Buffer.alloc(stat.size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  offset = stat.size;
  const lines = (partial + buf.toString('utf8')).split('\n');
  partial = lines.pop();
  const touched = new Set();
  for (const line of lines) {
    if (!line.trim()) continue;
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    const s = ingest(ev);
    touched.add(s);
    if (initialLoadDone) broadcast('event', ev);
  }
  if (initialLoadDone) for (const s of touched) broadcast('session', summary(s));
}

// ---------- SSE ----------
const clients = new Set();
function broadcast(type, payload) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(msg);
}

// ---------- HTTP ----------
function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function allEvents(since) {
  const out = [];
  for (const s of sessions.values()) for (const e of s.events) if (!since || e.ts >= since) out.push(e);
  out.sort((a, b) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.seq - b.seq);
  return out.length > MAX_ALL_EVENTS ? out.slice(out.length - MAX_ALL_EVENTS) : out;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return fs.createReadStream(DASHBOARD).pipe(res);
  }
  if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (url.pathname === '/api/health') return json(res, 200, { ok: true, port: PORT, log: LOG_FILE, sessions: sessions.size });
  if (url.pathname === '/api/sessions') {
    const list = [...sessions.values()].map(summary).sort((a, b) => (b.last || '').localeCompare(a.last || ''));
    return json(res, 200, list);
  }
  if (url.pathname === '/api/events') {
    const id = url.searchParams.get('session');
    const since = url.searchParams.get('since') || null;
    if (id === 'all') return json(res, 200, allEvents(since));
    const s = sessions.get(id);
    if (!s) return json(res, 404, { error: 'unknown session' });
    return json(res, 200, since ? s.events.filter(e => e.ts >= since) : s.events);
  }
  if (url.pathname === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/clear' && req.method === 'POST') {
    try { fs.writeFileSync(LOG_FILE, ''); } catch { /* ignore */ }
    sessions.clear(); seenMsgs.clear(); tails.clear(); offset = 0; partial = '';
    broadcast('reset', {});
    return json(res, 200, { ok: true });
  }
  json(res, 404, { error: 'not found' });
});

let initialLoadDone = false;
fs.mkdirSync(DATA_DIR, { recursive: true });
readNew();
for (const t of transcriptTimers.values()) clearTimeout(t);
transcriptTimers.clear();
for (const s of sessions.values()) { try { readTranscripts(s); } catch { /* ignore */ } }
initialLoadDone = true;
setInterval(readNew, 400);
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 15000);
// live sessions: keep picking up model steps even between hook events
setInterval(() => { for (const s of sessions.values()) if (s.busy && s.transcript_path) scheduleTranscript(s, 0); }, 2000);

server.on('error', err => {
  if (err.code === 'EADDRINUSE') process.exit(0); // another instance already serves the dashboard
  console.error(err); process.exit(1);
});
server.listen(PORT, HOST, () => console.log(`Session Observer → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
