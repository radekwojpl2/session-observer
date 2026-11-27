'use strict';
// Session Observer dashboard — the agents a session can come from, as the server lists them (/api/agents, from
// server/lib/features/agents/): each one's name, colour and tool map. Every event says which agent sent it (the server
// stamps it); a session's agent is its events' agent.
const DEFAULT_AGENT = 'claude';
const CODEX = 'codex'; // Codex-only views (its Context note, its reported window) name it until they move to its folder
let AGENTS = new Map(); // id → { id, name, shortName, color, tools }

// every agent's tools, by what the dashboard does with them; filled by setAgents()
const FILE_TOOLS = new Set();          // work on files: the Files group of the map
const SHELL_TOOLS = new Set();         // run or watch shell commands: the Shell group
const COMMAND_TOOLS = new Set();       // run input.command in a shell
const SUBAGENT_CALL_TOOLS = new Set(); // start a subagent
const PATCH_TOOLS = new Set();         // edit files with a patch in their input (Codex's apply_patch)
const PATH_FIELDS = [];                // where a file tool's input names its file

function setAgents(list) {
  AGENTS = new Map((Array.isArray(list) ? list : []).map(agent => [agent.id, agent]));
  for (const set of [FILE_TOOLS, SHELL_TOOLS, COMMAND_TOOLS, SUBAGENT_CALL_TOOLS, PATCH_TOOLS]) set.clear();
  PATH_FIELDS.length = 0;
  for (const { tools } of AGENTS.values()) {
    const add = (set, names) => (names || []).forEach(name => set.add(name));
    add(FILE_TOOLS, tools?.groups?.files);
    add(SHELL_TOOLS, tools?.groups?.shell);
    add(COMMAND_TOOLS, tools?.roles?.command);
    add(SUBAGENT_CALL_TOOLS, tools?.roles?.subagentCall);
    add(PATCH_TOOLS, tools?.roles?.patch);
    for (const field of tools?.pathFields || []) if (!PATH_FIELDS.includes(field)) PATH_FIELDS.push(field);
  }
}

const knownAgents = () => [...AGENTS.values()];
// a known agent's key (an unknown or missing one counts as the default), safe to use in a class name
const agentKey = agent => (AGENTS.has(agent) ? agent : DEFAULT_AGENT);
const agentName = agent => AGENTS.get(agentKey(agent))?.name || agentKey(agent);
const agentShortName = agent => AGENTS.get(agentKey(agent))?.shortName || agentName(agent);
const agentOfSession = sessionId => state.sessions.get(sessionId)?.agent || DEFAULT_AGENT;
const agentOfEvent = event => event.agent || agentOfSession(event.session_id);
// a class naming the agent an event comes from ("agent-codex"), for what is labelled or colored by agent
const agentClass = event => 'agent-' + agentKey(agentOfEvent(event));
// the agent filter: an empty choice shows every agent
const isAgentShown = agent => !state.agent || agent === state.agent;
// only once sessions from more than one agent are loaded do the agent badges and the agent filter show
const seesSeveralAgents = () => new Set([...state.sessions.values()].map(session => session.agent || DEFAULT_AGENT)).size > 1;
