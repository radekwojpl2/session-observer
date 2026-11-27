// One session's whole context, in full, for the Context view (GET /api/context). Each agent builds its own from its
// session file (features/agents/<agent>/server.js, sessionContext): Claude Code from its transcript, Codex from its
// rollout. The readers they share (transcript rows, system prompt, conversation items) are in this folder.
'use strict';
const { agentServer, DEFAULT_AGENT } = require('../agents/registry');

function sessionContext(session) {
  // (a session whose agent is unknown came from the default agent, as its events did)
  const build = (agentServer(session.agent) || agentServer(DEFAULT_AGENT))?.sessionContext;
  if (!build) return { error: 'no context view for this agent', transcript: session.transcript_path || null };
  return build(session);
}

module.exports = { sessionContext };
