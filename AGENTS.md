# session-observer: notes for agents working on this repo

## What this is
A Claude Code and Codex plugin, with an extension for pi and omp. `scripts/hook.js` receives every hook event (Codex's hook
commands add `--agent codex`; Claude Code's add nothing; `pi-extension/` calls its `recordEvent` in the pi / omp process) and appends it to
`~/.claude/session-observer/sessions/<UTC day>/<session hash>.jsonl`; `server/server.js` (with its modules in `server/lib/`) tails that log, reads session transcripts,
and serves a live dashboard on http://127.0.0.1:4777.

## Rules
- Zero dependencies and no build step. Node built-ins only; the dashboard is plain browser scripts.
- `server/dashboard/**/*.js` share one global scope and load in the order `server/dashboard.html` lists
  them. Every script starts with `'use strict';`, and the page and the folder must list the same files.
- Layers, in `server/lib/` and `server/dashboard/`: `building-blocks/` never use a feature; `features/<feature>/` group
  code by function (`model`, `render`, `controls`); dashboard `app/` wires the features and starts the page. A feature
  file runs nothing at load: its listeners go in an `init…Controls()` that `app/main.js` calls.
- The hook must never block or fail Claude: it always exits 0 and swallows errors.
- Files use CRLF. For scripted edits use Node, not Python (not installed here).

## Check your work
- `node test/check.js` — JSON parses, JS compiles, hooks point at real scripts, dashboard files match.
- `node --test test/*.test.js` — smoke tests: hook → log → server → HTTP API.
- To try a branch without touching the installed plugin's server: `OBSERVER_PORT=4778 node server/server.js`.

## Git
- Conventional Commit PR titles (`feat:`, `fix:`, `docs:`, `refactor:`); release-please cuts releases.
- Update README screenshots in `docs/` when the dashboard changes visibly.
