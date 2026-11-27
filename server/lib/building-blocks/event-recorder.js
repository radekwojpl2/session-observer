// The one way an event gets into the log. scripts/hook.js writes Claude Code's and Codex's hook events through it,
// and an agent's in-process plugin writes its translated events through it. It stamps the contract version, keeps
// the agent's own event as `native` when one is given, cuts long fields, links the sessions this one was started
// from, and never throws: an observer error must never reach the agent.
'use strict';
const { CONTRACT_VERSION } = require('./event-contract');
const { appendSessionEvent } = require('./session-logs');

const MAX_ARRAY_ITEMS = 200;
const MAX_DEPTH = 8;
const maxString = () => Number(process.env.OBSERVER_MAX_FIELD || 8000); // chars kept per string field

// the value with long strings and arrays cut short, so one huge tool output can't bloat the log
function truncate(value, depth = 0, limit = maxString()) {
  if (typeof value === 'string') {
    return value.length > limit ? value.slice(0, limit) + `… [+${value.length - limit} chars]` : value;
  }
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map(item => truncate(item, depth + 1, limit));
    if (value.length > MAX_ARRAY_ITEMS) items.push(`… [+${value.length - MAX_ARRAY_ITEMS} items]`);
    return items;
  }
  const truncated = {};
  for (const [key, item] of Object.entries(value)) truncated[key] = truncate(item, depth + 1, limit);
  return truncated;
}

// the agent sessions this one was started from, as its environment shows. Each agent puts its session id (and maybe
// the tool call's) into every command it runs, in the variables its manifest names (`sources`: [{ agent, session:
// [names], toolCall? }], from scripts/hook.js); an in-process plugin names the session it runs in
// (OBSERVER_PARENT_AGENT / OBSERVER_PARENT_SESSION). They carry on down a chain of agents, so a session can see
// several; the server takes the one that started last, its direct parent.
function parentsFromEnvironment(ownId, env = process.env, knownAgents = null, sources = []) {
  const parents = [];
  const add = (agent, sessionId, toolCallId) => {
    if (!sessionId || sessionId === ownId || parents.some(parent => parent.session_id === sessionId)) return;
    parents.push(toolCallId ? { agent, session_id: sessionId, tool_call_id: toolCallId } : { agent, session_id: sessionId });
  };
  for (const source of sources) {
    const sessionId = (source.session || []).map(name => env[name]).find(Boolean);
    add(source.agent, sessionId, source.toolCall ? env[source.toolCall] : undefined);
  }
  const pluginAgent = env.OBSERVER_PARENT_AGENT;
  if (pluginAgent && (!knownAgents || knownAgents.has(pluginAgent))) add(pluginAgent, env.OBSERVER_PARENT_SESSION);
  return parents;
}

// `agent`: who sends the events; `logDir`: the sessions folder; `env` and `parentSources`: where to look for the
// sessions that started this one (see parentsFromEnvironment)
function createRecorder({ agent, logDir, env = process.env, parentSources = [], append = appendSessionEvent }) {
  // writes one event and returns it (null when writing failed). `sessionId`: its session; `native`: the agent's own
  // event as `{ event, data }`, kept beside the translation; `parents`: sessions known to have started this one
  function record(eventName, data, { sessionId, native = null, parents = [], ts = null } = {}) {
    try {
      const id = sessionId || (data && data.session_id) || 'unknown';
      const event = {
        ts: ts || new Date().toISOString(),
        event: eventName,
        session_id: id,
        agent,
        v: CONTRACT_VERSION,
        data: truncate(data && typeof data === 'object' ? data : {}),
      };
      if (native) event.native = truncate(native);
      const linked = parentsFromEnvironment(id, env, null, parentSources);
      for (const parent of parents) {
        if (parent && parent.session_id && parent.session_id !== id && !linked.some(known => known.session_id === parent.session_id)) linked.push(parent);
      }
      if (linked.length) event.parents = linked;
      append(logDir, id, event.ts, JSON.stringify(event) + '\n');
      return event;
    } catch {
      return null;
    }
  }

  // the contract's events by name, for translations: each takes the session id, the contract fields, and options
  // ({ native, parents, ts }); fields the contract doesn't name are kept as they are
  const named = eventName => (sessionId, fields = {}, options = {}) => record(eventName, { ...fields, session_id: sessionId, hook_event_name: eventName }, { ...options, sessionId });
  return {
    record,
    sessionStart: named('SessionStart'),
    prompt: (sessionId, prompt, fields = {}, options = {}) => named('UserPromptSubmit')(sessionId, { ...fields, prompt }, options),
    toolCall: named('PreToolUse'),
    toolResult: named('PostToolUse'),
    toolFailed: named('PostToolUseFailure'),
    permission: named('PermissionRequest'),
    subagentStart: named('SubagentStart'),
    subagentStop: named('SubagentStop'),
    modelStep: named('ModelStep'),
    modelText: named('ModelText'),
    instructions: named('InstructionsLoaded'),
    compact: (sessionId, phase, fields = {}, options = {}) => named(phase === 'post' ? 'PostCompact' : 'PreCompact')(sessionId, fields, options),
    stop: named('Stop'),
    sessionEnd: named('SessionEnd'),
    // an event of the agent's own with no match in the contract: kept under the name AgentEvent, as it came
    passThrough: (sessionId, nativeEvent, nativeData = {}, options = {}) =>
      record('AgentEvent', { session_id: sessionId, hook_event_name: 'AgentEvent', native_event: nativeEvent }, { ...options, sessionId, native: { event: nativeEvent, data: nativeData } }),
  };
}

module.exports = { createRecorder, parentsFromEnvironment, truncate };
