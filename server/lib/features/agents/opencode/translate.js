// OpenCode's plugin hooks and bus events, as contract events. What maps, what passes through and what is dropped is
// in FIDELITY.md. No I/O here: `emit(eventName, sessionId, data, { native, parents, ts })` writes each event
// (capture/plugin.js passes the recorder), so tests feed it what OpenCode sends.
'use strict';

const AGENT = 'opencode';
// bus events that say nothing about a session's work, or repeat what a hook already said
const DROPPED = new Set([
  'server.connected', 'server.instance.disposed', 'installation.updated', 'installation.update-available',
  'plugin.added', 'catalog.updated', 'integration.updated', 'reference.updated',
  'lsp.client.diagnostics', 'lsp.updated', 'file.watcher.updated', 'vcs.branch.updated',
  'tui.prompt.append', 'tui.command.execute', 'tui.toast.show', 'pty.created', 'pty.updated', 'pty.exited', 'pty.deleted',
  'message.part.delta', // streaming text: the finished text comes in experimental.text.complete
  'message.updated', 'message.removed', 'message.part.removed', // the parts and steps carry what the dashboard shows
  'session.updated', 'session.status', 'session.diff', // repeats of the session and its file changes
  'session.next.agent.switched', 'session.next.model.switched',
  'permission.updated', 'permission.asked', // the permission.ask hook records the ask
]);

const textOfParts = parts => (Array.isArray(parts) ? parts : [])
  .filter(part => part && part.type === 'text' && !part.synthetic && typeof part.text === 'string')
  .map(part => part.text).join('\n').trim();

// a short, stable digest of a text, to record the system prompt only when it changes
function digestOf(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(16) + ':' + text.length;
}

// `databasePath`: where this OpenCode keeps its sessions (opencode.db), recorded so the Context view can read them
function createOpencodeTranslator({ emit, onFirstSession = () => {}, databasePath = null }) {
  const windows = new Map();       // session id → { window, model }, from chat.params
  const systemPrompts = new Map(); // session id → the system prompt last sent (experimental.chat.system.transform)
  const recordedPrompts = new Map(); // session id → digest of the system prompt last recorded
  const stepCalls = new Map();     // message id → { tools, ids }: the tool calls a step asked for
  const stepStarts = new Map();    // message id → when its step started (ISO)
  const seenParts = new Set();     // step-finish and failed tool parts already turned into events
  const answeredCalls = new Set(); // call ids whose result is recorded
  const taskCalls = new Map();     // session id → its latest task call id, which the next child session comes from
  const lastReplies = new Map();   // session id → the text the model wrote last
  const sessionsSeen = new Set();

  const send = (eventName, sessionId, data, options = {}) => {
    if (!sessionId) return null;
    return emit(eventName, sessionId, data, options);
  };

  function sessionCreated(info, native) {
    if (!info?.id) return;
    if (!sessionsSeen.size) onFirstSession();
    sessionsSeen.add(info.id);
    const parents = info.parentID ? [{ agent: AGENT, session_id: info.parentID, tool_call_id: taskCalls.get(info.parentID) || undefined }] : [];
    for (const parent of parents) if (!parent.tool_call_id) delete parent.tool_call_id;
    send('SessionStart', info.id, { source: 'startup', cwd: info.directory || null, title: info.title || null, opencode_version: info.version || null, opencode_db: databasePath }, { native, parents });
  }

  // a tool part as it changes: remember which step asked for the call, and record a failure no hook reports
  function toolPart(part, native) {
    const callId = part.callID;
    if (part.messageID && callId) {
      if (!stepCalls.has(part.messageID)) stepCalls.set(part.messageID, { tools: [], ids: [] });
      const calls = stepCalls.get(part.messageID);
      if (!calls.ids.includes(callId)) { calls.tools.push(part.tool); calls.ids.push(callId); }
    }
    const state = part.state || {};
    if (state.status !== 'error' || answeredCalls.has(callId) || seenParts.has(part.id)) return;
    seenParts.add(part.id);
    answeredCalls.add(callId);
    send('PostToolUseFailure', part.sessionID, { tool_name: part.tool, tool_input: state.input || {}, tool_use_id: callId, error: state.error || 'failed' }, { native });
  }

  // a finished model call: its tokens, the window it ran in, and the tool calls it asked for
  function stepFinish(part, native) {
    if (seenParts.has(part.id)) return;
    seenParts.add(part.id);
    const tokens = part.tokens || {};
    const cache = tokens.cache || {};
    const known = windows.get(part.sessionID) || {};
    const calls = stepCalls.get(part.messageID) || { tools: [], ids: [] };
    stepCalls.delete(part.messageID);
    const count = value => (Number.isFinite(value) ? value : 0);
    send('ModelStep', part.sessionID, {
      model: known.model || null,
      stop_reason: part.reason || null,
      subagent: false, // a subagent is a session of its own
      agent_id: null,
      msg_id: part.messageID || null,
      tools: calls.tools,
      tool_ids: calls.ids,
      tokens: {
        input: count(tokens.input), output: count(tokens.output) + count(tokens.reasoning),
        cache_read: count(cache.read), cache_write: count(cache.write),
        context: count(tokens.input) + count(cache.read) + count(cache.write),
      },
      model_context_window: known.window || null,
      cost: Number.isFinite(part.cost) ? part.cost : null,
    }, { native, ts: stepStarts.get(part.messageID) || null });
    stepStarts.delete(part.messageID);
  }

  function partUpdated(properties, native) {
    const part = properties?.part;
    if (!part) return;
    if (part.type === 'tool') toolPart(part, native);
    else if (part.type === 'step-start' && part.messageID && !stepStarts.has(part.messageID)) stepStarts.set(part.messageID, new Date().toISOString());
    else if (part.type === 'step-finish') stepFinish(part, native);
  }

  function busEvent(event) {
    const type = event?.type;
    const properties = event?.properties || {};
    if (!type || DROPPED.has(type)) return;
    const native = { event: type, data: properties };
    const sessionId = properties.sessionID || properties.info?.id || properties.part?.sessionID;
    switch (type) {
      case 'session.created': return sessionCreated(properties.info, native);
      case 'message.part.updated': return partUpdated(properties, native);
      case 'session.idle': return send('Stop', sessionId, { last_assistant_message: lastReplies.get(sessionId) || null }, { native });
      case 'session.error': {
        const error = properties.error;
        return send('StopFailure', sessionId, { error: error?.data?.message || error?.name || 'error' }, { native });
      }
      case 'session.compacted': return send('PostCompact', sessionId, { trigger: 'auto' }, { native });
      case 'session.deleted': return send('SessionEnd', sessionId, { reason: 'deleted' }, { native });
      default: return sessionId ? send('AgentEvent', sessionId, { native_event: type }, { native }) : null;
    }
  }

  return {
    event: busEvent,

    // your prompt (a child session's comes from the task call that started it)
    chatMessage(input, output) {
      const prompt = textOfParts(output?.parts);
      send('UserPromptSubmit', input?.sessionID, { prompt, model: input?.model?.modelID || null, opencode_agent: input?.agent || null },
        { native: { event: 'chat.message', data: { input, output: { message: output?.message } } } });
    },

    // the model and window of the call about to be made; its system prompt, recorded when it changes. The title
    // generator's call (agent "title") is OpenCode's own housekeeping and is left out.
    chatParams(input) {
      if (!input?.sessionID || input.agent === 'title') return;
      const limit = input.model?.limit?.context;
      windows.set(input.sessionID, { window: Number.isFinite(limit) && limit > 0 ? limit : null, model: input.model?.id || null });
      const system = systemPrompts.get(input.sessionID);
      if (!system) return;
      const digest = digestOf(system);
      if (recordedPrompts.get(input.sessionID) === digest) return;
      recordedPrompts.set(input.sessionID, digest);
      send('InstructionsLoaded', input.sessionID, { file_path: 'system prompt', system_prompt: system, system_prompt_chars: system.length, digest },
        { native: { event: 'experimental.chat.system.transform', data: { parts: 1 } } });
    },

    systemTransform(input, output) {
      if (input?.sessionID && Array.isArray(output?.system)) systemPrompts.set(input.sessionID, output.system.join('\n\n'));
    },

    toolBefore(input, output) {
      if (input?.tool === 'task' && input.sessionID) taskCalls.set(input.sessionID, input.callID);
      send('PreToolUse', input?.sessionID, { tool_name: input?.tool, tool_input: output?.args ?? {}, tool_use_id: input?.callID || null },
        { native: { event: 'tool.execute.before', data: { input, output } } });
    },

    toolAfter(input, output) {
      if (input?.callID) answeredCalls.add(input.callID);
      send('PostToolUse', input?.sessionID, {
        tool_name: input?.tool, tool_input: input?.args ?? {}, tool_use_id: input?.callID || null,
        tool_response: output?.output ?? null, title: output?.title || null,
        child_session_id: output?.metadata?.sessionId || null, // a task call's subagent session
      }, { native: { event: 'tool.execute.after', data: { input, output } } });
    },

    permissionAsk(input) {
      send('PermissionRequest', input?.sessionID, { tool_name: input?.type || null, tool_input: input?.metadata || {}, title: input?.title || null, tool_use_id: input?.callID || null },
        { native: { event: 'permission.ask', data: input } });
    },

    textComplete(input, output) {
      const text = typeof output?.text === 'string' ? output.text.trim() : '';
      if (!text || !input?.sessionID) return;
      lastReplies.set(input.sessionID, text);
      send('ModelText', input.sessionID, { kind: 'text', text: text.length > 2000 ? text.slice(0, 2000) + '…' : text, msg_id: input.messageID || null, subagent: false, agent_id: null },
        { native: { event: 'experimental.text.complete', data: { input } } });
    },

    compacting(input) {
      send('PreCompact', input?.sessionID, { trigger: 'auto' }, { native: { event: 'experimental.session.compacting', data: input } });
    },

    // commands OpenCode runs see the session they run in: a session they start (claude -p, codex exec) links to it
    shellEnv(input, output) {
      if (!input?.sessionID || !output?.env) return;
      output.env.OBSERVER_PARENT_AGENT = AGENT;
      output.env.OBSERVER_PARENT_SESSION = input.sessionID;
    },

    // OpenCode is closing: every session it ran ends
    dispose() {
      for (const sessionId of sessionsSeen) send('SessionEnd', sessionId, { reason: 'exit' });
      sessionsSeen.clear();
    },
  };
}

module.exports = { createOpencodeTranslator, DROPPED };
