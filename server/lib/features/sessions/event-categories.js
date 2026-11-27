// The category of each event: what the dashboard colours and counts it as.
'use strict';
const { EVENTS } = require('../../building-blocks/event-contract');

const QUESTION_TOOLS = new Set(['AskUserQuestion', 'request_user_input', 'request_user_input_async']); // Codex's async form also waits for the next user message
const SUBAGENT_TOOLS = new Set(['Agent', 'Task', 'SendMessage', 'spawn_agent']); // spawn_agent: Codex
const TASK_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TaskStop', 'update_plan']);

// each event's category, from the contract; tool events (category null there) take theirs from the tool
const CATEGORY_BY_EVENT = new Map(Object.entries(EVENTS).filter(([, spec]) => spec.category).map(([name, spec]) => [name, spec.category]));
const TOOL_EVENTS = new Set(Object.entries(EVENTS).filter(([, spec]) => !spec.category).map(([name]) => name));

function toolCategory(toolName) {
  if (toolName === 'Skill') return 'skill';
  if (QUESTION_TOOLS.has(toolName)) return 'question';
  if (SUBAGENT_TOOLS.has(toolName)) return 'subagent';
  if (TASK_TOOLS.has(toolName)) return 'task';
  if (toolName.startsWith('mcp__')) return 'mcp';
  return 'tool';
}

function categoryOf(event) {
  if (TOOL_EVENTS.has(event.event)) return toolCategory((event.data || {}).tool_name || '');
  // everything else (ConfigChange, CwdChanged, FileChanged, Worktree*, model switches…) is the environment
  return CATEGORY_BY_EVENT.get(event.event) || 'env';
}

module.exports = { QUESTION_TOOLS, categoryOf, SUBAGENT_TOOLS };
