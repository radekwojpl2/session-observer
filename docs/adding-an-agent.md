# Adding an agent

An agent is one folder, `server/lib/features/agents/<id>/`, plus its id in `AGENT_IDS`
(`server/lib/features/agents/registry.js`). The dashboard needs no change: names, colours, tool groups and the agent
filter come from the folder through `/api/agents`. OpenCode (`agents/opencode/`) is the worked example.

## 1. Start the folder

~~~sh
node scripts/new-agent.js myagent "My Agent"
~~~

This creates the folder from a template and registers the id:

| File | What it holds |
| --- | --- |
| `manifest.js` | Name, colours, the command word that starts it, how its events are captured, how its context window is known |
| `tools.js` | Its tool names by group (files, shell) and role (command, subagent call, question, task, patch), and the input field that names a file |
| `translate.js` | Its own events → contract events (`docs/events.md`), with no I/O so tests can feed it |
| `server.js` | Server hooks, all optional: steps it reports, a session file to read, its Context view |
| `FIDELITY.md` | What is mapped, passed through, or dropped, and why |
| `fixtures/fixtures.json` | Its recorded sessions and what the server must make of them |

`node test/agents.test.js` now fails for the new agent: it has no recorded session yet. That is the to-do list.

## 2. Capture its events

- **It has hook commands** (like Claude Code and Codex): point them at `scripts/hook.js <Event> --agent <id>`. If its
  payloads already follow the contract, `translate.js` can stay empty.
- **It has plugins or extensions** (like OpenCode): put the plugin in `capture/`. It requires `scripts/hook.js` and
  calls `recordEvent(payload, eventName, '<id>', parents, native, ts)` for each translated event. Like a hook, it must
  never break the agent: swallow every error.

Keep each event's own form as `native`. Map what has a real equivalent, pass the rest through as `AgentEvent`
(`recorder.passThrough`), and drop only noise. List what you drop in `FIDELITY.md`.

## 3. Record real sessions

Run the agent for real on a throwaway project, with its events going to a scratch folder:

~~~sh
OBSERVER_DATA_DIR=/tmp/so-record OBSERVER_AUTOSTART=0 myagent run "read notes.txt, then run echo ok"
node scripts/scrub-fixture.js /tmp/so-record/sessions/<day>/<hash>.jsonl \
  server/lib/features/agents/myagent/fixtures/session.jsonl --project /path/to/the/throwaway/project
~~~

The scrubber replaces the project and home folders, and refuses to write if your user name, an email address or a
key-like string is still there. Add `--keep-parents` for a subagent session whose parent you recorded too.

Then add the fixture to `fixtures.json`: the agent version, what the session did, and `expect`, the session the server
must make of it (`turns`, `toolCalls`, `tools`, `modelSteps`, `usage`, `parent`, …).

## 4. Pass the checks

~~~sh
node test/check.js                  # the folder is complete and registered
node --test test/agents.test.js     # its sessions follow the contract and come out as expected
node --test test/*.test.js
~~~

Add a `test/<id>.test.js` for its translation, fed with what the agent really sends, and a README section on how to
install it.

## When the agent changes

Re-record its fixtures with the new version and run the conformance test: it shows what moved. Fix `translate.js` and
`FIDELITY.md`. Change the contract (`server/lib/building-blocks/event-contract.js`, then `node scripts/events-doc.js`)
only when the dashboard needs something new.
