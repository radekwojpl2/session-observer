'use strict';
// Session Observer dashboard — Compare, the model: the sessions compared (up to COMPARE_MAX, the first is the
// baseline the others are measured against), their events (loaded apart from the scope's), and what is measured.
// Use it to see whether a run of the same task did better than the one before, or how agents did on the same task.
const COMPARE_MAX = 3;
const COMPARE_LETTERS = ['A', 'B', 'C'];
const COMPARE_RELOAD_MS = 2000; // a compared session that is working reloads its events at most this often

let compareIds = [];               // the compared session ids, the baseline first
let compareWide = false;           // Compare takes the whole window: the sessions list and filters are hidden
const COMPARE_TABS = ['summary', 'answers', 'steps'];
let compareTab = 'summary';        // what Compare shows under the sessions: the numbers, the answers, or the steps
const compareData = new Map();     // session id → { measure, loading, stale, timer, loadedAt }

// ---- which sessions are compared: kept in the address (?compare=a,b) and in the browser, so a reload keeps them
function loadCompareSelection() {
  const fromAddress = new URLSearchParams(location.search).get('compare');
  const saved = fromAddress ?? storage.get(SETTING_KEYS.compare, '');
  compareIds = [...new Set(String(saved).split(',').filter(Boolean))].slice(0, COMPARE_MAX);
  compareWide = storage.get(SETTING_KEYS.compareWide, '') === '1';
  const tab = storage.get(SETTING_KEYS.compareTab, 'summary');
  compareTab = COMPARE_TABS.includes(tab) ? tab : 'summary';
}

function setCompareTab(tab) {
  if (!COMPARE_TABS.includes(tab)) return;
  compareTab = tab;
  storage.set(SETTING_KEYS.compareTab, tab);
}

function setCompareWide(isWide) {
  compareWide = isWide;
  storage.set(SETTING_KEYS.compareWide, isWide ? '1' : '');
}

// the compared sessions that are loaded, in order (a session from an older day stays chosen until it is loaded)
const comparedSessions = () => compareIds.map(id => state.sessions.get(id)).filter(Boolean);
const compareSlotOf = id => comparedSessions().findIndex(session => session.id === id); // 0 = A, -1 = not compared
const isCompareFull = () => comparedSessions().length >= COMPARE_MAX;

function setCompareIds(ids) {
  compareIds = [...new Set(ids)].slice(0, COMPARE_MAX);
  storage.set(SETTING_KEYS.compare, compareIds.join(','));
  try {
    const address = new URL(location.href);
    if (compareIds.length) address.searchParams.set('compare', compareIds.join(','));
    else address.searchParams.delete('compare');
    history.replaceState(history.state, '', address.pathname + address.search + address.hash);
  } catch { /* ignore */ }
  for (const [id, entry] of compareData) {
    if (compareIds.includes(id)) continue;
    clearTimeout(entry.timer);
    compareData.delete(id);
  }
  scheduleRender('sessions');
  markViewDirty();
}

// in or out of the comparison; a session no longer loaded gives its place up first
function toggleCompared(id) {
  const loaded = compareIds.filter(other => state.sessions.has(other));
  if (loaded.includes(id)) return setCompareIds(loaded.filter(other => other !== id));
  if (loaded.length < COMPARE_MAX) setCompareIds([...loaded, id]);
}

const uncompareSession = id => { if (compareIds.includes(id)) setCompareIds(compareIds.filter(other => other !== id)); };
const makeCompareBaseline = id => setCompareIds([id, ...compareIds.filter(other => other !== id)]);

// ---- each compared session's events, loaded on their own (the page's events are the scope's)
const byEventOrder = (a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.seq - b.seq);

function requestCompareLoad(id) {
  const entry = compareData.get(id) || {};
  compareData.set(id, entry);
  if (entry.loading || entry.timer) return;
  const wait = Math.max(0, (entry.loadedAt || 0) + COMPARE_RELOAD_MS - Date.now());
  entry.timer = setTimeout(() => {
    entry.timer = null;
    void loadCompareEvents(id, entry);
  }, wait);
}

async function loadCompareEvents(id, entry) {
  entry.loading = true;
  entry.stale = false;
  try {
    const response = await fetch(`/api/events?session=${encodeURIComponent(id)}`);
    if (response.ok) entry.measure = measureSessionEvents((await response.json()).sort(byEventOrder), state.sessions.get(id)?.cwd);
  } catch { /* server down: the last measure stays */ }
  entry.loading = false;
  entry.loadedAt = Date.now();
  if (compareData.get(id) !== entry) return; // taken out of the comparison meanwhile
  if (entry.stale && state.view === 'compare') requestCompareLoad(id);
  markViewDirty();
}

// a live event of a compared session: its measure is out of date (reloaded now when Compare is shown, else when it is)
function noteComparedEvent(event) {
  const entry = compareData.get(event.session_id);
  if (!entry) return;
  entry.stale = true;
  if (state.view === 'compare') requestCompareLoad(event.session_id);
}

// the session's measure, or null while it loads; asks for its events when they are missing or out of date
function compareMeasureOf(id) {
  const entry = compareData.get(id);
  if (!entry || entry.stale) requestCompareLoad(id);
  return entry?.measure || null;
}

// a path inside the folder as a path from it ("src/app.ts"), with / between its parts; any other path as it is
function pathInFolder(filePath, folder) {
  const path = String(filePath).replace(/\\/g, '/'), root = String(folder || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return root && path.toLowerCase().startsWith(root.toLowerCase() + '/') ? path.slice(root.length + 1) : path;
}

// Every step of a turn, in order: model steps (with what each cost), what the model wrote or thought, tool calls
// (with their argument, how long they took and whether they failed) and subagent starts; each with its tool group,
// and whether it ran inside a subagent. stopCount: the steps the route strip draws (all but the model's text).
const COMPARE_ARGUMENT_MAX = 400;
const COMPARE_STEP_TEXT_MAX = 1500;
const FAILED_CALL_EVENTS = new Set(['PostToolUseFailure', 'PermissionDenied']);
const STEP_KINDS = { ModelStep: 'step', ModelText: 'text', PreToolUse: 'tool', SubagentStart: 'subagent' };

function newStop(kind, event, folder) {
  const data = event.data || {};
  const stop = {
    kind, seq: event.seq, sub: data.agent_id != null && kind !== 'subagent', failed: false, ms: null,
    group: kind === 'tool' ? toolGroupOfEvent(event) || 'other' : kind === 'subagent' ? 'agents' : 'model',
    tool: '', argument: '', text: '', thinking: false, cost: null,
  };
  if (kind === 'tool') {
    stop.tool = toolDisplayName(data.tool_name);
    const argument = String(toolArgument(data) || '');
    // a file is named from the session's folder, as in the Files card
    stop.argument = (FILE_TOOLS.has(data.tool_name) ? pathInFolder(argument, folder) : argument).slice(0, COMPARE_ARGUMENT_MAX);
  } else if (kind === 'subagent') {
    stop.tool = data.agent_type || '';
  } else if (kind === 'text') {
    stop.text = String(data.text || '').slice(0, COMPARE_STEP_TEXT_MAX);
    stop.thinking = data.kind === 'thinking';
  } else {
    stop.cost = Number.isFinite(event.cost_usd) ? event.cost_usd : null;
  }
  return stop;
}

function routeStopsOfTurn(turn, folder) {
  const stops = [], stopByCall = new Map();
  for (const event of turn.events) {
    const data = event.data || {};
    const call = data.tool_use_id && stopByCall.get(data.tool_use_id);
    if (call && (event.event === 'PostToolUse' || event.event === 'PostToolUseFailure') && event.duration_ms != null) call.ms = event.duration_ms;
    if (call && FAILED_CALL_EVENTS.has(event.event)) call.failed = true;
    const kind = STEP_KINDS[event.event];
    if (!kind || (kind === 'text' && !String(data.text || '').trim())) continue;
    const stop = newStop(kind, event, folder);
    stops.push(stop);
    if (kind === 'tool' && data.tool_use_id) stopByCall.set(data.tool_use_id, stop);
  }
  return { stops, stopCount: stops.filter(stop => stop.kind !== 'text').length };
}

// what the model replied to a turn: its final reply (the Stop event's), else the last text the main agent wrote
function answerOfTurn(turn) {
  if (turn.answer) return String(turn.answer);
  const said = turn.events.filter(event => event.event === 'ModelText' && event.data?.kind !== 'thinking' && event.data?.agent_id == null && !event.data?.subagent);
  return said.length ? String(said[said.length - 1].data.text || '') : '';
}

// what a turn's model steps cost (each step's cost_usd, set by the server); null when none of them has a price
function costOfTurn(turn) {
  const costs = turn.events.filter(event => event.event === 'ModelStep' && Number.isFinite(event.cost_usd)).map(event => event.cost_usd);
  return costs.length ? costs.reduce((total, cost) => total + cost, 0) : null;
}

// The files a shell command reads: the file arguments of cat, head, tail, sed -n, Get-Content and the like (agents
// such as Codex read only this way). A search (grep, rg) or a command that writes is not a read of a file.
const READ_PROGRAMS = new Set(['cat', 'head', 'tail', 'less', 'more', 'nl', 'bat', 'sed', 'awk', 'wc', 'type', 'get-content', 'gc']);
const SCRIPT_FIRST = new Set(['sed', 'awk']); // their first argument is a script, not a file
const SHELL_WORD = /(?:"[^"]*"|'[^']*'|[^\s"'])+/g;
const looksLikeFile = word => !/^[-<>&|$]|^\d|^\/dev\/|^nul$/i.test(word) && !/[*?{}]|\$\(/.test(word) && (/[\\/]/.test(word) || /\.[A-Za-z0-9]{1,8}$/.test(word));

// a command given as words: a shell running a script (["bash", "-lc", "cat a.txt"]) is that script
const SHELL_PROGRAMS = /^(?:ba|z|da)?sh$|^pwsh$|^powershell$|^cmd$/i;
const commandLineOf = command => (!Array.isArray(command) ? String(command || '')
  : command.length > 2 && SHELL_PROGRAMS.test(baseName(command[0]).replace(/\.exe$/i, '')) ? String(command[command.length - 1]) : command.join(' '));

function filesReadByCommand(command) {
  const files = [], commandLine = commandLineOf(command);
  for (const part of splitShellCommands(commandLine)) {
    const program = baseName(programOfCommand(part)).toLowerCase().replace(/\.exe$/, '');
    if (!READ_PROGRAMS.has(program) || (program === 'sed' && /\s-i\b/.test(part))) continue;
    const words = (part.match(SHELL_WORD) || []).map(word => word.replace(/^["']|["']$/g, ''));
    const arguments_ = words.slice(words.findIndex(word => baseName(word).toLowerCase().replace(/\.exe$/, '') === program) + 1);
    const positional = arguments_.filter(word => !word.startsWith('-'));
    files.push(...positional.slice(SCRIPT_FIRST.has(program) ? 1 : 0).filter(looksLikeFile));
  }
  return files;
}

// ---- what is measured from a session's events (the server's summary has the rest); file paths are from its folder
function measureSessionEvents(events, folder) {
  const pageTurnBySeq = turnBySeq; // buildTurns fills the page's turnBySeq: keep the page's own
  const turns = buildTurns(events).filter(turn => turn.prompt !== null);
  turnBySeq = pageTurnBySeq;
  const edited = new Set(), read = new Set(), groups = {};
  let commands = 0;
  for (const event of events) {
    if (event.event !== 'PreToolUse') continue;
    const tool = event.data?.tool_name, group = toolGroupOfEvent(event) || 'other';
    groups[group] = (groups[group] || 0) + 1;
    const input = event.data.tool_input || {};
    if (COMMAND_TOOLS.has(tool)) {
      commands++;
      for (const filePath of filesReadByCommand(input.command)) read.add(pathInFolder(filePath, folder));
    }
    const files = READ_TOOLS.has(tool) ? read : EDIT_TOOLS.has(tool) ? edited : null;
    if (files) for (const filePath of filesOfToolCall(tool, input)) files.add(pathInFolder(filePath, folder));
  }
  for (const filePath of edited) read.delete(filePath); // a file read and edited counts as edited
  const turnRows = turns.map(turn => ({
    key: turn.key, prompt: turn.prompt, ms: Math.max(0, Date.parse(turn.end) - Date.parse(turn.start)),
    tools: turn.toolCount, problems: turn.problemCount, done: turn.done, cost: costOfTurn(turn), answer: answerOfTurn(turn), ...routeStopsOfTurn(turn, folder),
  }));
  return {
    turns: turnRows, activeMs: turnRows.reduce((total, turn) => total + turn.ms, 0),
    edited, read, groups, commands,
    firstPrompt: turns[0]?.prompt || '',
  };
}

// ---- the rows of the comparison: a value per session, how it is written, and whether less of it is better
const totalInputTokens = usage => (usage?.input || 0) + (usage?.cache_read || 0) + (usage?.cache_write || 0);
const COMPARE_METRICS = [
  { id: 'activeTime', value: (session, measure) => measure?.activeMs, format: formatDuration, lessIsBetter: true },
  { id: 'cost', value: session => sessionCostOf(session) ?? undefined, format: formatUsd, lessIsBetter: true, partial: isCostPartial },
  { id: 'span', value: session => Date.parse(session.last) - Date.parse(session.started), format: formatDuration, lessIsBetter: false },
  { id: 'turns', value: session => session.turns || 0, format: String, lessIsBetter: false },
  { id: 'modelSteps', value: session => session.modelSteps || 0, format: String, lessIsBetter: true },
  { id: 'toolCalls', value: session => session.toolCalls || 0, format: String, lessIsBetter: true },
  { id: 'toolTime', value: session => session.toolMs || 0, format: formatDuration, lessIsBetter: true },
  { id: 'problems', value: session => session.failures || 0, format: String, lessIsBetter: true },
  { id: 'subagents', value: session => session.subagents || 0, format: String, lessIsBetter: false },
  { id: 'inputTokens', value: session => totalInputTokens(session.usage), format: formatCompactNumber, lessIsBetter: true },
  { id: 'outputTokens', value: session => session.usage?.output || 0, format: formatCompactNumber, lessIsBetter: true },
  { id: 'context', value: session => session.context?.pct, format: pct => Math.round(pct * 100) + '%', lessIsBetter: true },
  { id: 'filesEdited', value: (session, measure) => measure?.edited.size, format: String, lessIsBetter: false },
  { id: 'filesRead', value: (session, measure) => measure?.read.size, format: String, lessIsBetter: false },
  { id: 'commands', value: (session, measure) => measure?.commands, format: String, lessIsBetter: false },
];

// One row's cells: each session's value, whether it is the best of them, and how it differs from the baseline's
// (change: a fraction, Infinity when the baseline had none; verdict: better, worse, or '' when equal or neither).
function compareCells(metric, sessions, measures) {
  const values = sessions.map((session, index) => {
    const value = metric.value(session, measures[index]);
    return Number.isFinite(value) ? value : null;
  });
  const known = values.filter(value => value !== null);
  const best = metric.lessIsBetter && new Set(known).size > 1 ? Math.min(...known) : null;
  const baseline = values[0];
  return values.map((value, index) => {
    const compared = index > 0 && value !== null && baseline !== null;
    const change = !compared ? null : baseline ? (value - baseline) / baseline : value ? Infinity : 0;
    const verdict = !compared || !metric.lessIsBetter || value === baseline ? '' : value < baseline ? 'better' : 'worse';
    return { value, best: best !== null && value === best, change, verdict };
  });
}

// how the sessions relate: one agent run again, or different agents; and whether they started from the same prompt
function compareKind(sessions, measures) {
  const agents = new Set(sessions.map(session => session.agent || DEFAULT_AGENT));
  const prompts = measures.map(measure => measure && String(measure.firstPrompt).replace(/\s+/g, ' ').trim());
  const samePrompt = prompts.every(Boolean) ? new Set(prompts).size === 1 : null; // null until every one is loaded
  return { sameAgent: agents.size === 1, samePrompt };
}

// the files any of them read or edited, and what each did with it: [{ path, by: ['edited' | 'read' | '', …] }].
// Files someone edited come first, then those more sessions touched.
function comparedFiles(measures) {
  const paths = new Set(measures.flatMap(measure => (measure ? [...measure.edited, ...measure.read] : [])));
  const touch = (measure, filePath) => (measure?.edited.has(filePath) ? 'edited' : measure?.read.has(filePath) ? 'read' : '');
  const rows = [...paths].map(filePath => ({ path: filePath, by: measures.map(measure => touch(measure, filePath)) }));
  const edits = row => row.by.filter(how => how === 'edited').length, touches = row => row.by.filter(Boolean).length;
  return rows.sort((a, b) => edits(b) - edits(a) || touches(b) - touches(a) || a.path.localeCompare(b.path));
}
