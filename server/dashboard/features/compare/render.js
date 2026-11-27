'use strict';
// Session Observer dashboard — Compare, the view: the sessions in columns (A, the baseline, then B and C), then one of
// three tabs: Summary (their numbers against the baseline, what their tools worked with, the files they edited),
// Answers (what the model replied to each turn) and Steps (turn by turn, every step).
const COMPARE_FILES_MAX = 20;
const COMPARE_TURNS_MAX = 20;
const COMPARE_NAME_MAX = 90;

// a grid with a label column and one column per session
const compareGridHtml = (sessionCount, cells) => `<div class="cmp-grid" style="--cmp-n:${sessionCount}">${cells}</div>`;
const compareLabelHtml = (text, title) => `<div class="cmp-l"${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(text)}</div>`;
const compareValueHtml = (html, className = '') => `<div class="cmp-v ${className}">${html}</div>`;
const compareLetterHtml = index => `<span class="cmp-letter cmp-${index}">${COMPARE_LETTERS[index]}</span>`;
const compareMissingHtml = () => '<span class="muted">–</span>';

function compareHeadingHtml(sessions, measures) {
  const words = TEXT.compare;
  let kind = '';
  if (sessions.length > 1) {
    const { sameAgent, samePrompt } = compareKind(sessions, measures);
    const prompts = samePrompt === null ? ''
      : samePrompt ? `<span class="cmp-same">✓ ${escapeHtml(words.samePrompt)}</span>` : `<span class="cmp-differ">≠ ${escapeHtml(words.differentPrompts)}</span>`;
    kind = `<div class="cmp-kind"><b>${escapeHtml(sameAgent ? words.sameAgent(agentName(sessions[0].agent)) : words.differentAgents)}</b>${prompts}</div>`;
  }
  const wide = `<button type="button" class="cmp-wide" data-compare-wide aria-pressed="${compareWide}" title="${escapeHtml(words.fullWidthTitle)}">`
    + `${compareWide ? '⤡' : '⤢'} ${escapeHtml(compareWide ? words.exitFullWidth : words.fullWidth)}</button>`;
  return `<div class="home-heading"><h2>${escapeHtml(TEXT.views.compare)}</h2><span class="grow"></span>${wide}</div><p class="lead">${escapeHtml(words.lead)}</p>${kind}`;
}

// a session's column head: its letter, baseline or the button that makes it one, what it is, and ×
function compareColumnHtml(session, index) {
  const words = TEXT.compare, id = escapeHtml(session.id), [status, dotClass] = sessionStatus(session);
  const role = index === 0 ? `<span class="cmp-base">${escapeHtml(words.baseline)}</span>`
    : `<button type="button" class="cmp-mini" data-compare-baseline="${id}" title="${escapeHtml(words.makeBaselineTitle)}">${escapeHtml(words.makeBaseline)}</button>`;
  const where = [session.started ? escapeHtml(formatAgo(session.started)) : '',
    session.cwd ? `<span class="mono" title="${escapeHtml(session.cwd)}">${escapeHtml(baseName(session.cwd))}</span>` : ''].filter(Boolean).join(' · ');
  return `<div class="cmp-col cmp-${index}">
      <div class="cmp-top">${compareLetterHtml(index)}${role}<span class="grow"></span><button type="button" class="cmp-x" data-compare-remove="${id}" title="${escapeHtml(words.remove)}" aria-label="${escapeHtml(words.remove)}">×</button></div>
      <button type="button" class="cmp-name" data-compare-open="${id}" title="${escapeHtml(TEXT.home.open)}">${escapeHtml(shorten(sessionName(session), COMPARE_NAME_MAX))}</button>
      <div class="cmp-meta">${agentBadgeHtml(session.agent, 'agent-tag')}${session.model ? `<span class="mono">${escapeHtml(session.model)}</span>` : ''}</div>
      <div class="cmp-meta"><span class="${dotClass}"></span>${escapeHtml(status)}${where ? ' · ' + where : ''}</div>
    </div>`;
}

// how a value differs from the baseline's: −18%, ×12 from ten times as much, +3 when the baseline had none, = when the same
const COMPARE_TIMES_FROM = 9; // a change of +900% and more is written as how many times the baseline it is
function compareChangeHtml(cell, metric) {
  if (cell.change === null) return '';
  const text = cell.change === 0 ? '='
    : cell.change === Infinity ? '+' + metric.format(cell.value)
      : cell.change >= COMPARE_TIMES_FROM ? '×' + Math.round(cell.change + 1)
      : (cell.change > 0 ? '+' : '−') + Math.round(Math.abs(cell.change) * 100) + '%';
  return `<span class="cmp-d ${cell.verdict}">${escapeHtml(text)}</span>`;
}

function compareNumbersHtml(sessions, measures) {
  const words = TEXT.compare;
  // a value that leaves something out (a cost with unpriced steps) is marked *
  const partialHtml = (metric, session) => (metric.partial?.(session) ? `<span class="cmp-partial" title="${escapeHtml(TEXT.costPartial)}">*</span>` : '');
  const rows = COMPARE_METRICS.map(metric => compareLabelHtml(words.metrics[metric.id])
    + compareCells(metric, sessions, measures).map((cell, index) => compareValueHtml(
      (cell.value === null ? compareMissingHtml() : `<b>${escapeHtml(metric.format(cell.value))}</b>${partialHtml(metric, sessions[index])}`) + compareChangeHtml(cell, metric),
      cell.best ? 'best' : '')).join('')).join('');
  return overviewCardHtml(escapeHtml(words.numbers), escapeHtml(sessions.length > 1 ? words.numbersHint : ''), compareGridHtml(sessions.length, rows), true);
}

// ---- Answers: what the model replied to each turn, side by side and lined up by turn, as formatted text. A reply the
// log cut short says so, and opens in full in the Context view (which reads the agent's own session file).
const CUT_REPLY = /(?:… \[\+\d+ chars]|…)\s*$/;

function compareAnswerHtml(turn, session) {
  const words = TEXT.compare;
  if (!turn) return compareValueHtml(compareMissingHtml(), 'cmp-answer');
  const asked = `<div class="cmp-asked" title="${escapeHtml(stripTags(turn.prompt))}">${escapeHtml(shorten(stripTags(turn.prompt), TOOLTIP_PREVIEW_MAX))}</div>`;
  if (!turn.answer.trim()) return compareValueHtml(asked + `<div class="muted">${escapeHtml(turn.done ? words.noReply : words.stillWorking)}</div>`, 'cmp-answer');
  const isCut = CUT_REPLY.test(turn.answer);
  const cut = isCut ? `<div class="cmp-cut">${escapeHtml(words.cutShort)} <button type="button" class="cmp-mini" data-compare-context="${escapeHtml(session.id)}">${escapeHtml(words.readFull)}</button></div>` : '';
  return compareValueHtml(`${asked}<div class="md cmp-md">${markdownHtml(turn.answer.replace(CUT_REPLY, ''))}</div>${cut}`, 'cmp-answer');
}

function compareAnswersHtml(sessions, measures) {
  const words = TEXT.compare;
  if (measures.some(measure => !measure)) return overviewCardHtml(escapeHtml(words.answersTitle), '', noneHtml(words.loading), true);
  const count = Math.max(0, ...measures.map(measure => measure.turns.length));
  if (!count) return overviewCardHtml(escapeHtml(words.answersTitle), '', noneHtml(words.noReply), true);
  const shown = compareAllTurnsShown ? count : Math.min(count, COMPARE_TURNS_MAX);
  const head = '<div class="cmp-l"></div>' + sessions.map((session, index) => compareValueHtml(`${compareLetterHtml(index)} ${agentBadgeHtml(session.agent, 'agent-tag')}`, 'cmp-answer-head')).join('');
  const rows = Array.from({ length: shown }, (unused, turnIndex) => compareLabelHtml(words.turnN(turnIndex + 1))
    + measures.map((measure, index) => compareAnswerHtml(measure.turns[turnIndex], sessions[index])).join('')).join('');
  const more = count > shown ? `<span class="grow"></span><button type="button" class="cmp-mini" data-compare-all-turns>${escapeHtml(words.showAllTurns(count))}</button>` : '';
  return overviewCardHtml(escapeHtml(words.answersTitle), escapeHtml(words.answersHint) + more, compareGridHtml(sessions.length, head + rows), true);
}

// Summary, Answers or Steps: what Compare shows under the sessions
function compareTabsHtml() {
  return `<div class="layouts cmp-tabs" role="tablist">${COMPARE_TABS.map(tab => `<button role="tab" aria-selected="${tab === compareTab}" class="${tab === compareTab ? 'cur' : ''}" data-compare-tab="${tab}">${escapeHtml(TEXT.compare.tabs[tab])}</button>`).join('')}</div>`;
}

// each session's tool calls as one bar, split by tool group; the bar's length is its number of calls
function compareToolMixHtml(sessions, measures) {
  const words = TEXT.compare;
  const totals = measures.map(measure => (measure ? Object.values(measure.groups).reduce((total, count) => total + count, 0) : 0));
  const used = TOOL_GROUPS.filter(group => measures.some(measure => measure?.groups[group.id]));
  if (!used.length) return overviewCardHtml(escapeHtml(words.toolMix), '', noneHtml(words.noTools), true);
  const most = Math.max(1, ...totals);
  const bars = sessions.map((session, index) => {
    const groups = measures[index]?.groups || {};
    const segments = used.filter(group => groups[group.id])
      .map(group => `<i style="flex:${groups[group.id]};background:var(--s-${group.id})" title="${escapeHtml(`${group.label}: ${groups[group.id]}`)}"></i>`).join('');
    return `<div class="cmp-bar-row">${compareLetterHtml(index)}<div class="cmp-bar-track"><div class="cmp-bar" style="width:${(100 * totals[index] / most).toFixed(1)}%">${segments}</div></div><span class="cmp-n">${totals[index]}</span></div>`;
  }).join('');
  const legend = used.map(group => `<span class="cmp-key"><i style="background:var(--s-${group.id})"></i>${escapeHtml(group.label)}</span>`).join('');
  return overviewCardHtml(escapeHtml(words.toolMix), escapeHtml(words.toolMixHint), bars + `<div class="cmp-legend">${legend}</div>`, true);
}

// the files any of them read or edited, by path inside its session's folder (so runs in different worktrees line up),
// and what each session did with it: edited, read (with a file tool or a shell command like cat), or nothing
let compareAllFilesShown = false;

function compareFilesHtml(sessions, measures) {
  const words = TEXT.compare, rows = comparedFiles(measures);
  if (!rows.length) return overviewCardHtml(escapeHtml(words.files), '', noneHtml(words.noFiles), true);
  const edited = rows.filter(row => row.by.includes('edited')).length, inEvery = rows.filter(row => row.by.every(Boolean)).length;
  const head = '<div class="cmp-l"></div>' + sessions.map((session, index) => compareValueHtml(compareLetterHtml(index), 'cmp-c')).join('');
  const touchHtml = how => (how === 'edited' ? `<span class="cmp-edited">✎ ${escapeHtml(words.fileEdited)}</span>`
    : how === 'read' ? `<span class="cmp-read">${escapeHtml(words.fileRead)}</span>` : compareMissingHtml());
  const shown = compareAllFilesShown ? rows : rows.slice(0, COMPARE_FILES_MAX);
  const body = shown.map(row => `<div class="cmp-l mono" title="${escapeHtml(row.path)}">${escapeHtml(truncateToColumns(row.path, 60))}</div>`
    + row.by.map(how => compareValueHtml(touchHtml(how), 'cmp-c')).join('')).join('');
  const more = rows.length > shown.length ? `<span class="grow"></span><button type="button" class="cmp-mini" data-compare-all-files>${escapeHtml(words.showAllFiles(rows.length))}</button>` : '';
  return overviewCardHtml(escapeHtml(words.files), escapeHtml(words.filesHint(edited, rows.length - edited, inEvery)) + more, compareGridHtml(sessions.length, head + body), true);
}

// a turn's route in short: a mark per model step (◇), tool call (●) and subagent start (■) in order, coloured by its
// tool group; smaller inside a subagent, ringed red when it failed. Each says what it was on hover.
function compareStopTitle(stop) {
  const what = stop.kind === 'step' ? TEXT.groups.model
    : stop.kind === 'subagent' ? TEXT.groups.agents + (stop.tool ? ': ' + stop.tool : '')
      : stop.tool + (stop.argument ? ' ' + stop.argument : '');
  return what + (stop.failed ? ' ✕' : '') + (stop.sub ? ' · ' + TEXT.compare.inSubagent : '');
}

const COMPARE_STRIP_MAX = 160; // marks drawn in a closed turn's strip; the open turn lists every step

function compareStripHtml(turn) {
  const marks = turn.stops.filter(stop => stop.kind !== 'text');
  const stops = marks.slice(0, COMPARE_STRIP_MAX).map(stop => `<i class="cmp-stop cmp-${stop.kind}${stop.sub ? ' sub' : ''}${stop.failed ? ' failed' : ''}"`
    + ` style="--g:var(--s-${stop.group})" title="${escapeHtml(compareStopTitle(stop))}"></i>`).join('');
  const hidden = marks.length - COMPARE_STRIP_MAX;
  return `<div class="cmp-strip">${stops}${hidden > 0 ? `<span class="cmp-more">${escapeHtml(TEXT.home.more(hidden))}</span>` : ''}</div>`;
}

// ---- an open turn: every step of it, one line each, in a column per session
const compareOpenTurns = new Set(); // the turn numbers (0 = the first) opened
let compareAllTurnsShown = false;  // past COMPARE_TURNS_MAX turns

// A step on one line, as a table row: its mark, the tool, its file or command (cut to the line; all of it on hover)
// and how long it took. A model step is a thin divider between the model's rounds, with what it cost; what the
// model wrote has an edge in the model's colour, its thinking is quieter.
function compareStepHtml(stop) {
  const classes = `cmp-row k-${stop.kind}${stop.thinking ? ' thinking' : ''}${stop.sub ? ' sub' : ''}${stop.failed ? ' failed' : ''}`;
  if (stop.kind === 'step') {
    return `<div class="${classes}" title="${escapeHtml(TEXT.groups.model)}"><span class="cmp-rule"></span>${stop.cost === null ? '' : `<span class="cmp-time">${escapeHtml(formatUsd(stop.cost))}</span>`}</div>`;
  }
  if (stop.kind === 'text') return `<div class="${classes}" title="${escapeHtml(stop.text)}"><span class="cmp-say">${escapeHtml(stop.text)}</span></div>`;
  const what = stop.kind === 'subagent' ? TEXT.groups.agents + (stop.tool ? ': ' + stop.tool : '') : stop.tool;
  const time = stop.failed ? '<span class="err">✕</span>' + (stop.ms != null ? ' ' + escapeHtml(formatDuration(stop.ms)) : '') : stop.ms != null ? escapeHtml(formatDuration(stop.ms)) : '';
  return `<div class="${classes}" title="${escapeHtml(compareStopTitle(stop))}"><i class="cmp-stop cmp-${stop.kind}" style="--g:var(--s-${stop.group})"></i>`
    + `<b class="cmp-tool">${escapeHtml(what)}</b><span class="mono cmp-arg">${escapeHtml(stop.argument)}</span><span class="cmp-time">${time}</span></div>`;
}

function compareOpenTurnHtml(turnIndex, sessions, measures) {
  const column = (measure, index) => {
    const turn = measure?.turns[turnIndex];
    if (!turn) return compareValueHtml(compareMissingHtml(), 'cmp-steps');
    const open = `<button type="button" class="cmp-mini" data-compare-turn="${escapeHtml(turn.key)}" data-compare-turn-session="${escapeHtml(sessions[index].id)}">${escapeHtml(TEXT.compare.openOnRoute)}</button>`;
    return compareValueHtml(`<div class="cmp-prompt">${escapeHtml(shorten(stripTags(turn.prompt), TOOLTIP_PREVIEW_MAX))}</div>${turn.stops.map(compareStepHtml).join('')}${open}`, 'cmp-steps');
  };
  return '<div class="cmp-l"></div>' + measures.map(column).join('');
}

// the nth turn of each side by side: how long it ran (the bar, against the longest), its tool calls, cost and problems,
// and its route in short; a click opens the turn to every step of it
function compareTurnsHtml(sessions, measures) {
  const words = TEXT.compare;
  const count = Math.max(0, ...measures.map(measure => measure?.turns.length || 0));
  if (!count) return '';
  const longest = Math.max(1, ...measures.flatMap(measure => (measure ? measure.turns.map(turn => turn.ms) : [])));
  const cellHtml = (turn, turnIndex, index) => {
    if (!turn) return compareValueHtml(compareMissingHtml());
    const problems = turn.problems ? ` <span class="err">✕ ${turn.problems}</span>` : '';
    return `<div class="cmp-v cmp-turn${compareOpenTurns.has(turnIndex) ? ' open' : ''}" role="button" tabindex="0" aria-expanded="${compareOpenTurns.has(turnIndex)}" data-compare-toggle-turn="${turnIndex}"`
      + ` title="${escapeHtml(shorten(stripTags(turn.prompt), TOOLTIP_PREVIEW_MAX))}">`
      + `<span>${escapeHtml(formatDuration(turn.ms))} · ${escapeHtml(countOf(turn.tools, 'tool'))}${turn.cost === null ? '' : ' · ' + escapeHtml(formatUsd(turn.cost))}${problems}</span>`
      + compareStripHtml(turn)
      + `<span class="cmp-tbar cmp-${index}" style="width:${(100 * turn.ms / longest).toFixed(1)}%"></span></div>`;
  };
  const shown = compareAllTurnsShown ? count : Math.min(count, COMPARE_TURNS_MAX);
  const rows = Array.from({ length: shown }, (unused, turnIndex) =>
    compareLabelHtml(words.turnN(turnIndex + 1)) + measures.map((measure, index) => cellHtml(measure?.turns[turnIndex], turnIndex, index)).join('')
    + (compareOpenTurns.has(turnIndex) ? compareOpenTurnHtml(turnIndex, sessions, measures) : '')).join('');
  const allOpen = shown > 0 && Array.from({ length: shown }, (unused, turnIndex) => turnIndex).every(turnIndex => compareOpenTurns.has(turnIndex));
  const buttons = `<span class="grow"></span><button type="button" class="cmp-mini" data-compare-open-all="${allOpen ? 0 : shown}">${escapeHtml(allOpen ? words.collapseAll : words.expandAll)}</button>`
    + (count > COMPARE_TURNS_MAX && !compareAllTurnsShown ? `<button type="button" class="cmp-mini" data-compare-all-turns>${escapeHtml(words.showAllTurns(count))}</button>` : '');
  return overviewCardHtml(escapeHtml(words.turnsTitle), escapeHtml(words.turnsHint) + buttons, compareGridHtml(sessions.length, rows), true);
}

// a menu of the sessions in the list that are not compared yet
function comparePickerHtml() {
  const words = TEXT.compare;
  const candidates = visibleSessions().filter(session => compareSlotOf(session.id) < 0);
  if (!candidates.length) return '';
  const options = candidates.map(session => `<option value="${escapeHtml(session.id)}">${escapeHtml(shorten(sessionName(session), 70))} · ${escapeHtml(agentShortName(session.agent))}${session.cwd ? ' · ' + escapeHtml(baseName(session.cwd)) : ''}</option>`).join('');
  return `<label class="cmp-add">${iconSvg('compare')}<select data-compare-add aria-label="${escapeHtml(words.add)}"><option value="">${escapeHtml(words.add)}</option>${options}</select></label>`;
}

function compareViewHtml() {
  const sessions = comparedSessions();
  const measures = sessions.map(session => compareMeasureOf(session.id));
  const picker = sessions.length < COMPARE_MAX ? comparePickerHtml() : '';
  const heading = compareHeadingHtml(sessions, measures);
  if (!sessions.length) return `<div class="cmp">${heading}<div class="cmp-empty">${escapeHtml(TEXT.compare.empty)}</div>${picker}</div>`;
  const columns = compareGridHtml(sessions.length, '<div class="cmp-l"></div>' + sessions.map(compareColumnHtml).join(''));
  const addAnother = sessions.length === 1 ? `<p class="muted">${escapeHtml(TEXT.compare.addAnother)}</p>` : '';
  const shown = compareTab === 'answers' ? compareAnswersHtml(sessions, measures)
    : compareTab === 'steps' ? compareTurnsHtml(sessions, measures)
      : compareNumbersHtml(sessions, measures) + compareToolMixHtml(sessions, measures) + compareFilesHtml(sessions, measures);
  return `<div class="cmp">${heading}${picker}${columns}${addAnother}${compareTabsHtml()}<div class="cmp-cards">${shown}</div></div>`;
}
