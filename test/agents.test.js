// The conformance test every agent passes: its recorded sessions (server/lib/features/agents/<agent>/fixtures/) follow
// the event contract, and, fed to a real server, come out as the sessions fixtures.json expects: the agent, turns, tool
// calls, subagents, model steps and tokens, with every tool result paired with its call. A new agent is done when its
// folder passes this unchanged.
// Zero dependencies — run with `node --test test/agents.test.js`.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { freePort, waitFor, stopProcess } = require('./helpers');
const { AGENT_IDS } = require('../server/lib/features/agents/registry');
const { eventProblems } = require('../server/lib/building-blocks/event-contract');
const { appendSessionEvent } = require('../server/lib/building-blocks/session-logs');

const ROOT = path.join(__dirname, '..');
const AGENTS_DIR = path.join(ROOT, 'server', 'lib', 'features', 'agents');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'so-agents-'));
let port, server;

const readLines = file => fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
const getJson = async apiPath => (await fetch(`http://127.0.0.1:${port}${apiPath}`)).json();

// every agent's fixtures: [{ agent, file, expect, events }]
const FIXTURES = AGENT_IDS.flatMap(agent => {
  const dir = path.join(AGENTS_DIR, agent, 'fixtures');
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'fixtures.json'), 'utf8'));
  return meta.fixtures.map(fixture => ({ agent, file: fixture.file, expect: fixture.expect, lines: readLines(path.join(dir, fixture.file)) }));
});
const sessionIdOf = fixture => JSON.parse(fixture.lines[0]).session_id;

before(async () => {
  // the fixtures as the hook would have written them, each line into its session's log
  for (const fixture of FIXTURES) {
    for (const line of fixture.lines) {
      const event = JSON.parse(line);
      appendSessionEvent(path.join(DATA_DIR, 'sessions'), event.session_id, event.ts, line + '\n');
    }
  }
  port = await freePort();
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    env: { ...process.env, OBSERVER_DATA_DIR: DATA_DIR, OBSERVER_PORT: String(port), OBSERVER_AUTOSTART: '0', OBSERVER_LOAD_DAYS: '0' },
    stdio: 'ignore',
  });
  await waitFor(async () => (await getJson('/api/health')).ok, 8000, server);
});

after(async () => {
  await stopProcess(server);
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('every registered agent has at least one recorded session with expectations', () => {
  for (const agent of AGENT_IDS) {
    const own = FIXTURES.filter(fixture => fixture.agent === agent);
    assert.ok(own.length, `${agent}: no fixtures`);
    for (const fixture of own) assert.ok(fixture.expect, `${agent}/${fixture.file}: no "expect" in fixtures.json`);
  }
});

for (const fixture of FIXTURES) {
  const name = `${fixture.agent}/${fixture.file}`;

  test(`${name}: every event follows the contract`, () => {
    for (const line of fixture.lines) {
      const event = JSON.parse(line);
      assert.deepEqual(eventProblems(event), [], `${event.event}`);
      assert.equal(event.agent, fixture.agent);
    }
  });

  test(`${name}: the server makes the session fixtures.json expects`, async () => {
    const id = sessionIdOf(fixture);
    const session = (await getJson('/api/sessions')).find(candidate => candidate.id === id);
    assert.ok(session, 'the session is served');
    assert.equal(session.agent, fixture.agent);
    const { usage, ...counts } = fixture.expect;
    for (const [key, value] of Object.entries(counts)) assert.deepEqual(session[key], value, key);
    for (const [key, value] of Object.entries(usage || {})) assert.equal(session.usage[key], value, `usage.${key}`);
  });

  test(`${name}: every tool result is paired with its call`, async () => {
    const events = await getJson(`/api/events?session=${encodeURIComponent(sessionIdOf(fixture))}`);
    const callIds = new Set(events.filter(event => event.event === 'PreToolUse').map(event => event.data.tool_use_id));
    const results = events.filter(event => event.event === 'PostToolUse' || event.event === 'PostToolUseFailure');
    assert.ok(results.length, 'the session has tool results');
    for (const result of results) assert.ok(callIds.has(result.data.tool_use_id), `${result.data.tool_name} ${result.data.tool_use_id}`);
    assert.ok(events.every(event => event.agent === fixture.agent), 'every served event names the agent');
  });
}
