// The event recorder: the one way events get into the log. Its events follow the contract, keep the agent's own
// event beside the translation, link parent sessions, and an error never reaches the agent.
// Zero dependencies — run with `node --test test/event-recorder.test.js`.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRecorder, parentsFromEnvironment, truncate } = require('../server/lib/building-blocks/event-recorder');
const { CONTRACT_VERSION, eventProblems } = require('../server/lib/building-blocks/event-contract');

// a recorder that keeps what it writes in memory
function memoryRecorder(options = {}) {
  const lines = [];
  const recorder = createRecorder({ agent: 'opencode', logDir: '/nowhere', env: {}, append: (dir, id, ts, line) => lines.push(JSON.parse(line)), ...options });
  return { recorder, lines };
}

test('record writes one contract event with the version stamped', () => {
  const { recorder, lines } = memoryRecorder();
  const event = recorder.record('PreToolUse', { tool_name: 'bash', tool_input: { command: 'ls' } }, { sessionId: 's1' });
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0], event);
  assert.equal(event.v, CONTRACT_VERSION);
  assert.equal(event.agent, 'opencode');
  assert.equal(event.session_id, 's1');
  assert.deepEqual(eventProblems(event), []);
  assert.equal('native' in event, false, 'no native event unless one is given');
});

test('the session id comes from the payload when none is passed', () => {
  const { recorder } = memoryRecorder();
  assert.equal(recorder.record('Stop', { session_id: 'from-payload' }).session_id, 'from-payload');
  assert.equal(recorder.record('Stop', {}).session_id, 'unknown');
});

test('the named calls write the contract events', () => {
  const { recorder, lines } = memoryRecorder();
  recorder.sessionStart('s1', { source: 'startup', cwd: '/work' });
  recorder.prompt('s1', 'fix it');
  recorder.toolCall('s1', { tool_name: 'read', tool_input: { filePath: 'a' }, tool_use_id: 'c1' });
  recorder.toolResult('s1', { tool_name: 'read', tool_use_id: 'c1', tool_response: 'text' });
  recorder.toolFailed('s1', { tool_name: 'read', tool_use_id: 'c2', error: 'no such file' });
  recorder.modelStep('s1', { tokens: { input: 1, output: 2, cache_read: 0, cache_write: 0, context: 3 }, model: 'm' });
  recorder.modelText('s1', { kind: 'text', text: 'done' });
  recorder.instructions('s1', { file_path: 'AGENTS.md' });
  recorder.compact('s1', 'pre', { trigger: 'auto' });
  recorder.compact('s1', 'post', { trigger: 'auto' });
  recorder.stop('s1', { last_assistant_message: 'done' });
  recorder.sessionEnd('s1', { reason: 'exit' });
  assert.deepEqual(lines.map(line => line.event), ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
    'PostToolUseFailure', 'ModelStep', 'ModelText', 'InstructionsLoaded', 'PreCompact', 'PostCompact', 'Stop', 'SessionEnd']);
  for (const line of lines) {
    assert.deepEqual(eventProblems(line), [], line.event);
    assert.equal(line.data.hook_event_name, line.event);
    assert.equal(line.data.session_id, 's1');
  }
  assert.equal(lines[1].data.prompt, 'fix it');
});

test('the agent\'s own event is kept beside the translation, cut short like the rest', () => {
  const { recorder } = memoryRecorder();
  const event = recorder.toolResult('s1', { tool_name: 'bash', tool_response: 'ok' },
    { native: { event: 'tool.execute.after', data: { output: 'x'.repeat(20000) } } });
  assert.equal(event.native.event, 'tool.execute.after');
  assert.ok(event.native.data.output.length < 9000);
});

test('an event with no match is passed through as AgentEvent', () => {
  const { recorder } = memoryRecorder();
  const event = recorder.passThrough('s1', 'session.compacted', { sessionID: 's1' });
  assert.equal(event.event, 'AgentEvent');
  assert.equal(event.data.native_event, 'session.compacted');
  assert.deepEqual(event.native, { event: 'session.compacted', data: { sessionID: 's1' } });
  assert.deepEqual(eventProblems(event), []);
});

test('parents come from the environment and from the caller, without repeats or itself', () => {
  const env = { CLAUDE_CODE_SESSION_ID: 'claude-1', OBSERVER_PARENT_AGENT: 'pi', OBSERVER_PARENT_SESSION: 'pi-1' };
  const sources = [{ agent: 'claude', session: ['CLAUDE_CODE_SESSION_ID'] }]; // as a manifest's parentEnv names them
  assert.deepEqual(parentsFromEnvironment('child', env, null, sources), [{ agent: 'claude', session_id: 'claude-1' }, { agent: 'pi', session_id: 'pi-1' }]);
  assert.deepEqual(parentsFromEnvironment('pi-1', env, null, sources), [{ agent: 'claude', session_id: 'claude-1' }]);
  assert.deepEqual(parentsFromEnvironment('child', env, new Set(['claude']), sources), [{ agent: 'claude', session_id: 'claude-1' }]);
  assert.deepEqual(parentsFromEnvironment('child', env), [{ agent: 'pi', session_id: 'pi-1' }], 'no sources: only an in-process plugin\'s');
  const { recorder } = memoryRecorder({ env: { CLAUDE_CODE_SESSION_ID: 'claude-1' }, parentSources: sources });
  const event = recorder.record('SessionStart', {}, { sessionId: 'child', parents: [{ agent: 'opencode', session_id: 'oc-parent' }, { agent: 'claude', session_id: 'claude-1' }, { agent: 'opencode', session_id: 'child' }] });
  assert.deepEqual(event.parents, [{ agent: 'claude', session_id: 'claude-1' }, { agent: 'opencode', session_id: 'oc-parent' }]);
});

test('a failing write never throws', () => {
  const { recorder } = memoryRecorder({ append: () => { throw new Error('disk full'); } });
  assert.equal(recorder.record('Stop', {}, { sessionId: 's1' }), null);
  assert.equal(recorder.stop('s1'), null);
});

test('truncate cuts long strings and arrays, and keeps the rest', () => {
  assert.equal(truncate('abcdef', 0, 3), 'abc… [+3 chars]');
  assert.equal(truncate(Array.from({ length: 205 }, (_, i) => i)).at(-1), '… [+5 items]');
  assert.deepEqual(truncate({ a: 1, b: [true, null] }), { a: 1, b: [true, null] });
});
