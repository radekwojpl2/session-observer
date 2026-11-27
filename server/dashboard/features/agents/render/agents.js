'use strict';
// Session Observer dashboard — what the page shows per agent: its colour (--agent on .agent-<id>, in both themes) and
// its option in the agent filter. Drawn from the agents the server lists, so a new agent needs no CSS or HTML.

const AGENT_COLOR_PATTERN = /^#[0-9a-f]{3,8}$/i; // colours come from the server; anything else is left out
const agentColorRules = theme => knownAgents()
  .filter(agent => AGENT_COLOR_PATTERN.test(agent.color?.[theme] || '') && /^[\w-]+$/.test(agent.id))
  .map(agent => `.agent-${agent.id} { --agent: ${agent.color[theme]}; }`).join('\n');

function renderAgentColors() {
  let style = document.getElementById('agentColors');
  if (!style) {
    style = document.createElement('style');
    style.id = 'agentColors';
    document.head.appendChild(style);
  }
  const dark = agentColorRules('dark').replace(/^\.agent-/gm, ':root[data-theme="dark"] .agent-');
  const darkBySystem = agentColorRules('dark').replace(/^\.agent-/gm, ':root:not([data-theme="light"]) .agent-');
  style.textContent = `${agentColorRules('light')}\n@media (prefers-color-scheme: dark) {\n${darkBySystem}\n}\n${dark}`;
}

// the agent filter's options: "all agents", then each agent the server knows
function renderAgentFilterOptions() {
  const select = document.getElementById('agent');
  if (!select) return;
  for (const option of [...select.options]) if (option.value) option.remove();
  for (const agent of knownAgents()) {
    const option = document.createElement('option');
    option.value = agent.id;
    option.textContent = agent.name;
    select.appendChild(option);
  }
  select.value = state.agent || '';
}
