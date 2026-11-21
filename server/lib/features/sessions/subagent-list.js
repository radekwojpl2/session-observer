// A session's subagents, for the Home view's tree: each one's type, what it was asked to do, and whether it is still
// running. The description comes from the call that started it (Agent / Task / spawn_agent), which comes just before
// its SubagentStart.
'use strict';
const { SUBAGENT_TOOLS } = require('./event-categories');

const SUBAGENTS_KEPT_MAX = 50;
const DESCRIPTION_MAX = 200;

function trackSubagents(session, event, data) {
  if (event.event === 'PreToolUse' && SUBAGENT_TOOLS.has(data.tool_name) && data.tool_name !== 'SendMessage') {
    const input = data.tool_input || {};
    session.subagentDescriptionsWaiting.push(String(input.description || input.message || input.prompt || '').slice(0, DESCRIPTION_MAX));
  } else if (event.event === 'SubagentStart' && data.agent_id != null) {
    session.subagentList.push({
      id: data.agent_id, type: data.agent_type || null,
      description: session.subagentDescriptionsWaiting.shift() || '', started: event.ts, ended: null,
    });
    if (session.subagentList.length > SUBAGENTS_KEPT_MAX) session.subagentList.splice(0, session.subagentList.length - SUBAGENTS_KEPT_MAX);
  } else if (event.event === 'SubagentStop' && data.agent_id != null) {
    const subagent = session.subagentList.find(candidate => candidate.id === data.agent_id && !candidate.ended);
    if (subagent) subagent.ended = event.ts;
  } else if (event.event === 'Stop' || event.event === 'SessionEnd' || event.event === 'Interrupt') {
    // a turn that ends ends its subagents too, whether or not each one said so
    // (an interrupt is read from the transcript, late: a subagent started after it goes on)
    for (const subagent of session.subagentList) if (!subagent.ended && subagent.started <= event.ts) subagent.ended = event.ts;
    session.subagentDescriptionsWaiting = [];
  }
}

module.exports = { trackSubagents };
