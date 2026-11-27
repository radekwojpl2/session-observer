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
| `InstructionsLoaded` | hook `experimental.chat.system.transform`, recorded at the next `chat.params` when the prompt changed |
| `PreToolUse` | hook `tool.execute.before` |
| `PostToolUse` | hook `tool.execute.after`; a `task` call's `metadata.sessionId` is kept as `child_session_id` |
| `PostToolUseFailure` | event `message.part.updated`, a tool part in state `error`, when no result came |
| `PermissionRequest` | hook `permission.ask` |
| `ModelStep` | event `message.part.updated`, a `step-finish` part. Tokens come from the part, the window from `chat.params`, the tool calls from the step's tool parts. It is placed at its `step-start`, before its calls |
| `ModelText` | hook `experimental.text.complete` |
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

## Not yet

- **The Context view.** OpenCode keeps sessions in a SQLite database (`opencode.db`); reading it needs `node:sqlite`,
  so for now the view says it is not available.
- **Reasoning text.** `reasoning` parts aren't recorded as `ModelText` yet.
- **Checked, not yet seen live:** `permission.ask`, compaction, and the interactive TUI. Only `opencode run` was recorded.
