'use strict';
// Session Observer dashboard — running totals of activity, rebuilt up to the replay cursor: counts by tool group, the
// tool calls and subagents in flight, and the busy sessions. The Overview's group cards and the Route read them.
function emptyActivity() {
  return {
    countsByGroup: {},
    runningTools: new Map(),     // tool_use_id → { group, start, sessionId }
    runningSubagents: new Map(), // agent id → { sessionId, start }
    busySessions: new Set(),
  };
}
let activity = emptyActivity();

// whether the stage needs drawing again (the view in #alt, and the activity behind it)
let activityChanged = true;
let viewNeedsDrawing = true;
const markViewDirty = () => { viewNeedsDrawing = true; };

const countGroup = group => { activity.countsByGroup[group] = (activity.countsByGroup[group] || 0) + 1; };

function endSessionActivity(sessionId) {
  for (const [id, tool] of activity.runningTools) if (tool.sessionId === sessionId) activity.runningTools.delete(id);
  for (const [id, subagent] of activity.runningSubagents) if (subagent.sessionId === sessionId) activity.runningSubagents.delete(id);
  activity.busySessions.delete(sessionId);
}

function applyEventToActivity(event) {
  const time = eventTime(event), data = event.data || {}, group = toolGroupOfEvent(event), toolUseId = data.tool_use_id;
  switch (event.event) {
    case 'PreToolUse':
      countGroup(group);
      if (toolUseId) activity.runningTools.set(toolUseId, { group, start: time, sessionId: event.session_id });
      activity.busySessions.add(event.session_id);
      break;
    case 'PostToolUse': case 'PostToolUseFailure':
      if (toolUseId) activity.runningTools.delete(toolUseId);
      break;
    case 'ModelStep': countGroup('model'); break;
    case 'UserPromptSubmit':
      countGroup('you');
      activity.busySessions.add(event.session_id);
      break;
    case 'Stop': case 'StopFailure': case 'SessionEnd': case 'Interrupt': endSessionActivity(event.session_id); break;
    case 'SubagentStart':
      countGroup('agents');
      activity.runningSubagents.set(data.agent_id || event.seq, { sessionId: event.session_id, start: time });
      break;
    case 'SubagentStop': activity.runningSubagents.delete(data.agent_id); break;
    case 'PermissionRequest': case 'Elicitation': case 'PermissionDenied': countGroup('you'); break;
    case 'InstructionsLoaded': case 'PreCompact': case 'PostCompact': countGroup('context'); break;
    case 'TaskCreated': case 'TaskCompleted': countGroup('other'); break;
  }
  activityChanged = true;
}

// all events up to the replay cursor (or all of them, live)
function rebuildActivity() {
  activity = emptyActivity();
  const limit = replayLimit();
  let index = 0;
  for (; index < state.events.length; index++) {
    const event = state.events[index];
    if (eventTime(event) > limit) break;
    applyEventToActivity(event);
  }
  state.replayIndex = index;
  activityChanged = true;
}
