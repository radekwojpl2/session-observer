'use strict';
// Session Observer dashboard — what an event means: its tool group, its badges and icon, and its label and description.
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure']);
const isToolResult = event => event.event === 'PostToolUse' || event.event === 'PostToolUseFailure';

// a tool event's languages / tools (worked out once per event), and the first of them
function techsOfEvent(event) {
  if (event._techs === undefined) event._techs = TOOL_EVENTS.has(event.event) ? techsOfToolCall(event.data?.tool_name, event.data?.tool_input) : [];
  return event._techs;
}
const firstTechOfEvent = event => techsOfEvent(event)[0] || null;

// the icons for a tool call: its language / tool badges when there are any, otherwise its group's icon
const eventIconHtml = (event, group, max) => techBadgeIcons(techsOfEvent(event), max) || iconSvg(group);
const toolIconHtml = (tool, input, group) => techBadgeIcons(techsOfToolCall(tool, input)) || iconSvg(group);

const BROWSER_MCP = /chrome|browser|playwright|puppeteer/i;

function toolGroupOf(tool, input) {
  if (!tool) return 'other';
  if (SHELL_TOOLS.has(tool)) return /^\s*(git|gh)\b/.test((input && input.command) || '') ? 'git' : 'shell';
  if (FILE_TOOLS.has(tool)) return 'files';
  if (tool === 'WebFetch' || tool === 'WebSearch') return 'network';
  if (tool === 'Skill') return 'skills';
  if (isSubagentCall(tool) || tool === 'SendMessage') return 'agents';
  if (tool === 'AskUserQuestion') return 'you';
  if (tool.startsWith('mcp__')) return BROWSER_MCP.test(tool) ? 'browser' : 'mcp';
  return 'other';
}

const GROUP_BY_EVENT = {
  ModelStep: 'model', ModelText: 'model', PreModelSwitch: 'model', PostModelSwitch: 'model',
  UserPromptSubmit: 'you', UserPromptExpansion: 'you', Elicitation: 'you', ElicitationResult: 'you', PermissionRequest: 'you', PermissionDenied: 'you',
  SubagentStart: 'agents', SubagentStop: 'agents', TeammateIdle: 'agents',
  InstructionsLoaded: 'context', PreCompact: 'context', PostCompact: 'context', ConfigChange: 'context', CwdChanged: 'context', Setup: 'context',
  TaskCreated: 'other', TaskCompleted: 'other',
  FileChanged: 'files', DirectoryAdded: 'files', WorktreeCreate: 'files', WorktreeRemove: 'files',
};

// the tool group an event belongs to (worked out once per event); null for events outside every group
function toolGroupOfEvent(event) {
  if (event._group !== undefined) return event._group;
  const data = event.data || {};
  const group = TOOL_EVENTS.has(event.event) ? toolGroupOf(data.tool_name, data.tool_input)
    : Object.hasOwn(GROUP_BY_EVENT, event.event) ? GROUP_BY_EVENT[event.event] : null;
  return (event._group = group);
}

const isProblemEvent = event => event.category === 'error' || event.event === 'PermissionDenied';

function webFetchTarget(url) {
  try {
    const parsed = new URL(url);
    return parsed.host + parsed.pathname;
  } catch {
    return url;
  }
}

// the most telling argument of a tool call, as text
function toolArgument(data) {
  const input = data.tool_input || {}, tool = data.tool_name;
  if (tool === 'Skill') return input.skill || input.name;
  if (tool === 'AskUserQuestion') return (input.questions || []).map(question => question.question).join(' | ');
  if (isSubagentCall(tool)) return [input.subagent_type, input.description].filter(Boolean).join(' — ');
  if (tool === 'WebFetch' && input.url) return webFetchTarget(input.url);
  if (tool === PATCH_TOOL) return patchedFiles(input).join(', ') || patchTextOf(input);
  return input.command || input.file_path || input.notebook_path || input.path || input.pattern || input.url || input.query
    || input.description || input.subject || input.prompt
    || Object.values(input).find(value => typeof value === 'string')
    || (Object.keys(input).length ? JSON.stringify(input) : '');
}

// a tool's name as shown: an MCP tool without its "mcp__server__" prefix
function toolDisplayName(tool) {
  if (!tool) return '?';
  if (!tool.startsWith('mcp__')) return tool;
  const parts = tool.split('__');
  return parts.slice(2).join('__') || parts[1];
}

const agentLabel = data => (data.subagent ? TEXT.subagent : TEXT.groups.model);

function describeModelStep(data) {
  const words = TEXT.event;
  if (data.tools && data.tools.length) return words.calls(data.tools.map(toolDisplayName).join(', '));
  const outcome = data.stop_reason === 'end_turn' ? words.replied : words.thought;
  return outcome + (data.tokens?.output ? ' · ' + TEXT.outTokens(formatCompactNumber(data.tokens.output)) : '');
}

function describeToolResultAnswer(data) {
  const response = data.tool_response;
  return TEXT.event.answered + ': ' + shorten(typeof response === 'string' ? response : JSON.stringify(response?.answers ?? response), 200);
}

// Each event as [short label, detail text], for rows, tooltips and route stops.
const DESCRIBE_EVENT = {
  ModelStep: data => [agentLabel(data), describeModelStep(data)],
  ModelText: data => [agentLabel(data), (data.kind === 'thinking' ? TEXT.event.thinking + ': ' : '') + data.text],
  UserPromptSubmit: data => [TEXT.groups.you, data.prompt],
  UserPromptExpansion: data => [TEXT.event.expanded, data.prompt || data.expanded_prompt],
  PreToolUse: data => [toolDisplayName(data.tool_name), toolArgument(data)],
  PostToolUse: data => [toolDisplayName(data.tool_name), data.tool_name === 'AskUserQuestion' ? describeToolResultAnswer(data) : toolArgument(data)],
  PostToolUseFailure: data => [toolDisplayName(data.tool_name), `${TEXT.event.failed}: ${shorten(data.error || data.tool_response?.error || toolArgument(data), 200)}`],
  PermissionRequest: data => [TEXT.event.permission, `${TEXT.event.asked} · ${data.tool_name || ''} ${shorten(toolArgument(data), 120)}`],
  PermissionDenied: data => [TEXT.event.denied, `${data.tool_name || ''} ${data.reason || ''}`],
  Notification: data => [TEXT.categories.notification, data.message || data.notification_type],
  MessageDisplay: data => [TEXT.event.message, data.message || data.text],
  Stop: data => [TEXT.event.turn, data.last_assistant_message || TEXT.event.done],
  StopFailure: data => [TEXT.event.turnFailed, data.error || data.reason],
  Interrupt: () => [TEXT.event.turn, TEXT.interruptedByUser],
  SubagentStart: data => [TEXT.subagent, `${TEXT.event.started} ${data.agent_type || data.agent_id || ''}`],
  SubagentStop: data => [TEXT.subagent, `${TEXT.event.finished} ${[data.agent_type, shorten(data.last_assistant_message, 120)].filter(Boolean).join(' — ')}`],
  TaskCreated: data => [TEXT.categories.task, TEXT.event.created + ' ' + (data.subject || data.task?.subject || data.description || '')],
  TaskCompleted: data => [TEXT.categories.task, TEXT.event.completed + ' ' + (data.subject || data.task?.subject || '')],
  SessionStart: data => [TEXT.event.session, [TEXT.event.startedSession, data.source, data.model?.id || data.model].filter(Boolean).join(' · ')],
  SessionEnd: data => [TEXT.event.session, TEXT.event.ended + ' ' + (data.reason || '')],
  PreCompact: data => [TEXT.categories.compact, TEXT.event.compacting + ' · ' + (data.trigger || '')],
  PostCompact: data => [TEXT.categories.compact, TEXT.event.compacted + ' · ' + (data.trigger || '')],
  InstructionsLoaded: data => [TEXT.event.memory, data.file_path || data.path || (data.files || []).join(', ')],
  Elicitation: data => [TEXT.event.mcpAsks, data.message || data.server_name],
  ElicitationResult: data => [TEXT.groups.you, TEXT.event.answeredMcp + ': ' + (data.action || JSON.stringify(data.content || ''))],
  PreModelSwitch: data => [TEXT.event.modelSwitch, describeModelSwitch(data)],
  PostModelSwitch: data => [TEXT.event.modelSwitched, describeModelSwitch(data)],
  CwdChanged: data => ['cwd', data.old_cwd || data.new_cwd ? `${data.old_cwd || '?'} → ${data.new_cwd || '?'}` : data.cwd],
  FileChanged: data => [TEXT.event.file, `${data.event || TEXT.event.changed} ${data.file_path || data.path || ''}`],
  ConfigChange: data => [TEXT.event.config, `${TEXT.event.changedConfig} ${underscoresToSpaces(data.source || 'settings')}${data.file_path ? ' · ' + data.file_path : ''}`],
  DirectoryAdded: data => [TEXT.event.directory, `${TEXT.event.added} ${data.directory || ''}${data.source ? ` · ${TEXT.event.via} ` + underscoresToSpaces(data.source) : ''}`],
  WorktreeCreate: data => [TEXT.event.worktree, TEXT.event.createdWorktree + ' ' + (data.name || '')],
  WorktreeRemove: data => [TEXT.event.worktree, TEXT.event.removed + ' ' + (data.worktree_path || '')],
  Setup: data => [TEXT.event.setup, data.trigger || ''],
  TeammateIdle: data => [TEXT.event.teammate, `${TEXT.event.idle} ${[data.teammate_name, data.team_name && `(${data.team_name})`].filter(Boolean).join(' ')}`],
};

function describeModelSwitch(data) {
  return `${data.from_model || '?'} → ${data.to_model || '?'}${data.source ? ' · ' + data.source : ''}`;
}

// [short label, detail text]
function describeEvent(event) {
  const describe = Object.hasOwn(DESCRIBE_EVENT, event.event) ? DESCRIBE_EVENT[event.event] : null;
  return describe ? describe(event.data || {}) : [event.event, ''];
}

const eventTooltip = event => escapeHtml(describeEvent(event).map(part => shorten(part, 160)).join(' · '));
