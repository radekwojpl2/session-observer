'use strict';
// Session Observer dashboard — the event model's vocabulary: tool groups, event categories, and tool families.
// The tool groups ("stations" of the map): what an event works with. Each has an icon and a colour (--s-<id> in CSS).
const TOOL_GROUPS = ['you', 'model', 'files', 'shell', 'git', 'mcp', 'network', 'browser', 'agents', 'skills', 'context', 'other']
  .map(id => ({ id, label: TEXT.groups[id] }));
const TOOL_GROUP_BY_ID = Object.fromEntries(TOOL_GROUPS.map(group => [group.id, group]));
// event categories (set by the server), with their labels in the chosen language
const CATEGORY_LABELS = Object.fromEntries(['model', 'prompt', 'tool', 'skill', 'question', 'subagent', 'task', 'mcp', 'permission',
  'error', 'notification', 'compact', 'context', 'lifecycle', 'env'].map(category => [category, TEXT.categories[category]]));
// the tool group whose colour a category's chip uses ('err' is the error colour)
const CATEGORY_COLOR = {
  model: 'model', prompt: 'you', tool: 'files', skill: 'skills', question: 'you', subagent: 'agents', task: 'other', mcp: 'mcp',
  permission: 'git', error: 'err', notification: 'agents', compact: 'context', context: 'context', lifecycle: 'other', env: 'other',
};
// hidden from the Details list: MessageDisplay repeats the model's text, PostToolBatch repeats the tool rows
const HIDDEN_IN_EVENT_LIST = new Set(['MessageDisplay', 'PostToolBatch']);
// Codex's own tools sit next to Claude Code's: apply_patch edits files, exec_command / shell run commands,
// spawn_agent starts a subagent. pi's and omp's are lower case: read, write, edit, grep, find, ls, bash…
const PATCH_TOOL = 'apply_patch';
const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'NotebookRead', 'Glob', 'Grep', 'LS', PATCH_TOOL,
  'read', 'write', 'edit', 'grep', 'find', 'ls', 'glob']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'BashOutput', 'KillShell', 'KillBash', 'Monitor', 'exec_command', 'shell', 'local_shell', 'bash']);
const SUBAGENT_CALL_TOOLS = new Set(['Agent', 'Task', 'spawn_agent']); // the tool calls that start a subagent

// an apply_patch call's patch text, and the files it adds, changes, deletes or moves to ("*** Update File: a.ts")
const patchTextOf = input => {
  const patch = input?.command ?? input?.patch ?? input?.input ?? '';
  return Array.isArray(patch) ? patch.join('\n') : String(patch);
};
const PATCH_FILE_LINE = /^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm;
const patchedFiles = input => [...new Set([...patchTextOf(input).matchAll(PATCH_FILE_LINE)].map(match => match[1].trim()))];
// the files a file tool call works on (pi and omp name the file `path`)
const filesOfToolCall = (tool, input) => (tool === PATCH_TOOL ? patchedFiles(input) : [input?.file_path || input?.notebook_path || input?.path].filter(Boolean));

// an event's time in ms, parsed once
const eventTime = event => event._t ?? (event._t = Date.parse(event.ts));
const isSubagentCall = toolName => SUBAGENT_CALL_TOOLS.has(toolName);
