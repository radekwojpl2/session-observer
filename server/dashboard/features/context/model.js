'use strict';
// Session Observer dashboard — Context view, its data: one session's whole conversation, read in full from its
// transcript through /api/context (the hook log's fields are cut short). It is fetched while the view is open, again
// when the session changes, and rendered once per change (the result is cached as HTML).
const contextView = {
  sessionId: null, version: null, fetchedAt: 0, loading: false,
  data: null, error: null,
  html: '', renderKey: '', // the last render, and what it was made from
};
const openContextCards = new Set();       // ids of the cards you opened ("-id": a card that starts open, closed by you)
const collapsedContextTurns = new Set();  // ids of the turns you collapsed
// which messages the view shows (the values are also the saved setting and the buttons' data-cxm)
const CONTEXT_RANGE = { wholeSession: 'all', sinceCompaction: 'now' };
let contextRange = storage.get(SETTING_KEYS.contextRange) === CONTEXT_RANGE.sinceCompaction ? CONTEXT_RANGE.sinceCompaction : CONTEXT_RANGE.wholeSession;
// 'new' = newest message on top · 'old' = oldest on top, as the model reads it
let contextOrder = storage.get(SETTING_KEYS.contextOrder, 'new');
// show bookkeeping: attachments Claude Code keeps for itself and never sends
let showBookkeeping = storage.get(SETTING_KEYS.contextBookkeeping, '0') === '1';
let contextScroll = { sessionId: null, fromBottom: 0, atTop: true };

// the session the view shows: the selected one, or the only one there is
function contextSessionId() {
  if (state.scope !== ALL_SESSIONS) return state.scope;
  return state.sessions.size === 1 ? [...state.sessions.keys()][0] : null;
}

function fetchContext(sessionId, version) {
  if (contextView.loading) return;
  contextView.loading = true;
  const loaded = fields => Object.assign(contextView, { sessionId, version, fetchedAt: Date.now(), renderKey: '', ...fields });
  fetch('/api/context?session=' + encodeURIComponent(sessionId))
    .then(response => response.json())
    .then(data => {
      if (sessionId !== contextView.sessionId) {
        contextScroll = { sessionId, fromBottom: 0, atTop: true };
        openContextCards.clear();
        collapsedContextTurns.clear();
      }
      loaded({ data: data.error ? null : data, error: data.error || null });
    })
    .catch(error => loaded({ data: null, error: String(error.message || error) }))
    .finally(() => { contextView.loading = false; viewNeedsDrawing = true; });
}

// ---- sizes
// characters per token: measured for this session from its first model step when the transcript allows, else about 4
const charsPerToken = () => contextView.data?.measured?.cpt || 4;
const approxTokensLabel = chars => TEXT.approxTokens(formatCompactNumber(Math.round(chars / charsPerToken())));
const textLength = text => String(text ?? '').length;
const callInputLength = call => textLength(JSON.stringify(call.input ?? {}));
// One size for a tool definition, used by both the Tool definitions card and Context usage (the measured characters
// per token already blends prose and JSON, so no separate rate for schemas).
const toolDefinitionLength = tool => textLength(tool.name) + textLength(tool.description) + textLength(JSON.stringify(tool.schema));
const listingLength = list => (list || []).reduce((sum, entry) => sum + textLength(entry.name) + textLength(entry.description) + 4, 0);
const deferredNamesLength = deferred => (deferred?.tools || []).reduce((sum, tool) => sum + textLength(tool.name) + 1, 0);
// a deferred tool is loaded when ToolSearch surfaced it, or when its definition is in the request's tools
const isDeferredToolLoaded = (context, tool) => tool.loaded || !!context.tools?.some(defined => defined.name === tool.name);
// "mcp__server__tool" → [server, tool]
const splitMcpToolName = name => { const match = /^mcp__(.+?)__(.+)$/.exec(name); return match ? [match[1], match[2]] : null; };

// a context size for a badge (see contextSize in features/events/model/context-window.js)
function contextSizeInfo(tokens, change, cached = null) {
  const data = contextView.data;
  // the largest step of the session picks the window, so every badge uses the same scale
  const largest = Math.max(tokens, ...(data?.items || []).filter(item => item.kind === 'step').map(step => step.ctx || 0));
  const window = data?.window || contextWindowFor(data?.agent, data?.context?.window, largest);
  return contextSize(tokens, change, window, change ? signedTokens(change) : '', cached);
}

// ---- items
const itemSearchText = item => (item._search ??= [item.text, item.name, item.label, item.input && JSON.stringify(item.input), item.result?.text].filter(Boolean).join(' ').toLowerCase());

// Link each tool call and its result (the call shows the result's state, the result the call's name), and hang each
// subagent under the call that started it. Results stay where they are: in the user message after the call.
function pairCallsAndResults(items, subagents) {
  const resultById = new Map(items.filter(item => item.kind === 'result').map(item => [item.id, item]));
  const callById = new Map(items.filter(item => item.kind === 'call').map(item => [item.id, item]));
  const subagentByToolUse = new Map(Object.entries(subagents || {}).filter(([, subagent]) => subagent.toolUseId).map(([id, subagent]) => [subagent.toolUseId, { id, ...subagent }]));
  return items.map(item => {
    if (item.kind === 'result') {
      const call = callById.get(item.id);
      return call ? { ...item, call } : { ...item, kind: 'orphan' };
    }
    if (item.kind !== 'call') return item;
    const result = resultById.get(item.id) || null;
    const subagent = subagentByToolUse.get(item.id) || (result?.agentId && subagents?.[result.agentId] ? { id: result.agentId, ...subagents[result.agentId] } : null);
    return { ...item, result, sub: subagent ? { ...subagent, items: pairCallsAndResults(subagent.items, null) } : null };
  });
}

// the items the view shows: the whole session, or since the last compaction
function itemsInRange(data) {
  let items = pairCallsAndResults(data.items, data.subagents);
  const lastCompaction = items.map(item => item.kind).lastIndexOf('compact');
  if (contextRange === CONTEXT_RANGE.sinceCompaction && lastCompaction >= 0) items = items.slice(lastCompaction);
  return { items, compacted: lastCompaction >= 0 };
}

// ---- matching the transcript with the hook log
// The transcript and the hook log are two records of the same session; a message finds its hook events by tool call
// id (PreToolUse for a call, PostToolUse for its result), else by time: the last event of the session at or before it.
let hookIndexCache = { eventCount: -1, sessionId: null };

function hookEventIndex() {
  const sessionId = contextView.sessionId;
  if (hookIndexCache.sessionId === sessionId && hookIndexCache.eventCount === state.events.length) return hookIndexCache;
  const seqByToolUse = new Map(), timeline = [];
  for (const event of state.events) {
    if (event.session_id !== sessionId || !turnBySeq.has(event.seq)) continue;
    const toolUseId = event.data?.tool_use_id;
    if (toolUseId) {
      const key = (event.event === 'PreToolUse' ? 'call:' : 'result:') + toolUseId;
      if (!seqByToolUse.has(key)) seqByToolUse.set(key, event.seq); // the first one
    }
    timeline.push([eventTime(event), event.seq]);
  }
  timeline.sort((a, b) => a[0] - b[0]);
  return (hookIndexCache = { eventCount: state.events.length, sessionId, seqByToolUse, timeline });
}

const CLOCK_SLACK_MS = 1000; // the transcript and the hook log are written a moment apart

// the last [time, seq] at or before a time (binary search), or null
function lastEventAtOrBefore(timeline, time) {
  let low = 0, high = timeline.length - 1, best = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (timeline[middle][0] <= time) { best = middle; low = middle + 1; } else high = middle - 1;
  }
  return best == null ? null : timeline[best];
}

function hookSeqsOfMessage(message) {
  const index = hookEventIndex(), seqs = [];
  for (const item of message.items || []) {
    const seq = item.kind === 'call' ? index.seqByToolUse.get('call:' + item.id) : item.kind === 'result' ? index.seqByToolUse.get('result:' + item.id) : null;
    if (seq != null) seqs.push(seq);
  }
  const ts = message.step?.ts || message.ts;
  if (!seqs.length && ts && index.timeline.length) {
    const match = lastEventAtOrBefore(index.timeline, Date.parse(ts) + CLOCK_SLACK_MS);
    if (match) seqs.push(match[1]);
  }
  return seqs;
}

// A row clicked in Details: scroll the Context view to its message and flash it. A tool row finds the message with
// its call (else its result); any other event the last message at or before it.
function focusContextMessage(seqs, ts) {
  const messages = [...viewBox().querySelectorAll('.cxs > .cxturn > .cxw')];
  if (!messages.length) return;
  let target = null;
  for (const seq of seqs) if (!target && seq) target = messages.find(message => (message.dataset.seqs || '').split(' ').includes(String(seq)));
  if (!target && ts) {
    const time = Date.parse(ts) + CLOCK_SLACK_MS;
    let latest = -1;
    for (const message of messages) {
      const messageTime = Number(message.dataset.t);
      if (messageTime <= time && messageTime > latest) { latest = messageTime; target = message; }
    }
  }
  if (!target) return;
  const collapsedTurn = target.closest('.cxturn.shut');
  if (collapsedTurn) setContextTurnCollapsed(collapsedTurn, false); // a row in a collapsed turn opens it
  const scroller = target.closest('.cxs'); // scroll only the view's own box, not the page
  scroller.scrollTo({ top: scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8, behavior: 'smooth' });
  for (const message of messages) message.classList.remove('flash');
  void target.offsetWidth; // restart the flash animation
  target.classList.add('flash');
}

let lastContextClickAt = 0; // a click inside the Context view picks a turn where you already are: don't jump to it
