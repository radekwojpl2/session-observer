# Events

<!-- Written by `node scripts/events-doc.js` from server/lib/building-blocks/event-contract.js. Do not edit by hand. -->

Every line of a session log is one event. This is the contract (version 1) the server and the
dashboard read. Each agent's own events are turned into these; anything else an agent sends is kept as it came,
and an event or field the contract doesn't know is never an error.

## When events change

- **An agent changes its own events:** only that agent's translation changes; this contract stays.
- **Adding an event or an optional field** is free.
- **Renaming or removing one** bumps the contract version, which each event stores as `v`. The server keeps
  reading older events, because logs are kept for days.
- This file is generated: change `event-contract.js`, then run `node scripts/events-doc.js`.
  `node test/check.js` fails when the two differ.

## The line

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `ts` | string | yes | When it happened, ISO 8601 UTC. |
| `event` | string | yes | The event name: one of the events below, or any other the agent sends. |
| `session_id` | string | yes | The session it belongs to (`unknown` when the agent sent none). |
| `agent` | string | yes | The agent that sent it: `claude`, `codex`, … |
| `data` | object | yes | The fields below, as the agent sent them, long strings and arrays cut short. |
| `parents` | array |  | The agent sessions this one was started from, nearest last: `[{ agent, session_id, tool_call_id? }]`. |
| `v` | number |  | The contract version the event was written with (none: version 1). |
| `native` | object |  | For agents whose own events are translated: the event as the agent sent it, `{ event, data }`. |
| `synthetic` | boolean |  | Made by the server (from a transcript or a rollout file), not sent by the agent. |

## Events

| Event | Category | Sent by | What happens |
| --- | --- | --- | --- |
| [`SessionStart`](#sessionstart) | lifecycle | `claude`, `codex`, `opencode` | A session starts or resumes. |
| [`Setup`](#setup) | lifecycle | `claude` | The agent sets itself up before a session. |
| [`UserPromptSubmit`](#userpromptsubmit) | prompt | `claude`, `codex`, `opencode` | You send a prompt. |
| [`UserPromptExpansion`](#userpromptexpansion) | prompt | `claude` | A slash command or reference expands your prompt. |
| [`PreToolUse`](#pretooluse) | from the tool | `claude`, `codex`, `opencode` | A tool call starts. |
| [`PostToolUse`](#posttooluse) | from the tool | `claude`, `codex`, `opencode` | A tool call finishes. |
| [`PostToolUseFailure`](#posttoolusefailure) | error | `claude`, `opencode` | A tool call fails. |
| [`PostToolBatch`](#posttoolbatch) | from the tool | `claude` | A batch of parallel tool calls finishes (repeats the tool rows; hidden in Details). |
| [`PermissionRequest`](#permissionrequest) | permission | `claude`, `codex`, `opencode` | The agent asks you to allow a tool call. |
| [`PermissionDenied`](#permissiondenied) | permission | `claude` | A tool call is denied. |
| [`Notification`](#notification) | notification | `claude` | The agent notifies you (waiting for input, finished, …). |
| [`MessageDisplay`](#messagedisplay) | notification | `claude` | The agent's reply as it is shown (repeats ModelText; hidden in Details). |
| [`Elicitation`](#elicitation) | question | `claude` | An MCP server asks you for input. |
| [`ElicitationResult`](#elicitationresult) | question | `claude` | You answer an MCP server. |
| [`SubagentStart`](#subagentstart) | subagent | `claude`, `codex` | A subagent starts, inside this session. |
| [`SubagentStop`](#subagentstop) | subagent | `claude`, `codex` | A subagent finishes. |
| [`TeammateIdle`](#teammateidle) | subagent | `claude` | A teammate waits for work. |
| [`TaskCreated`](#taskcreated) | task | `claude` | A background task starts. |
| [`TaskCompleted`](#taskcompleted) | task | `claude` | A background task finishes. |
| [`PreCompact`](#precompact) | compact | `claude`, `codex`, `opencode` | The context is about to be compacted. |
| [`PostCompact`](#postcompact) | compact | `claude`, `codex`, `opencode` | The context was compacted. |
| [`InstructionsLoaded`](#instructionsloaded) | context | `claude`, `opencode` | An instruction file (CLAUDE.md, AGENTS.md, rules, memory) is loaded, or the system prompt changes. |
| [`Stop`](#stop) | lifecycle | `claude`, `codex`, `opencode` | The agent finishes its turn. |
| [`StopFailure`](#stopfailure) | error | `claude`, `opencode` | The turn ends with an error. |
| [`Interrupt`](#interrupt) | lifecycle | `claude`, `codex`, the server | You stop the agent mid-turn. |
| [`SessionEnd`](#sessionend) | lifecycle | `claude`, `codex`, `opencode` | The session ends. |
| [`PreModelRequest`](#premodelrequest) | env | `codex` | Codex sends a request to the model. |
| [`PostModelRequest`](#postmodelrequest) | env | `codex` | Codex gets the model's answer. The server turns it into a ModelStep. |
| [`AgentEvent`](#agentevent) | env | agents with a translation | An agent's own event with no match here, kept as it came (in `native`). |
| [`ModelStep`](#modelstep) | model | the server, `opencode` | One model response: from Claude Code's transcript, a Codex PostModelRequest, or OpenCode's plugin. |
| [`ModelText`](#modeltext) | model | the server, `opencode` | A block of text or thinking the model wrote. |

### SessionStart

A session starts or resumes.

Category: lifecycle. Sent by `claude`, `codex`, `opencode`.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `source` | string |  | Why: `startup`, `resume`, `clear`, `compact`. |
| `model` | any |  | The model: a name, or `{ id, display_name }`. |
| `cwd` | string |  | The working directory. |
| `transcript_path` | string |  | The agent's own session file (Claude Code's transcript, Codex's rollout). |

### Setup

The agent sets itself up before a session.

Category: lifecycle. Sent by `claude`.

### UserPromptSubmit

You send a prompt.

Category: prompt. Sent by `claude`, `codex`, `opencode`.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `prompt` | string | yes | What you wrote. |
| `permission_mode` | string |  | The permission mode the agent runs in. |

### UserPromptExpansion

A slash command or reference expands your prompt.

Category: prompt. Sent by `claude`.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `expanded_prompt` | string |  | The prompt after expansion. |

### PreToolUse

A tool call starts.

Category: from the tool it calls. Sent by `claude`, `codex`, `opencode`.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `tool_name` | string | yes | The tool's name as the agent calls it (`Read`, `Bash`, `apply_patch`, `mcp__server__tool`). |
| `tool_input` | any |  | The call's arguments. |
| `tool_use_id` | string |  | The call id; pairs the call with its result. |
| `agent_id` | string |  | Set when a subagent sent it: the subagent. |

### PostToolUse

A tool call finishes.

Category: from the tool it calls. Sent by `claude`, `codex`, `opencode`.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `tool_name` | string | yes | The tool's name. |
| `tool_input` | any |  | The call's arguments. |
| `tool_response` | any |  | What the tool returned. |
| `tool_use_id` | string |  | The call id. |
| `duration_ms` | number |  | How long it took, when the agent says. |

### PostToolUseFailure

A tool call fails.

Category: error. Sent by `claude`, `opencode`.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `tool_name` | string | yes | The tool's name. |
| `tool_input` | any |  | The call's arguments. |
| `tool_use_id` | string |  | The call id. |
| `error` | any |  | Why it failed. |
| `is_interrupt` | boolean |  | You stopped it. |

### PostToolBatch

A batch of parallel tool calls finishes (repeats the tool rows; hidden in Details).

Category: from the tool it calls. Sent by `claude`.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `tool_calls` | array |  | The calls of the batch. |

### PermissionRequest

The agent asks you to allow a tool call.

Category: permission. Sent by `claude`, `codex`, `opencode`.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `tool_name` | string |  | The tool. |
| `tool_input` | any |  | The call's arguments. |
| `permission_suggestions` | array |  | The rules it offers. |

### PermissionDenied

A tool call is denied.

Category: permission. Sent by `claude`.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `tool_name` | string |  | The tool. |

### Notification

The agent notifies you (waiting for input, finished, …).

Category: notification. Sent by `claude`.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `message` | string |  | The text. |
| `notification_type` | string |  | What kind. |

### MessageDisplay

The agent's reply as it is shown (repeats ModelText; hidden in Details).

Category: notification. Sent by `claude`.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `delta` | string |  | Text shown. |

### Elicitation

An MCP server asks you for input.

Category: question. Sent by `claude`.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `server_name` | string |  | The MCP server. |

### ElicitationResult

You answer an MCP server.

Category: question. Sent by `claude`.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `action` | string |  | What you did. |

### SubagentStart

A subagent starts, inside this session.

Category: subagent. Sent by `claude`, `codex`.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `agent_id` | string | yes | The subagent. |
| `agent_type` | string |  | The subagent's type. |

### SubagentStop

A subagent finishes.

Category: subagent. Sent by `claude`, `codex`.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `agent_id` | string | yes | The subagent. |
| `agent_type` | string |  | The subagent's type. |
| `agent_transcript_path` | string |  | The subagent's transcript. |
| `last_assistant_message` | string |  | Its last reply. |

### TeammateIdle

A teammate waits for work.

Category: subagent. Sent by `claude`.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `teammate_name` | string |  | The teammate. |
| `team_name` | string |  | The team. |

### TaskCreated

A background task starts.

Category: task. Sent by `claude`.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `subject` | string |  | What it does. |

### TaskCompleted

A background task finishes.

Category: task. Sent by `claude`.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `subject` | string |  | What it did. |

### PreCompact

The context is about to be compacted.

Category: compact. Sent by `claude`, `codex`, `opencode`.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `trigger` | string |  | `manual` or `auto`. |

### PostCompact

The context was compacted.

Category: compact. Sent by `claude`, `codex`, `opencode`.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `trigger` | string |  | `manual` or `auto`. |

### InstructionsLoaded

An instruction file (CLAUDE.md, AGENTS.md, rules, memory) is loaded, or the system prompt changes.

Category: context. Sent by `claude`, `opencode`.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `file_path` | string |  | The file. |

### Stop

The agent finishes its turn.

Category: lifecycle. Sent by `claude`, `codex`, `opencode`.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `last_assistant_message` | string |  | Its last reply. |
| `stop_hook_active` | boolean |  | A Stop hook made it continue. |

### StopFailure

The turn ends with an error.

Category: error. Sent by `claude`, `opencode`.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `error` | any |  | Why. |

### Interrupt

You stop the agent mid-turn.

Category: lifecycle. Sent by `claude`, `codex`, the server.

### SessionEnd

The session ends.

Category: lifecycle. Sent by `claude`, `codex`, `opencode`.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `reason` | string |  | Why: `exit`, `clear`, `logout`, … |

### PreModelRequest

Codex sends a request to the model.

Category: env. Sent by `codex`.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `request_id` | string |  | The request. |
| `turn_id` | string |  | The turn. |

### PostModelRequest

Codex gets the model's answer. The server turns it into a ModelStep.

Category: env. Sent by `codex`.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `status` | string |  | How it ended. |
| `token_usage` | object |  | Token counts, OpenAI names. |
| `response_id` | string |  | The response. |
| `error` | any |  | Why it failed. |

### AgentEvent

An agent's own event with no match here, kept as it came (in `native`).

Category: env. Sent by agents with a translation.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `native_event` | string | yes | The agent's name for it. |

### ModelStep

One model response: from Claude Code's transcript, a Codex PostModelRequest, or OpenCode's plugin.

Category: model. Sent by the server, `opencode`.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `tokens` | object | yes | `{ input, output, cache_read, cache_write, context }`. |
| `model` | string |  | The model. |
| `stop_reason` | string |  | Why the response ended. |
| `tools` | array |  | The tools it called. |
| `tool_ids` | array |  | Their call ids, in the same order. |
| `msg_id` | string |  | The response id. |
| `subagent` | boolean |  | A subagent made it. |
| `agent_id` | string |  | Set when a subagent sent it: the subagent. |

### ModelText

A block of text or thinking the model wrote.

Category: model. Sent by the server, `opencode`.

| Field | Type | Always | What it holds |
| --- | --- | --- | --- |
| `kind` | string | yes | `text` or `thinking`. |
| `text` | string | yes | The text, cut short. |
| `msg_id` | string |  | The response it is part of. |
| `subagent` | boolean |  | A subagent wrote it. |
| `agent_id` | string |  | Set when a subagent sent it: the subagent. |
