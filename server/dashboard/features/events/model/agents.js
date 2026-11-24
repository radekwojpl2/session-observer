'use strict';
// Session Observer dashboard — the agents a session comes from: Claude Code, Codex, pi or omp (oh-my-pi). Every event says which (the
// server stamps it); a session's agent is its events' agent.
const DEFAULT_AGENT = 'claude';
const CODEX = 'codex';
const AGENT_NAMES = { claude: 'Claude Code', codex: 'Codex', pi: 'pi', omp: 'omp' }; // product names: the same in every language

// a known agent's key (an unknown or missing one counts as the default), safe to use in a class name
const agentKey = agent => (agent in AGENT_NAMES ? agent : DEFAULT_AGENT);
const agentName = agent => AGENT_NAMES[agentKey(agent)];
const agentOfSession = sessionId => state.sessions.get(sessionId)?.agent || DEFAULT_AGENT;
const agentOfEvent = event => event.agent || agentOfSession(event.session_id);
// a class naming the agent an event comes from ("agent-codex"), for what is labelled or colored by agent
const agentClass = event => 'agent-' + agentKey(agentOfEvent(event));
// the agent filter: an empty choice shows every agent
const isAgentShown = agent => !state.agent || agent === state.agent;
// only once sessions from more than one agent are loaded do the agent badges and the agent filter show
const seesSeveralAgents = () => new Set([...state.sessions.values()].map(session => session.agent || DEFAULT_AGENT)).size > 1;
