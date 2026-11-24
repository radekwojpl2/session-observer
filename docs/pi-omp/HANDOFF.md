# Handoff: pi and omp support (branch `feat/pi-omp`)

State on 2026-11-24. How the integration works: [README.md](README.md).

## Done

Three commits on `feat/pi-omp` (branched from `main` at 0.11.1), pushed, no PR yet:

1. `feat: show pi and omp sessions`: the extension, `setup-pi.js` (with `--data-dir`), server and dashboard support
   (agent badges and colours, the agent filter, pi's lower-case tool names, the agent filter's tooltip in all 10
   languages), README sections.
2. `feat: Context view for pi and omp sessions`: `pi-context.js` reads the agent's session file.
3. `feat: show the system prompt and AGENTS.md of pi and omp sessions`: the extension records the system prompt
   (`InstructionsLoaded`), and the Context view lists instruction files.

Checks: `node test/check.js` and `node --test test/*.test.js` pass (86 tests), on Windows and on Linux (Node 24).

Tested for real against pi 1.6.0 (`@earendil-works/pi-coding-agent`) and omp 19.1.1 (`@oh-my-pi/pi-coding-agent`):

- locally, against a fake model server: every event type, tokens, context window
- on a remote agent seat (Ubuntu, omp in a bubblewrap sandbox with seat-guard in enforce mode), with a real model:
  - an omp subagent nests under its parent, live and in the Context view
  - a call seat-guard blocks shows as a failure with the guard's reason
  - a result seat-guard rewrites is logged as the rewritten text the model saw
  - an `AGENTS.md` change between turns of one session gives a second `InstructionsLoaded`, and the Context view
    shows the new content

## Open

1. **Sandboxed agents can reach the Observer's data** (found on the seat). The log folder (`--data-dir`, inside the
   sandbox's writable `~/.omp`) can be read and written by the agent, and the dashboard API on loopback answers it
   (seat-guard's URL check allows loopback ports "your own server" listens on). Proposed fix:
   - the extension writes through a write-only socket bound into the sandbox (like `moshi-hook.sock`), so the log
     and server live outside it
   - the read API requires a token even on loopback
   - in agent-engine: hide the log folder in `seat-sandbox`, and refuse the Observer's ports in seat-guard's
     `check_url` (as it does for the seat dashboard's 8790)
2. **A plain SSH tunnel on another port gets "forbidden host"**: the request guard accepts only its own port in
   `Host`. Option: an `OBSERVER_ALLOWED_PORTS` setting. Workaround today: run a second server on the port you tunnel
   to (`OBSERVER_PORT=4787`, same `OBSERVER_DATA_DIR`).
3. **Open the PR** (`feat: show pi and omp sessions`). The memory rule for this repo: PR proofs from real sessions only.
4. **README screenshots** (`docs/`) don't show pi / omp yet.
5. Not covered: the `task` tool isn't counted as a subagent call on the dashboard (its subagent is a session of its
   own instead); `ui_prompt_start` (pi waiting on you) isn't mapped to "needs you"; macOS untested; other pi / omp
   versions untested (unknown entries are skipped, not fatal).

## The remote seat as left

- Reached as `ssh agent-seat` from WSL (the keys live in WSL's `~/.ssh`), user `worker`.
- `~/session-observer`: a clone of `feat/pi-omp` at `6f1d551`. Update with `git -C ~/session-observer pull`.
- Extension installed with `node ~/session-observer/scripts/setup-pi.js omp --data-dir ~/.omp/session-observer`.
  The seat's agent sync manages only `seat-guard.ts` in `~/.omp/agent/extensions`, so it leaves the loader alone.
- Two dashboard servers outside the sandbox, started with `setsid nohup` (they don't survive a reboot), both on the
  same log folder: 4777 (the one the extension finds) and 4787 (for the tunnel).
  Restart:
  ```sh
  pkill -f session-observer/server/server.js
  for p in 4777 4787; do OBSERVER_PORT=$p OBSERVER_DATA_DIR=$HOME/.omp/session-observer setsid nohup node ~/session-observer/server/server.js >/dev/null 2>&1 </dev/null & done
  ```
- View from the laptop: `ssh -N -L 4787:127.0.0.1:4787 agent-seat` in WSL, then http://127.0.0.1:4787.
- Test leftovers: the test project `~/projects/so-agents-md-test`, and a few test sessions in the log.
- Remove it all:
  ```sh
  node ~/session-observer/scripts/setup-pi.js --remove omp; pkill -f session-observer/server/server.js
  rm -rf ~/session-observer ~/.omp/session-observer ~/projects/so-agents-md-test
  ```

## Gotchas met on the way

- omp rejected a CommonJS loader ("does not export a valid factory function"); pi accepts either. Hence the ESM loader.
- `omp -p` reads stdin too: run it with `</dev/null` in scripts, or the rest of the script ends up in the prompt.
- Inside `seat-sandbox`, `/tmp` is an empty tmpfs and `~/projects` is hidden except the current project.
- From Windows, `$HOME` in a double-quoted `wsl … ssh '…'` command expands locally: send scripts over stdin
  (`ssh agent-seat bash -s < script.sh`).
