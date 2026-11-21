'use strict';
// Session Observer dashboard — data: loading the sessions and the events in scope, and live updates from the server.
const EVENTS_KEPT_MAX = 12000;
const RESENT_STEP_SEARCH_MAX = 4000; // how far back a re-sent model step is looked for

let latestLoad = 0; // a newer load makes an older one's answer stale

function eventsUrl() {
  if (state.scope !== ALL_SESSIONS) return `/api/events?session=${encodeURIComponent(state.scope)}`;
  const cutoff = rangeCutoffIso();
  return `/api/events?session=all${cutoff ? '&since=' + encodeURIComponent(cutoff) : ''}`;
}

const byTimeThenSeq = (a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.seq - b.seq);

async function loadScope() {
  const load = ++latestLoad;
  let events = [];
  try {
    const response = await fetch(eventsUrl());
    if (response.ok) events = await response.json();
  } catch { /* offline */ }
  if (load !== latestLoad) return;
  if (state.scope === ALL_SESSIONS) events = events.filter(event => isAgentShown(agentOfEvent(event)));
  events.sort(byTimeThenSeq);
  state.events = events;
  state.frozenEvents = [];
  state.replayCursor = null;
  state.replaying = false;
  allTurns = buildTurns(events);
  if (state.selectedTurnKey && !findTurn(state.selectedTurnKey)) state.selectedTurnKey = null;
  rebuildActivity();
  scheduleRender(...ALL_PARTS);
}

function selectScope(id) {
  state.scope = id;
  state.selectedTurnKey = null;
  state.openEventSeqs.clear();
  try {
    const address = new URL(location.href);
    address.hash = id === ALL_SESSIONS ? '' : 'session=' + encodeURIComponent(id);
    history.replaceState(null, '', address.pathname + address.search + address.hash);
  } catch { /* ignore */ }
  scheduleRender('sessions', 'header');
  loadScope();
}

const isInScope = event => (state.scope === ALL_SESSIONS ? isAgentShown(agentOfEvent(event)) : event.session_id === state.scope);

// inserts an event in time order; true when it went at the end
function insertEvent(event) {
  const events = state.events;
  let index = events.length;
  while (index > 0 && (events[index - 1].ts > event.ts || (events[index - 1].ts === event.ts && events[index - 1].seq > event.seq))) index--;
  events.splice(index, 0, event);
  if (events.length > EVENTS_KEPT_MAX) events.splice(0, events.length - EVENTS_KEPT_MAX);
  return index === events.length - 1;
}

// the server re-sends a model step when later transcript lines add its tool calls: update it in place
function updateResentEvent(event) {
  if (event.seq == null) return false;
  const events = state.events;
  for (let index = events.length - 1, searched = 0; index >= 0 && searched < RESENT_STEP_SEARCH_MAX; index--, searched++) {
    if (events[index].seq !== event.seq) continue;
    events[index].data = event.data;
    scheduleRender('turns', 'mid', 'map', 'detail');
    markViewDirty();
    return true;
  }
  return false;
}

function takeEvent(event) {
  if (updateResentEvent(event)) return;
  const atEnd = insertEvent(event);
  if (state.replayCursor == null) {
    if (atEnd) applyEventToActivity(event);
    else rebuildActivity(); // a late model step
  }
  scheduleRender('turns', 'cats', 'mid', 'replay', 'map');
  if (state.selectedTurnKey && event.session_id === state.selectedTurnKey.split(':')[0]) scheduleRender('detail');
}

function applyFrozenEvents() {
  const frozen = state.frozenEvents;
  state.frozenEvents = [];
  for (const event of frozen) takeEvent(event);
  scheduleRender('header');
}

function connectLiveUpdates() {
  const stream = new EventSource('/api/stream');
  stream.onopen = () => { state.connected = true; scheduleRender('header'); };
  stream.onerror = () => { state.connected = false; scheduleRender('header'); };
  stream.addEventListener('hello', message => {
    const version = JSON.parse(message.data).version;
    elementById('ver').textContent = version ? 'v' + version : '';
  });
  stream.addEventListener('session', message => {
    const session = JSON.parse(message.data);
    state.sessions.set(session.id, session);
    state.lastUpdateAt = Date.now();
    if (state.frozen) return scheduleRender('header');
    scheduleRender('sessions', 'header', 'mid');
  });
  stream.addEventListener('event', message => {
    const event = JSON.parse(message.data);
    state.lastUpdateAt = Date.now();
    if (!isInScope(event)) return;
    if (state.frozen) {
      state.frozenEvents.push(event);
      return scheduleRender('header');
    }
    takeEvent(event);
  });
  stream.addEventListener('reset', () => {
    state.sessions.clear();
    state.events = [];
    state.selectedTurnKey = null;
    state.scope = ALL_SESSIONS;
    allTurns = [];
    rebuildActivity();
    scheduleRender(...ALL_PARTS);
  });
}

async function loadSessions() {
  try {
    const sessions = await (await fetch('/api/sessions')).json();
    state.sessions = new Map(sessions.map(session => [session.id, session]));
  } catch { /* server down */ }
}

// #session=<id> in the address opens that session
function sessionFromAddress() {
  const match = location.hash.match(/session=([^&]+)/);
  const id = match && decodeURIComponent(match[1]);
  return id && state.sessions.has(id) ? id : null;
}
