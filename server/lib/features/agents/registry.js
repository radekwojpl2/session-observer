// The agents Session Observer knows: each one's folder holds its manifest (name, colour, command…), its tool map and
// its recorded sessions. Other features look an agent up here instead of naming one; the dashboard gets the same
// through /api/agents. Adding an agent: its folder, and one line in AGENT_IDS.
'use strict';

const AGENT_IDS = ['claude', 'codex']; // in the order the dashboard lists them
const DEFAULT_AGENT = 'claude'; // events logged before the hook named its agent came from Claude Code

const AGENTS = AGENT_IDS.map(id => ({ ...require(`./${id}/manifest`), tools: require(`./${id}/tools`) }));
const AGENT_BY_ID = new Map(AGENTS.map(agent => [agent.id, agent]));

const agentById = id => AGENT_BY_ID.get(id) || null;
const isKnownAgent = id => AGENT_BY_ID.has(id);

// an agent's server hooks (<agent>/server.js): how its model steps, session file and Context view differ from the
// default, Claude Code's. Loaded when first asked for, so the agents' modules can use other features. null: none.
const serverHooks = new Map();
function agentServer(id) {
  if (!serverHooks.has(id)) {
    let hooks = null;
    if (isKnownAgent(id)) {
      try { hooks = require(`./${id}/server`); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND' || !String(error.message).includes(`${id}/server`)) throw error; }
    }
    serverHooks.set(id, hooks);
  }
  return serverHooks.get(id);
}
const allAgentServers = () => AGENT_IDS.map(agentServer).filter(Boolean);

// every agent's tools with a role ('command', 'subagent', 'subagentCall', 'question', 'task', 'patch'), as one set:
// tool names don't clash between agents, and an event's role shouldn't depend on guessing its agent
const toolsWithRole = role => new Set(AGENTS.flatMap(agent => agent.tools.roles[role] || []));

// what the dashboard gets: names, colours, tools, and how its context window and Context view differ
const publicAgents = () => AGENTS.map(({ id, name, shortName, color, tools, reportsContextWindow, autocompactBuffer, contextNoteKey }) =>
  ({ id, name, shortName, color, tools, reportsContextWindow, autocompactBuffer, contextNoteKey }));

module.exports = { AGENT_IDS, DEFAULT_AGENT, agentById, isKnownAgent, toolsWithRole, publicAgents, agentServer, allAgentServers };
