# pi and omp support: how it works

Session Observer shows [pi](https://github.com/earendil-works/pi) and [omp (oh-my-pi)](https://github.com/can1357/oh-my-pi)
sessions next to Claude Code and Codex. Neither runs hook commands, so the integration is an extension that runs
inside the agent's own process.

## Install

You need Node.js (18 or newer) on the machine that runs pi or omp. omp runs on Bun, but the dashboard server runs on
Node, so `node` must be on your PATH there too.

### On your own machine

1. Get the code (until `feat/pi-omp` is merged, use that branch):
   ```sh
   git clone -b feat/pi-omp https://github.com/radekwojpl2/session-observer
   cd session-observer
   ```
2. Install the extension:
   ```sh
   node scripts/setup-pi.js          # for each of pi (~/.pi) and omp (~/.omp) set up here
   node scripts/setup-pi.js omp      # or name one: pi, omp, or both
   ```
   This writes `extensions/session-observer.js` into `~/.pi/agent` and/or `~/.omp/agent`: one line that loads
   `pi-extension/session-observer.js` from this clone. Keep the clone where it is; after moving it, run the script
   again.
3. Restart pi or omp (or run `/reload` in it). The first session starts the dashboard: open http://127.0.0.1:4777.
   Sessions show with a **pi** or **omp** badge, next to Claude Code's and Codex's.

Where it installs:

| Agent | Folder | Change it with |
|---|---|---|
| pi | `~/.pi/agent/extensions/` | `PI_CODING_AGENT_DIR` |
| omp | `~/.omp/agent/extensions/` | `OMP_PROFILE` (a profile's folder), or `OMP_AGENT_DIR` |

### When the agent runs in a sandbox or on a remote machine

By default events go to `~/.claude/session-observer`. If the agent can't write there (a sandbox that hides
`~/.claude`), or it starts without your shell's variables (scheduled runs), give the log a folder it can write to:

```sh
node scripts/setup-pi.js omp --data-dir ~/.omp/session-observer
```

The folder goes into the installed loader, so every way the agent starts logs there (`OBSERVER_DATA_DIR`, when set,
still wins). Then run the dashboard server outside the sandbox, on the same folder, and keep it running: a server
the extension starts inside a sandbox stops when the agent does.

```sh
OBSERVER_DATA_DIR=~/.omp/session-observer nohup node server/server.js >/dev/null 2>&1 &
```

On a remote machine the server listens on its own loopback only. View it through an SSH tunnel that keeps the port
number the same (the server accepts requests only for its own port):

```sh
ssh -N -L 4777:127.0.0.1:4777 <remote>     # then open http://127.0.0.1:4777
```

If 4777 is taken on your side (your own Observer runs there), start a second server on the remote machine with
`OBSERVER_PORT=4787` and the same `OBSERVER_DATA_DIR`, and tunnel `4787:127.0.0.1:4787`.

A sandboxed agent can read the log folder and reach the dashboard on loopback: see Open item 1 in
[HANDOFF.md](HANDOFF.md).

### Update and remove

- Update: `git pull` in the clone, then restart pi / omp (the loader always loads the clone's current code) and the
  dashboard server.
- Remove: `node scripts/setup-pi.js --remove` (both) or `--remove omp`. It deletes only the file it wrote. The log
  folder stays; delete it yourself if you want the events gone. pi's and omp's own session files are never touched.

### Check that it works

- At start, pi / omp lists extension load errors; there should be none for `session-observer`.
- After a prompt, the log folder has a file for the session: `ls ~/.claude/session-observer/sessions/*/`
  (or your `--data-dir`).
- `curl -s http://127.0.0.1:4777/api/health` answers `{"ok":true,…}` with the session count.

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
