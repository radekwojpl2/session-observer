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

// every agent's tools with a role ('command', 'subagent', 'subagentCall', 'question', 'task', 'patch'), as one set:
// tool names don't clash between agents, and an event's role shouldn't depend on guessing its agent
const toolsWithRole = role => new Set(AGENTS.flatMap(agent => agent.tools.roles[role] || []));

// what the dashboard gets: everything but server-side behaviour
const publicAgents = () => AGENTS.map(({ id, name, shortName, color, tools }) => ({ id, name, shortName, color, tools }));

module.exports = { AGENT_IDS, DEFAULT_AGENT, agentById, isKnownAgent, toolsWithRole, publicAgents };
