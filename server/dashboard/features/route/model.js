'use strict';
// Session Observer dashboard — Route view, the model: a turn as stops on a metro line. The main agent runs along the
// main line; each subagent forks a branch below it and merges back when it finishes.
const FORK_OFFSET = 64;   // how far right of its Agent call a subagent's first stop sits
const LANE_GAP = 40;      // free space kept between two subagents sharing a lane
const RUNNING_TAIL = 40;  // the dashed tail a running subagent's lane is drawn with
const STOP_WIDTH = { step: 24, end: 58, regular: 80 }; // the room a stop takes on its lane
const MAIN_LANE = 'main'; // the main agent's lane key; a subagent's branch is keyed by its agent id

// spacing between two consecutive stops on one lane
const routeStopWidth = stop => (stop.isStep ? STOP_WIDTH.step : stop.isEnd ? STOP_WIDTH.end : STOP_WIDTH.regular);
const routeStopGap = (a, b) => (routeStopWidth(a) + routeStopWidth(b)) / 2;

// Every lane keeps its own left→right position (px along the unwrapped route), so a busy subagent never pushes the
// main line or the other subagents apart.
function createRouteBuilder() {
  const stops = [];
  const branches = new Map();          // agent id → branch
  const lastStepOfLane = new Map();    // MAIN_LANE or branch id → its latest model-step stop, which gets the text it wrote
  let lastMainStopIndex;

  // adds a stop to a lane: the main line (branch null) or a subagent's branch
  function addStop(stop, branch) {
    stop.index = stops.length;
    stop.onBranch = branch;
    stop.seqs = stop.seq != null ? [stop.seq] : [];
    const previousIndex = branch ? branch.lastStopIndex : lastMainStopIndex;
    const previous = previousIndex != null ? stops[previousIndex] : null;
    stop.previousIndex = previousIndex;
    stop.position = previous ? previous.position + routeStopGap(previous, stop) : 0;
    if (branch) branch.lastStopIndex = stop.index;
    else lastMainStopIndex = stop.index;
    stops.push(stop);
    return stop;
  }

  // the open branch an event belongs to, if any
  function branchOf(data) {
    const branch = data.agent_id != null && branches.get(String(data.agent_id));
    return branch && !branch.closed ? branch : null;
  }

  return { stops, branches, lastStepOfLane, addStop, branchOf, lastMainStop: () => (lastMainStopIndex != null ? stops[lastMainStopIndex] : null), lastMainStopIndex: () => lastMainStopIndex };
}

// Lanes: the subagent forked last gets the lane nearest the main line, so parallel forks nest (└┘ inside └──┘) instead
// of crossing; a lane is reused once its previous subagent has finished.
function assignLanes(stops, branches) {
  const spanOf = branch => [
    stops[branch.firstStopIndex].position - FORK_OFFSET,
    branch.mergeStopIndex != null ? stops[branch.mergeStopIndex].position : stops[branch.lastStopIndex].position + (branch.running ? RUNNING_TAIL : 0),
  ];
  const spansByLane = [];
  let maxLane = 0;
  const latestForkFirst = [...branches.values()].sort((a, b) =>
    stops[b.firstStopIndex].position - stops[a.firstStopIndex].position || b.firstStopIndex - a.firstStopIndex);
  for (const branch of latestForkFirst) {
    const [from, to] = spanOf(branch);
    let lane = 1;
    while ((spansByLane[lane] ||= []).some(([otherFrom, otherTo]) => from < otherTo + LANE_GAP && otherFrom < to + LANE_GAP)) lane++;
    spansByLane[lane].push([from, to]);
    branch.lane = lane;
    maxLane = Math.max(maxLane, lane);
  }
  for (const stop of stops) stop.lane = stop.onBranch ? stop.onBranch.lane : 0;
  return maxLane;
}

function buildRouteModel(turn) {
  const route = createRouteBuilder();
  const { stops, branches, lastStepOfLane, addStop, branchOf } = route;
  const openToolStops = new Map();  // tool_use_id → its stop, until the result arrives
  const agentCallsWaiting = [];     // Agent calls whose subagent hasn't started yet
  let stepCount = 0, toolCount = 0, problemCount = 0, endEvent = null, lastText = null, lastEventTime = 0;

  const stopFor = (event, fields) => ({ seq: event.seq, tooltip: eventTooltip(event), ...fields });
  // a stop on the main line (never on a subagent's branch)
  const addMainStop = (event, group, label, detail) => addStop(stopFor(event, { group, label, detail }), null);

  for (const event of turn.events) {
    const data = event.data || {}, group = toolGroupOfEvent(event) || 'other', branch = branchOf(data);
    lastEventTime = Math.max(lastEventTime, eventTime(event));
    switch (event.event) {
      case 'UserPromptSubmit':
        addMainStop(event, 'you', TEXT.groups.you, TEXT.promptLc);
        break;
      case 'ModelStep':
        if (data.subagent && !branch) break; // internal helper agents with no branch: not part of the route
        stepCount++;
        lastStepOfLane.set(branch ? branch.id : MAIN_LANE, addStop(stopFor(event, { group: branch ? 'agents' : 'model', isStep: true }), branch));
        break;
      case 'ModelText': {
        if (data.subagent && !branch) break;
        const written = { text: String(data.text || ''), kind: data.kind, ts: eventTime(event) };
        const step = lastStepOfLane.get(branch ? branch.id : MAIN_LANE);
        if (step) {
          const prefix = written.kind === 'thinking' ? `(${TEXT.event.thinking}) ` : '';
          step.text = (step.text ? step.text + ' ' : '') + prefix + written.text;
          step.seqs.push(event.seq);
        }
        if (branch) branch.lastText = written;
        else lastText = written;
        break;
      }
      case 'PreToolUse': {
        toolCount++;
        const stop = addStop(stopFor(event, {
          group, tech: firstTechOfEvent(event), techs: techsOfEvent(event), label: toolDisplayName(data.tool_name),
          detail: toolArgument(data), startedAt: eventTime(event), toolUseId: data.tool_use_id,
        }), branch);
        if (stop.toolUseId) openToolStops.set(stop.toolUseId, stop);
        if (!branch && isSubagentCall(data.tool_name)) {
          stop.agentDescription = data.tool_input?.description;
          agentCallsWaiting.push(stop);
        }
        break;
      }
      case 'PostToolUse': case 'PostToolUseFailure': {
        const stop = openToolStops.get(data.tool_use_id);
        if (!stop) break;
        openToolStops.delete(data.tool_use_id);
        stop.durationMs = event.duration_ms ?? eventTime(event) - stop.startedAt;
        stop.seq = event.seq;
        stop.seqs.push(event.seq);
        stop.tooltip = eventTooltip(event);
        if (event.event === 'PostToolUseFailure') { stop.failed = true; problemCount++; }
        break;
      }
      case 'SubagentStart': {
        const agentCall = agentCallsWaiting.shift() ?? route.lastMainStop();
        const started = { id: String(data.agent_id ?? event.seq), type: data.agent_type || TEXT.subagentLc, startedAt: eventTime(event), lastStopIndex: null };
        branches.set(started.id, started);
        const stop = addStop(stopFor(event, {
          group: 'agents', label: started.type, detail: agentCall?.agentDescription || TEXT.subagentLc,
          forkFromIndex: agentCall ? agentCall.index : null, startsBranch: started,
        }), started);
        stop.previousIndex = null;
        stop.position = agentCall ? agentCall.position + FORK_OFFSET : 0;
        started.firstStopIndex = stop.index;
        break;
      }
      case 'SubagentStop': {
        if (!branch) break; // helper agent that never started a branch
        branch.closed = true;
        const branchTail = stops[branch.lastStopIndex];
        const stop = addStop(stopFor(event, {
          group: 'agents', label: '⤴ ' + branch.type, detail: TEXT.backX(formatDuration(eventTime(event) - branch.startedAt)),
          mergeFromIndex: branch.lastStopIndex,
        }), null);
        stop.position = Math.max(stop.position, branchTail.position + FORK_OFFSET);
        branch.mergeStopIndex = stop.index;
        break;
      }
      case 'PermissionRequest':
        addStop(stopFor(event, { group: 'you', label: TEXT.event.permission, detail: toolDisplayName(data.tool_name) }), branch);
        break;
      case 'PermissionDenied':
        problemCount++;
        addStop(stopFor(event, { group: 'you', label: TEXT.event.denied, detail: toolDisplayName(data.tool_name), failed: true }), branch);
        break;
      // a model switch mid-session is a stop on the main line: the steps after it run on a different model
      case 'PostModelSwitch':
        addMainStop(event, 'model', TEXT.groups.model, '→ ' + String(data.to_model || '?').replace(/^claude-/, ''));
        break;
      // session start, config changes and memory loads are stops too (the first turn opens with the ones before its
      // prompt); the detail is kept short, since the route cuts it at 12 characters — the tooltip has it in full
      case 'SessionStart': addMainStop(event, 'context', describeEvent(event)[0], data.source || TEXT.event.startedSession); break;
      case 'ConfigChange': addMainStop(event, 'context', describeEvent(event)[0], underscoresToSpaces(data.source) || TEXT.event.changedConfig); break;
      case 'PreCompact': case 'InstructionsLoaded': {
        const [label, detail] = describeEvent(event);
        addMainStop(event, 'context', label, baseName(detail));
        break;
      }
      case 'Stop': case 'StopFailure': case 'SessionEnd': case 'Interrupt': endEvent = endEvent || event; break;
    }
  }
  for (const [toolUseId, stop] of openToolStops) stop.running = activity.runningTools.has(toolUseId);
  for (const branch of branches.values()) {
    if (!branch.closed) branch.running = [...activity.runningSubagents.keys()].some(id => String(id) === branch.id);
  }
  const maxLane = assignLanes(stops, branches);
  return { stops, branches, stepCount, toolCount, problemCount, endEvent, maxLane, lastMainStopIndex: route.lastMainStopIndex(), lastText, lastEventTime };
}

// ---- context at the end of a turn
// the last main-line model step's tokens: { context, cache_read, … } (null if none reported yet)
function turnEndStepTokens(turn) {
  let tokens = null;
  for (const event of turn.events) {
    const data = event.data;
    if (event.event === 'ModelStep' && !data?.subagent && data?.agent_id == null && data?.tokens?.context) tokens = data.tokens;
  }
  return tokens;
}
const turnEndContextTokens = turn => turnEndStepTokens(turn)?.context ?? null;

// the largest end-of-turn context of a session's turns (cached per list of turns: every turn's badge asks)
const largestContextCache = new WeakMap();
function largestTurnContext(sessionTurns) {
  if (!largestContextCache.has(sessionTurns)) largestContextCache.set(sessionTurns, Math.max(0, ...sessionTurns.map(turn => turnEndContextTokens(turn) || 0)));
  return largestContextCache.get(sessionTurns);
}

// context at the end of this turn, its change from the end of the turn before, and how full the window is
function turnContextInfo(sessionTurns, turn) {
  const stepTokens = turnEndStepTokens(turn);
  if (stepTokens == null) return null;
  const tokens = stepTokens.context;
  let previous = null;
  for (let index = sessionTurns.indexOf(turn) - 1; index >= 0 && previous == null; index--) previous = turnEndContextTokens(sessionTurns[index]);
  const session = state.sessions.get(turn.sessionId);
  const window = contextWindowFor(session?.agent, session?.context?.window, largestTurnContext(sessionTurns));
  const change = previous == null ? null : tokens - previous;
  return contextSize(tokens, change, window, change == null ? '' : signedTokens(change), stepTokens.cache_read ?? null);
}
