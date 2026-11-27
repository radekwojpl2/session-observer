// The event contract: every event the log holds, the fields the server and the dashboard read from it, and which
// agents send it. The one source for docs/events.md (written by scripts/events-doc.js), the event categories and
// the tests. An agent's own events are translated into these; anything else it sends is kept, never fatal.
'use strict';

// bumped when a field or event is renamed or removed (adding one is free); stored on each event as `v`
const CONTRACT_VERSION = 1;

// a field: its type ('string' | 'number' | 'boolean' | 'object' | 'array' | 'any'), whether every event of its kind
// has it, and what it holds
const field = (type, about, required = false) => ({ type, required, about });

// the line the log holds for one event
const ENVELOPE = {
  ts: field('string', 'When it happened, ISO 8601 UTC.', true),
  event: field('string', 'The event name: one of the events below, or any other the agent sends.', true),
  session_id: field('string', 'The session it belongs to (`unknown` when the agent sent none).', true),
  agent: field('string', 'The agent that sent it: `claude`, `codex`, …', true),
  data: field('object', 'The fields below, as the agent sent them, long strings and arrays cut short.', true),
  parents: field('array', 'The agent sessions this one was started from, nearest last: `[{ agent, session_id, tool_call_id? }]`.'),
  v: field('number', 'The contract version the event was written with (none: version 1).'),
  native: field('object', 'For agents whose own events are translated: the event as the agent sent it, `{ event, data }`.'),
  synthetic: field('boolean', 'Made by the server (from a transcript or a rollout file), not sent by the agent.'),
};

// fields many events carry
const COMMON = {
  cwd: field('string', 'The working directory.'),
  transcript_path: field('string', "The agent's own session file (Claude Code's transcript, Codex's rollout)."),
  permission_mode: field('string', 'The permission mode the agent runs in.'),
  model: field('any', 'The model: a name, or `{ id, display_name }`.'),
  agent_id: field('string', 'Set when a subagent sent it: the subagent.'),
  agent_type: field('string', "The subagent's type."),
};

const BOTH = ['claude', 'codex'];
const CLAUDE = ['claude'];
const SERVER = ['server'];

// `category`: what the dashboard colours and counts it as (tool events take theirs from the tool, see
// features/sessions/event-categories.js); `agents`: who sends it ('server' = made by the server)
const EVENTS = {
  SessionStart: {
    category: 'lifecycle', agents: BOTH, about: 'A session starts or resumes.',
    fields: { source: field('string', 'Why: `startup`, `resume`, `clear`, `compact`.'), model: COMMON.model, cwd: COMMON.cwd, transcript_path: COMMON.transcript_path },
  },
  Setup: { category: 'lifecycle', agents: CLAUDE, about: 'The agent sets itself up before a session.', fields: {} },
  UserPromptSubmit: {
    category: 'prompt', agents: BOTH, about: 'You send a prompt.',
    fields: { prompt: field('string', 'What you wrote.', true), permission_mode: COMMON.permission_mode },
  },
  UserPromptExpansion: {
    category: 'prompt', agents: CLAUDE, about: 'A slash command or reference expands your prompt.',
    fields: { expanded_prompt: field('string', 'The prompt after expansion.') },
  },
  PreToolUse: {
    category: null, agents: BOTH, about: 'A tool call starts.',
    fields: {
      tool_name: field('string', "The tool's name as the agent calls it (`Read`, `Bash`, `apply_patch`, `mcp__server__tool`).", true),
      tool_input: field('any', "The call's arguments."),
      tool_use_id: field('string', 'The call id; pairs the call with its result.'),
      agent_id: COMMON.agent_id,
    },
  },
  PostToolUse: {
    category: null, agents: BOTH, about: 'A tool call finishes.',
    fields: {
      tool_name: field('string', "The tool's name.", true),
      tool_input: field('any', "The call's arguments."),
      tool_response: field('any', 'What the tool returned.'),
      tool_use_id: field('string', 'The call id.'),
      duration_ms: field('number', 'How long it took, when the agent says.'),
    },
  },
  PostToolUseFailure: {
    category: 'error', agents: CLAUDE, about: 'A tool call fails.',
    fields: {
      tool_name: field('string', "The tool's name.", true),
      tool_input: field('any', "The call's arguments."),
      tool_use_id: field('string', 'The call id.'),
      error: field('any', 'Why it failed.'),
      is_interrupt: field('boolean', 'You stopped it.'),
    },
  },
  PostToolBatch: {
    category: null, agents: CLAUDE, about: 'A batch of parallel tool calls finishes (repeats the tool rows; hidden in Details).',
    fields: { tool_calls: field('array', 'The calls of the batch.') },
  },
  PermissionRequest: {
    category: 'permission', agents: BOTH, about: 'The agent asks you to allow a tool call.',
    fields: { tool_name: field('string', 'The tool.'), tool_input: field('any', "The call's arguments."), permission_suggestions: field('array', 'The rules it offers.') },
  },
  PermissionDenied: { category: 'permission', agents: CLAUDE, about: 'A tool call is denied.', fields: { tool_name: field('string', 'The tool.') } },
  Notification: {
    category: 'notification', agents: CLAUDE, about: 'The agent notifies you (waiting for input, finished, …).',
    fields: { message: field('string', 'The text.'), notification_type: field('string', 'What kind.') },
  },
  MessageDisplay: { category: 'notification', agents: CLAUDE, about: "The agent's reply as it is shown (repeats ModelText; hidden in Details).", fields: { delta: field('string', 'Text shown.') } },
  Elicitation: { category: 'question', agents: CLAUDE, about: 'An MCP server asks you for input.', fields: { server_name: field('string', 'The MCP server.') } },
  ElicitationResult: { category: 'question', agents: CLAUDE, about: 'You answer an MCP server.', fields: { action: field('string', 'What you did.') } },
  SubagentStart: {
    category: 'subagent', agents: BOTH, about: 'A subagent starts, inside this session.',
    fields: { agent_id: field('string', 'The subagent.', true), agent_type: COMMON.agent_type },
  },
  SubagentStop: {
    category: 'subagent', agents: BOTH, about: 'A subagent finishes.',
    fields: { agent_id: field('string', 'The subagent.', true), agent_type: COMMON.agent_type, agent_transcript_path: field('string', "The subagent's transcript."), last_assistant_message: field('string', 'Its last reply.') },
  },
  TeammateIdle: { category: 'subagent', agents: CLAUDE, about: 'A teammate waits for work.', fields: { teammate_name: field('string', 'The teammate.'), team_name: field('string', 'The team.') } },
  TaskCreated: { category: 'task', agents: CLAUDE, about: 'A background task starts.', fields: { subject: field('string', 'What it does.') } },
  TaskCompleted: { category: 'task', agents: CLAUDE, about: 'A background task finishes.', fields: { subject: field('string', 'What it did.') } },
  PreCompact: { category: 'compact', agents: BOTH, about: 'The context is about to be compacted.', fields: { trigger: field('string', '`manual` or `auto`.') } },
  PostCompact: { category: 'compact', agents: BOTH, about: 'The context was compacted.', fields: { trigger: field('string', '`manual` or `auto`.') } },
  InstructionsLoaded: {
    category: 'context', agents: CLAUDE, about: 'An instruction file (CLAUDE.md, AGENTS.md, rules, memory) is loaded.',
    fields: { file_path: field('string', 'The file.') },
  },
  Stop: {
    category: 'lifecycle', agents: BOTH, about: 'The agent finishes its turn.',
    fields: { last_assistant_message: field('string', 'Its last reply.'), stop_hook_active: field('boolean', 'A Stop hook made it continue.') },
  },
  StopFailure: { category: 'error', agents: CLAUDE, about: 'The turn ends with an error.', fields: { error: field('any', 'Why.') } },
  Interrupt: { category: 'lifecycle', agents: [...BOTH, 'server'], about: 'You stop the agent mid-turn.', fields: {} },
  SessionEnd: { category: 'lifecycle', agents: BOTH, about: 'The session ends.', fields: { reason: field('string', 'Why: `exit`, `clear`, `logout`, …') } },
  PreModelRequest: {
    category: 'env', agents: ['codex'], about: 'Codex sends a request to the model.',
    fields: { request_id: field('string', 'The request.'), turn_id: field('string', 'The turn.') },
  },
  PostModelRequest: {
    category: 'env', agents: ['codex'], about: "Codex gets the model's answer. The server turns it into a ModelStep.",
    fields: { status: field('string', 'How it ended.'), token_usage: field('object', 'Token counts, OpenAI names.'), response_id: field('string', 'The response.'), error: field('any', 'Why it failed.') },
  },
  ModelStep: {
    category: 'model', agents: SERVER, about: "One model response: from Claude Code's transcript, or a Codex PostModelRequest.",
    fields: {
      tokens: field('object', '`{ input, output, cache_read, cache_write, context }`.', true),
      model: field('string', 'The model.'),
      stop_reason: field('string', 'Why the response ended.'),
      tools: field('array', 'The tools it called.'),
      tool_ids: field('array', 'Their call ids, in the same order.'),
      msg_id: field('string', 'The response id.'),
      subagent: field('boolean', 'A subagent made it.'),
      agent_id: COMMON.agent_id,
    },
  },
  ModelText: {
    category: 'model', agents: SERVER, about: 'A block of text or thinking the model wrote.',
    fields: {
      kind: field('string', '`text` or `thinking`.', true),
      text: field('string', 'The text, cut short.', true),
      msg_id: field('string', 'The response it is part of.'),
      subagent: field('boolean', 'A subagent wrote it.'),
      agent_id: COMMON.agent_id,
    },
  },
};

const TYPE_CHECKS = {
  string: value => typeof value === 'string',
  number: value => typeof value === 'number' && Number.isFinite(value),
  boolean: value => typeof value === 'boolean',
  object: value => value !== null && typeof value === 'object' && !Array.isArray(value),
  array: value => Array.isArray(value),
  any: () => true,
};

function fieldProblems(fields, values, at) {
  const problems = [];
  for (const [name, spec] of Object.entries(fields)) {
    const value = values[name];
    if (value === undefined || value === null) {
      if (spec.required) problems.push(`${at}${name} is missing`);
    } else if (!TYPE_CHECKS[spec.type](value)) problems.push(`${at}${name} should be a ${spec.type}`);
  }
  return problems;
}

// what is wrong with an event, as a list of sentences (empty: it follows the contract). Events the contract doesn't
// know only need a valid envelope: agents add events, and they are kept.
function eventProblems(event) {
  if (!TYPE_CHECKS.object(event)) return ['the event is not an object'];
  const problems = fieldProblems(ENVELOPE, event, '');
  if (typeof event.ts === 'string' && Number.isNaN(Date.parse(event.ts))) problems.push('ts is not a date');
  const known = EVENTS[event.event];
  if (known && TYPE_CHECKS.object(event.data)) problems.push(...fieldProblems(known.fields, event.data, 'data.'));
  return problems;
}

module.exports = { CONTRACT_VERSION, ENVELOPE, COMMON, EVENTS, eventProblems };
