# pi and omp support: how it works

Session Observer shows [pi](https://github.com/earendil-works/pi) and [omp (oh-my-pi)](https://github.com/can1357/oh-my-pi)
sessions next to Claude Code and Codex. Neither runs hook commands, so the integration is an extension that runs
inside the agent's own process.

## Pieces

| File | What it does |
|---|---|
| `pi-extension/session-observer.js` | The extension (CommonJS). `forAgent('pi' \| 'omp')` returns the factory pi and omp call with their extension API. It subscribes to their events and writes hook-shaped events with `recordEvent` from `scripts/hook.js`, in process. Every handler swallows errors and returns nothing: it never blocks a tool or changes a result. |
| `scripts/setup-pi.js` | Installs or removes a one-line ES module loader, `extensions/session-observer.js`, in `~/.pi/agent` and/or `~/.omp/agent`. omp (Bun) takes only an ES module's default export, which is why the loader is ESM and the extension is required through `createRequire`. `--data-dir <folder>` writes the log folder into the loader (it sets `OBSERVER_DATA_DIR` unless that is set already). |
| `scripts/hook.js` | `recordEvent(payload, eventName, agent, extraParents)` and `ensureServer(node)` are exported for the extension. `AGENTS` includes `pi` and `omp`. `OBSERVER_PARENT_AGENT` / `OBSERVER_PARENT_SESSION` name a pi / omp session as the parent of what it runs. |
| `server/lib/features/sessions/reported-model-steps.js` | Adds tokens and context use for ModelStep events an agent reports itself (Codex's, and pi's / omp's). |
| `server/lib/features/context/pi/pi-context.js` | The Context view for pi / omp: reads the agent's own session file (`session_file` from SessionStart). |
| `test/pi.test.js` | Fake pi / omp harnesses drive the extension; the server is checked through its HTTP API. |

## Event mapping

| pi / omp event | Logged as |
|---|---|
| `session_start` | `SessionStart` (`source`, `model`, `session_file`, `agent_type` for an omp subagent); starts the dashboard server if none runs |
| `before_agent_start` | `InstructionsLoaded` when the system prompt changed (the prompt in 7000-char `system_prompt_parts`, `files` = instruction files found in it), then `UserPromptSubmit` |
| `tool_execution_start` / `tool_execution_end` | `PreToolUse` / `PostToolUse` or `PostToolUseFailure` (blocked and refused calls end here too, with the blocker's reason) |
| `message_end` (assistant) | `ModelStep` (tokens, tool calls, `model_context_window`) and one `ModelText` per text / thinking block |
| pi `agent_settled`; omp `session_stop` (main) and `agent_end` without `willContinue` (subagent) | `Stop` |
| `session_before_compact` / `session_compact` | `PreCompact` / `PostCompact` |
| `model_select` | `ModelChange` |
| `session_shutdown` | `SessionEnd` |

omp subagents (its `task` tool) run in the same process, each in a session of its own. The extension tells them
apart by the session header's `parentSession` (or omp's `/omp-task-*/` folder) and names the parent in `parents`,
so the dashboard nests them under the session that ran them.

## The Context view

`pi-context.js` reads the session file's entry tree along the active branch (from the last entry back to the root,
so branches abandoned with `/tree` stay out):

- `message`: user, assistant (text, thinking, toolCall, usage → a step), toolResult; pi's `system` messages set and
  patch the system prompt's sections and tools (a later one shows as a "system prompt change" card)
- `compaction`, `branch_summary`, `custom_message`, and omp `custom` entries with a `reminder`
- omp `session_init`: a subagent's system prompt and tools
- omp subagents: `<parent file without .jsonl>/<task name>.jsonl`, linked to the `task` call whose `tasks[].name`
  matches

omp keeps only a digest of the main session's system prompt in its file, so the prompt comes from the latest
`InstructionsLoaded` event instead. Instruction files are parsed out of the prompt: pi wraps each one in
`<project_instructions path="…">`, omp in `<file path="…">`.

## Checking a change

```sh
node test/check.js
node --test test/*.test.js
OBSERVER_PORT=4778 node server/server.js   # a server for a branch, beside the installed one
```

To try a real pi or omp without touching your own setup, point it at a scratch config folder
(`PI_CODING_AGENT_DIR` for both) and install the loader there:

```sh
PI_CODING_AGENT_DIR=/tmp/pi-agent node scripts/setup-pi.js pi
PI_CODING_AGENT_DIR=/tmp/pi-agent OBSERVER_DATA_DIR=/tmp/so-data pi -p "say hi using bash"
```

A model is needed for a turn. A small fake OpenAI-compatible server (streaming `chat/completions`) configured as a
provider in the agent's `models.json` (pi) or `models.yml` (omp) works without an API key.
