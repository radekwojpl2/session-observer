# OpenCode: what is kept

How OpenCode's plugin hooks and bus events become contract events (`translate.js`). Every recorded event keeps
OpenCode's own as `native` (`{ event, data }`), so nothing that is mapped loses detail.

Checked against OpenCode 1.17.8 (`opencode run`, Windows). The types come from `@opencode-ai/plugin` and
`@opencode-ai/sdk` 1.19.6.

## Mapped

| Contract event | From OpenCode |
| --- | --- |
| `SessionStart` | event `session.created`; `info.parentID` becomes `parents`, with the parent's last `task` call id |
| `UserPromptSubmit` | hook `chat.message` (the text parts) |
| `InstructionsLoaded` | hook `experimental.chat.system.transform`, recorded at the next `chat.params` when the prompt or the tools changed. It holds the whole system prompt (in 7000-character parts, so the log keeps it whole), the tools as sent to the model (hook `tool.definition`), the skills it lists (`<available_skills>`), and the subagent types the `task` tool lists. Each instruction file in the prompt (`Instructions from: <path>` blocks: AGENTS.md, CLAUDE.md, config instructions) is recorded on its own, with its content |
| `PreToolUse` | hook `tool.execute.before` |
| `PostToolUse` | hook `tool.execute.after`; a `task` call's `metadata.sessionId` is kept as `child_session_id` |
| `PostToolUseFailure` | event `message.part.updated`, a tool part in state `error`, when no result came |
| `PermissionRequest` | hook `permission.ask` |
| `ModelStep` | event `message.part.updated`, a `step-finish` part. Tokens come from the part, the window from `chat.params`, the tool calls from the step's tool parts. It is placed at its `step-start`, before its calls |
| `ModelText` | hook `experimental.text.complete` (replies); a `reasoning` part once it ends (thinking) |
| `PreCompact` / `PostCompact` | hook `experimental.session.compacting` / event `session.compacted` |
| `Stop` | event `session.idle` |
| `StopFailure` | event `session.error` |
| `SessionEnd` | event `session.deleted`; every session when OpenCode closes (hook `dispose`) |

The `shell.env` hook also sets `OBSERVER_PARENT_AGENT` / `OBSERVER_PARENT_SESSION`, so a session started from an
OpenCode shell call (`claude -p`, `codex exec`) is linked to it.

## Passed through as `AgentEvent`

Any bus event with a session that isn't mapped or dropped, for example `todo.updated`, `file.edited` or
`command.executed`.

## Dropped, and why

| What | Why |
| --- | --- |
| `chat.params` of the `title` agent | OpenCode's own call to name the session, not part of the work |
| `message.part.delta` | Streaming text: the finished text comes in `experimental.text.complete` |
| `message.updated`, `message.removed`, `message.part.removed`, `session.updated`, `session.status`, `session.diff` | Repeat what the parts, steps and hooks already say |
| `session.next.agent.switched`, `session.next.model.switched` | The model shows on each step |
| `permission.updated`, `permission.asked` | The `permission.ask` hook records the ask |
| `plugin.added`, `catalog.updated`, `integration.updated`, `reference.updated`, `server.*`, `installation.*`, `lsp.*`, `file.watcher.*`, `vcs.*`, `tui.*`, `pty.*` | Start-up and editor noise, with no session |

## The Context view

Read from OpenCode's own database (`opencode.db`, SQLite), read-only, with Node's built-in `node:sqlite` (Node 22.5
or later). The plugin records where the database is (`opencode_db` on SessionStart, from OpenCode's own
`XDG_DATA_HOME`); `OBSERVER_OPENCODE_DB` overrides it. Messages and parts become the view's items: prompts, replies,
reasoning, tool calls with their full input and output, steps with their tokens, compactions and summaries. Child
sessions become its subagents, linked to their task call.

## Not yet

- **Tool parameters.** OpenCode 1.17.8 hands plugins its own schema objects, not JSON Schema, so tools show with their
  description only.
- **Subagent types.** OpenCode 1.17.8's `task` tool doesn't list them, so the list stays empty (the parser reads
  `- <name>: <description>` lines if a version adds them).
- **MCP servers, the request's measured size.** Not available to the plugin or in the database.
- **Checked, not yet seen live:** `permission.ask`, compaction, and the interactive TUI. Only `opencode run` was recorded.
