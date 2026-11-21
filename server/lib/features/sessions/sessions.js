// The sessions held in memory: each one's events and running totals, updated as events arrive.
'use strict';
const fs = require('fs');
const path = require('path');
const { MAX_EVENTS_PER_SESSION, MAX_ALL_EVENTS } = require('../../building-blocks/config');
const { categoryOf, SUBAGENT_TOOLS } = require('./event-categories');
const { trackNeedsYou } = require('./needs-you');
const { trackSubagents } = require('./subagent-list');

const TITLE_MAX = 140; // characters of the first prompt kept as the session's title
const sessions = new Map(); // session id → session
let lastSeq = 0;
const DEFAULT_AGENT = 'claude'; // events logged before the hook named its agent came from Claude Code

function newSession(id) {
  return {
    id, agent: DEFAULT_AGENT, cwd: null, started: null, last: null, ended: false, endReason: null,
    model: null, permission_mode: null, transcript_path: null, source: null,
    title: null, turns: 0, busy: false, subagents: 0, lastTool: null, promptAt: null,
    counts: {}, tools: {}, skills: {}, mcp: {}, agents: {},
    toolMs: 0, toolCalls: 0, failures: 0, modelSteps: 0,
    usage: { input: 0, output: 0, cache_read: 0, cache_write: 0, turns: 0, models: {} },
    context: null,
    needsYou: [],     // what it waits on you for: [{ kind: permission | question | mcp, tool, text, since, agentId }]
    subagentList: [], // [{ id, type, description, started, ended }]
    events: [],
    pendingToolStarts: new Map(), // tool_use_id → when the call started (ms), until its result arrives
    subagentDescriptionsWaiting: [], // what each subagent call asked, until its SubagentStart
  };
}

function sessionFor(id) {
  let session = sessions.get(id);
  if (!session) {
    session = newSession(id);
    sessions.set(id, session);
  }
  return session;
}

const increment = (counts, key) => { counts[key] = (counts[key] || 0) + 1; };

// the most telling argument of a tool call, for the sessions list's "last:" line
function mainToolArgument(data) {
  const input = data.tool_input || {};
  return input.command || input.file_path || input.path || input.pattern || input.url || input.query || input.skill || input.description || '';
}

// events almost always arrive in order; model steps from the transcript can be slightly late
function insertByTime(events, event) {
  let index = events.length;
  while (index > 0 && events[index - 1].ts > event.ts) index--;
  events.splice(index, 0, event);
}

function updateSessionFields(session, event, data) {
  if (!session.started || event.ts < session.started) session.started = event.ts;
  if (!session.last || event.ts > session.last) session.last = event.ts;
  if (data.cwd) session.cwd = data.cwd;
  // a subagent's events carry the main transcript too: it is taken only while the session has none
  if (data.transcript_path && (!data.agent_transcript_path || !session.transcript_path)) session.transcript_path = data.transcript_path;
  if (data.permission_mode) session.permission_mode = data.permission_mode;
  // a subagent's model request names the subagent's model, not the session's
  if (data.model && data.agent_id == null) session.model = typeof data.model === 'string' ? data.model : (data.model.id || data.model.display_name || session.model);
  if (data.to_model) session.model = data.to_model;
}

function updateLifecycle(session, event, data) {
  switch (event.event) {
    case 'SessionStart':
      session.ended = false;
      session.source = data.source || session.source;
      break;
    case 'SessionEnd':
      session.ended = true;
      session.busy = false;
      session.endReason = data.reason || null;
      session.pendingToolStarts.clear();
      break;
    case 'UserPromptSubmit':
      session.turns++;
      session.busy = true;
      if (!session.promptAt || event.ts > session.promptAt) session.promptAt = event.ts;
      if (!session.title && data.prompt) session.title = String(data.prompt).replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
      break;
    case 'Stop':
    case 'StopFailure':
      session.busy = false;
      session.pendingToolStarts.clear();
      break;
    case 'Interrupt':
      // read from the transcript, which can come after later prompts (a restart reads it all again): an older
      // interrupt ends nothing that runs now
      if (session.promptAt && event.ts < session.promptAt) break;
      session.busy = false;
      session.pendingToolStarts.clear();
      break;
    case 'SubagentStart': session.subagents++; break;
    case 'ModelStep': session.modelSteps++; break;
  }
}

function countToolCall(session, event, data) {
  const tool = data.tool_name;
  const input = data.tool_input;
  session.toolCalls++;
  increment(session.tools, tool);
  session.lastTool = { name: tool, arg: String(mainToolArgument(data)).slice(0, 200), ts: event.ts };
  if (tool === 'Skill') increment(session.skills, (input && (input.skill || input.name)) || '?');
  if (tool.startsWith('mcp__')) increment(session.mcp, tool.split('__')[1] || '?');
  if (SUBAGENT_TOOLS.has(tool)) increment(session.agents, (input && (input.subagent_type || input.description)) || tool);
  if (data.tool_use_id) session.pendingToolStarts.set(data.tool_use_id, Date.parse(event.ts));
}

// a tool result: how long the call took, from its PreToolUse
function timeToolResult(session, event, data) {
  const startedAt = session.pendingToolStarts.get(data.tool_use_id);
  if (!startedAt) return;
  event.duration_ms = Date.parse(event.ts) - startedAt;
  session.toolMs += event.duration_ms;
  session.pendingToolStarts.delete(data.tool_use_id);
}

// takes one event into its session; returns the session
function ingest(event) {
  event.seq = ++lastSeq;
  event.category = categoryOf(event);
  const data = event.data || {};
  const session = sessionFor(event.session_id);
  // every event says which agent it is from: the hook's own, or its session's (for events made from a transcript)
  if (event.agent) session.agent = event.agent;
  else event.agent = session.agent;

  updateSessionFields(session, event, data);
  increment(session.counts, event.category);
  updateLifecycle(session, event, data);
  if (event.event === 'PreToolUse' && data.tool_name) countToolCall(session, event, data);
  if ((event.event === 'PostToolUse' || event.event === 'PostToolUseFailure') && data.tool_use_id) timeToolResult(session, event, data);
  if (event.category === 'error') session.failures++;
  trackNeedsYou(session, event, data);
  trackSubagents(session, event, data);

  insertByTime(session.events, event);
  if (session.events.length > MAX_EVENTS_PER_SESSION) session.events.splice(0, session.events.length - MAX_EVENTS_PER_SESSION);
  return session;
}

// Return a browser link only when the local project has a GitHub origin.
function githubRepository(cwd) {
  if (!cwd) return null;
  let directory = path.resolve(cwd);
  while (true) {
    let gitDirectory = path.join(directory, '.git');
    try {
      if (fs.statSync(gitDirectory).isFile()) {
        const pointer = fs.readFileSync(gitDirectory, 'utf8').match(/^gitdir:\s*(.+)$/m);
        if (!pointer) return null;
        gitDirectory = path.resolve(directory, pointer[1].trim());
      }
      const config = fs.readFileSync(path.join(gitDirectory, 'config'), 'utf8');
      const originSection = config.match(/^\[remote \"origin\"\]([^[]*)/m);
      const urlMatch = originSection && originSection[1].match(/^\s*url\s*=\s*(.+)\s*$/m);
      if (!urlMatch) return null;
      const remote = urlMatch[1].trim().replace(/^git@github\.com:/i, 'https://github.com/').replace(/\.git$/i, '');
      const url = new URL(remote);
      if (url.hostname.toLowerCase() !== 'github.com') return null;
      url.username = '';
      url.password = '';
      url.search = '';
      url.hash = '';
      return url.href.replace(/\/$/, '');
    } catch { /* try the parent when this folder is not a readable checkout */ }
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

// what the API sends for a session: everything but its events and the calls in flight
function sessionSummary(session) {
  const { events, pendingToolStarts, subagentDescriptionsWaiting, ...fields } = session;
  return { ...fields, repositoryUrl: githubRepository(fields.cwd), eventCount: events.length, running: pendingToolStarts.size };
}

const byTimeThenSeq = (a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.seq - b.seq);

// every session's events since a time (ISO string, or null for all), oldest first, at most MAX_ALL_EVENTS
function eventsOfAllSessions(since) {
  const events = [];
  for (const session of sessions.values()) {
    for (const event of session.events) if (!since || event.ts >= since) events.push(event);
  }
  events.sort(byTimeThenSeq);
  return events.length > MAX_ALL_EVENTS ? events.slice(events.length - MAX_ALL_EVENTS) : events;
}

module.exports = { sessions, ingest, sessionSummary, eventsOfAllSessions };
