// The event contract: real sessions recorded from each agent follow it, docs/events.md matches it, and it catches
// what is wrong with an event without rejecting events it doesn't know.
// Zero dependencies — run with `node --test test/event-contract.test.js`.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EVENTS, eventProblems } = require('../server/lib/building-blocks/event-contract');
const { isUpToDate } = require('../scripts/events-doc');
const { leaks } = require('../scripts/scrub-fixture');

const AGENTS_DIR = path.join(__dirname, '..', 'server', 'lib', 'features', 'agents');
// the categories the dashboard has a label and a colour for (server/dashboard/features/events/model/tool-groups.js)
const DASHBOARD_CATEGORIES = ['model', 'prompt', 'tool', 'skill', 'question', 'subagent', 'task', 'mcp', 'permission',
  'error', 'notification', 'compact', 'context', 'lifecycle', 'env'];

function fixtureSets() {
  return fs.readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(AGENTS_DIR, entry.name, 'fixtures', 'fixtures.json')))
    .map(entry => {
      const dir = path.join(AGENTS_DIR, entry.name, 'fixtures');
      return { agent: entry.name, dir, meta: JSON.parse(fs.readFileSync(path.join(dir, 'fixtures.json'), 'utf8')) };
    });
}
const readEvents = file => fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));

const good = (overrides = {}) => ({
  ts: '2026-11-27T10:00:00.000Z', event: 'PreToolUse', session_id: 's1', agent: 'claude',
  data: { tool_name: 'Read', tool_input: { file_path: 'a.txt' }, tool_use_id: 't1' }, ...overrides,
});

test('Claude Code and Codex each have a recorded session', () => {
  assert.deepEqual(fixtureSets().map(set => set.agent).sort(), ['claude', 'codex']);
});

for (const set of fixtureSets()) {
  test(`${set.agent}: every recorded event follows the contract`, () => {
    assert.ok(set.meta.agentVersion, 'fixtures.json names the agent version it was recorded with');
    for (const fixture of set.meta.fixtures) {
      const events = readEvents(path.join(set.dir, fixture.file));
      assert.ok(events.length > 0, `${fixture.file} has events`);
      for (const event of events) assert.deepEqual(eventProblems(event), [], `${fixture.file}: ${event.event}`);
      assert.ok(events.every(event => event.agent === set.agent), `${fixture.file}: every event is from ${set.agent}`);
    }
  });

  test(`${set.agent}: the recorded sessions hold no private data`, () => {
    for (const fixture of set.meta.fixtures) assert.deepEqual(leaks(fs.readFileSync(path.join(set.dir, fixture.file), 'utf8')), []);
  });
}

test('docs/events.md is generated from the contract', () => {
  assert.ok(isUpToDate(), 'run node scripts/events-doc.js');
});

test('every category in the contract is one the dashboard shows', () => {
  for (const [name, spec] of Object.entries(EVENTS)) {
    if (spec.category) assert.ok(DASHBOARD_CATEGORIES.includes(spec.category), `${name}: ${spec.category}`);
    assert.ok(spec.agents.length && spec.about, `${name} says who sends it and what it is`);
  }
});

test('a good event has no problems', () => {
  assert.deepEqual(eventProblems(good()), []);
});

test('a broken envelope is reported', () => {
  const { session_id, ...noSession } = good();
  assert.deepEqual(eventProblems(noSession), ['session_id is missing']);
  assert.deepEqual(eventProblems(good({ ts: 'yesterday' })), ['ts is not a date']);
  assert.deepEqual(eventProblems(good({ data: 'text' })), ['data should be a object']);
  assert.deepEqual(eventProblems(null), ['the event is not an object']);
});

test('a missing or mistyped field of a known event is reported', () => {
  assert.deepEqual(eventProblems(good({ data: { tool_input: {} } })), ['data.tool_name is missing']);
  assert.deepEqual(eventProblems(good({ data: { tool_name: 7 } })), ['data.tool_name should be a string']);
  assert.deepEqual(eventProblems(good({ event: 'ModelStep', data: {} })), ['data.tokens is missing']);
});

test('an event or field the contract does not know is fine', () => {
  assert.deepEqual(eventProblems(good({ event: 'SomethingNew', data: { anything: [1, 2] } })), []);
  assert.deepEqual(eventProblems(good({ data: { tool_name: 'Read', extra: true }, native: { event: 'x', data: {} }, v: 1 })), []);
});

test('the scrubber refuses private data', () => {
  assert.deepEqual(leaks('{"cwd":"/work/project"}'), []);
  assert.deepEqual(leaks('{"author":"someone@example.com"}'), ['an email address']);
});
