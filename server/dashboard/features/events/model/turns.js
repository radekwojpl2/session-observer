'use strict';
// Session Observer dashboard — turns: a prompt and everything that happened until the next one.
// Things you do between turns (/model, /add-dir, settings edits, /clear or /compact…) belong to the turn they lead into.
const BETWEEN_TURN_EVENTS = new Set(['PreModelSwitch', 'PostModelSwitch', 'ConfigChange', 'DirectoryAdded', 'CwdChanged', 'InstructionsLoaded',
  'WorktreeCreate', 'WorktreeRemove', 'SessionStart', 'PreCompact', 'PostCompact']);
// a slash command's expansion joins the prompt that follows it when they come this close together
const EXPANSION_JOIN_MS = 2000;

function newTurn(event, prompt, awaitingPrompt) {
  return {
    key: event.session_id + ':' + event.seq,
    sessionId: event.session_id,
    start: event.ts, end: event.ts,
    prompt,                 // null for a prelude: what happened before a prompt
    awaitingPrompt,         // opened by a slash command's expansion; its UserPromptSubmit is still to come
    events: [],
    toolCount: 0, stepCount: 0, problemCount: 0,
    toolGroupCounts: {},
    answer: null, done: false, failed: false,
    outputTokens: 0, toolMs: 0,
  };
}

// a prelude with nothing in it yet but between-turn events
const isEmptyPrelude = turn => turn && turn.prompt === null && !turn.toolCount && !turn.stepCount;
const hasJustStarted = turn => turn && turn.prompt !== null && !turn.toolCount && !turn.stepCount;

function countEventInTurn(turn, event, subagentKey, turnBySubagent) {
  const group = toolGroupOfEvent(event), data = event.data || {};
  if (event.event === 'PreToolUse') {
    turn.toolCount++;
    turn.toolGroupCounts[group] = (turn.toolGroupCounts[group] || 0) + 1;
  } else if (event.event === 'ModelStep') {
    turn.stepCount++;
    turn.outputTokens += data.tokens?.output || 0;
  } else if (event.event === 'SubagentStart') {
    turn.toolGroupCounts.agents = (turn.toolGroupCounts.agents || 0) + 1;
    if (subagentKey) turnBySubagent.set(subagentKey, turn);
  }
  if (event.duration_ms) turn.toolMs += event.duration_ms;
  if (isProblemEvent(event)) turn.problemCount++;
  if (event.event === 'Stop') { turn.done = true; turn.answer = data.last_assistant_message || turn.answer; }
  if (event.event === 'StopFailure') { turn.done = true; turn.failed = true; }
  if (event.event === 'SessionEnd') turn.done = true;
  if (event.event === 'Interrupt') { turn.done = true; turn.interrupted = true; }
}

// Splits events into turns, and fills turnBySeq. Returns the turns that have something in them.
function buildTurns(events) {
  const currentTurnBySession = new Map(), turns = [], turnBySubagent = new Map();
  turnBySeq = new Map();
  for (const event of events) {
    let turn = currentTurnBySession.get(event.session_id);
    // a subagent's events stay with the turn that started it, even after a later prompt (a background subagent's
    // hand-back arrives as a new prompt), so its branch can still merge back on the route
    const subagentKey = event.data?.agent_id != null ? event.session_id + '/' + event.data.agent_id : null;
    // a slash command / skill fires UserPromptExpansion just before its UserPromptSubmit: the expansion opens the
    // turn and the prompt joins it (unless the prompt came first and this turn has only just started)
    const expansionOpensTurn = event.event === 'UserPromptExpansion'
      && !(hasJustStarted(turn) && eventTime(event) - Date.parse(turn.start) < EXPANSION_JOIN_MS);

    if (subagentKey && event.event !== 'SubagentStart' && turnBySubagent.has(subagentKey)) {
      turn = turnBySubagent.get(subagentKey);
    } else if (event.event === 'UserPromptSubmit' && turn?.awaitingPrompt) {
      turn.awaitingPrompt = false;
      turn.prompt = String(event.data?.prompt ?? '');
    } else if (event.event === 'UserPromptSubmit' || expansionOpensTurn || !turn
      // once a turn has finished, between-turn events open a prelude that the next prompt's turn takes over
      || (turn.done && BETWEEN_TURN_EVENTS.has(event.event) && !isEmptyPrelude(turn))) {
      const opensWithPrompt = event.event === 'UserPromptSubmit' || expansionOpensTurn;
      const next = newTurn(event, opensWithPrompt ? String(event.data?.prompt ?? '') : null, expansionOpensTurn);
      // what happened before the first prompt (SessionStart, Setup, instructions loaded…) joins that prompt's turn
      if (opensWithPrompt && isEmptyPrelude(turn)) {
        next.events = turn.events;
        turn.events = [];
        for (const moved of next.events) turnBySeq.set(moved.seq, next);
      }
      turn = next;
      currentTurnBySession.set(event.session_id, turn);
      turns.push(turn);
    }
    turn.events.push(event);
    turn.end = event.ts;
    turnBySeq.set(event.seq, turn);
    countEventInTurn(turn, event, subagentKey, turnBySubagent);
  }
  // hide prelude "turns" with nothing in them (a session that started but got no prompt yet, or whose prelude moved
  // into its first prompt's turn)
  return turns.filter(turn => turn.prompt !== null || turn.toolCount || turn.stepCount);
}

function turnMatchesFilters(turn) {
  if (!anyFilterActive()) return true;
  const searchOnly = state.searchText && !state.group && !state.category && !state.onlyProblems;
  if (searchOnly && ((turn.prompt || '') + ' ' + (turn.answer || '')).toLowerCase().includes(state.searchText)) return true;
  return turn.events.some(eventMatchesFilters);
}

// the session's latest turn, while the session is busy with it
function isTurnRunning(turn) {
  const session = state.sessions.get(turn.sessionId);
  if (turn.done || !session || session.ended || !session.busy) return false;
  const latest = [...allTurns].reverse().find(candidate => candidate.sessionId === turn.sessionId);
  return latest === turn;
}
