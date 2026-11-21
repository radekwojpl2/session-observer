// The category of each event: what the dashboard colours and counts it as.
'use strict';

const QUESTION_TOOLS = new Set(['AskUserQuestion', 'request_user_input']); // request_user_input: Codex
const SUBAGENT_TOOLS = new Set(['Agent', 'Task', 'SendMessage', 'spawn_agent']); // spawn_agent: Codex
const TASK_TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TaskStop', 'update_plan']);

const CATEGORY_BY_EVENT = new Map(Object.entries({
  ModelStep: 'model', ModelText: 'model',
  UserPromptSubmit: 'prompt', UserPromptExpansion: 'prompt',
  PermissionRequest: 'permission', PermissionDenied: 'permission',
  PostToolUseFailure: 'error', StopFailure: 'error',
  SubagentStart: 'subagent', SubagentStop: 'subagent', TeammateIdle: 'subagent',
  TaskCreated: 'task', TaskCompleted: 'task',
  Notification: 'notification', MessageDisplay: 'notification',
  Elicitation: 'question', ElicitationResult: 'question',
  PreCompact: 'compact', PostCompact: 'compact',
  InstructionsLoaded: 'context',
  SessionStart: 'lifecycle', SessionEnd: 'lifecycle', Setup: 'lifecycle', Stop: 'lifecycle', Interrupt: 'lifecycle',
}));
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolBatch']);

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
