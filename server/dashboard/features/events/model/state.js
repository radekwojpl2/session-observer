'use strict';
// Session Observer dashboard — the page state: what is loaded, selected, filtered and shown.
const ALL_SESSIONS = 'all';
const DEFAULT_RANGE_MS = 24 * 60 * 60 * 1000; // the time range shown until another one is picked

const state = {
  sessions: new Map(),      // session id → summary from the server
  history: { loadedFrom: null, olderDays: 0 }, // the oldest day folder the server has loaded, and how many are older
  events: [],               // the events in scope, oldest first
  scope: ALL_SESSIONS,      // a session id, or ALL_SESSIONS
  selectedTurnKey: null,    // the turn the Details panel shows
  openEventSeqs: new Set(), // the event rows opened in Details
  // filters
  rangeMs: Number(storage.get(SETTING_KEYS.range, DEFAULT_RANGE_MS)), // 0 = everything
  sessionOrder: storage.get(SETTING_KEYS.sessionOrder, 'started'), // how the sessions list is ordered (features/sessions)
  searchText: '',           // lower case
  group: '',                // a tool group id, or '' for all
  category: '',
  onlyProblems: false,
  agent: storage.get(SETTING_KEYS.agent, ''), // '' = every agent, or one agent's id (agents.js)
  // live updates
  frozen: false,            // Freeze: new events wait in frozenEvents until resumed
  frozenEvents: [],
  connected: false,
  lastUpdateAt: null,
  theme: storage.get(SETTING_KEYS.theme, 'auto'),
  view: 'overview',
};

// every turn of the loaded events (turns.js), and the turn each event belongs to
let allTurns = [];
let turnBySeq = new Map();

const rangeCutoffIso = () => (state.rangeMs ? new Date(Date.now() - state.rangeMs).toISOString() : null);
const anyFilterActive = () => !!(state.group || state.category || state.onlyProblems || state.searchText);
const findTurn = key => allTurns.find(turn => turn.key === key);
const selectedTurn = () => (state.selectedTurnKey ? findTurn(state.selectedTurnKey) : null);

// an event's text for the search box, built once
const searchTextOfEvent = event => event._search ?? (event._search = (event.event + ' ' + JSON.stringify(event.data)).toLowerCase());

function eventMatchesFilters(event) {
  if (state.group && toolGroupOfEvent(event) !== state.group) return false;
  if (state.category && event.category !== state.category) return false;
  if (state.onlyProblems && !isProblemEvent(event)) return false;
  return !state.searchText || searchTextOfEvent(event).includes(state.searchText);
}
