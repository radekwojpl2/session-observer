// Agent sessions started by other agent sessions: the hook reads the parents from the environment, the server resolves
// the direct parent and the tool call that started it, and the dashboard nests them on Home and finds them by call.
// Run with `node --test test/session-links.test.js`.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parentSessions } = require('../scripts/hook');
const { ingest, sessionSummary } = require('../server/lib/features/sessions/sessions');

let clock = Date.parse('2026-11-22T10:00:00Z');
const nextTs = () => new Date((clock += 1000)).toISOString();
const send = (sessionId, agent, eventName, data = {}, parents) =>
  ingest({ ts: nextTs(), event: eventName, session_id: sessionId, agent, data: { hook_event_name: eventName, ...data }, ...(parents ? { parents } : {}) });

test('the hook names the parents its environment shows, never its own session', () => {
  assert.deepEqual(parentSessions('own', {}), []);
  assert.deepEqual(parentSessions('own', { CLAUDE_CODE_SESSION_ID: 'own' }), []);
  assert.deepEqual(parentSessions('child', { CLAUDE_CODE_SESSION_ID: 'claude-1' }), [{ agent: 'claude', session_id: 'claude-1' }]);
  // (in the registry's order: which is the direct parent is the server's call, by start time)
  assert.deepEqual(parentSessions('child', { CODEX_SESSION_ID: 'codex-1', CODEX_TOOL_CALL_ID: 'exec-9', CLAUDE_CODE_SESSION_ID: 'claude-1' }), [
    { agent: 'claude', session_id: 'claude-1' },
    { agent: 'codex', session_id: 'codex-1', tool_call_id: 'exec-9' },
  ]);
  assert.deepEqual(parentSessions('child', { CODEX_THREAD_ID: 'codex-2' }), [{ agent: 'codex', session_id: 'codex-2' }]);
});

test('Claude Code → Codex: the parent and its shell call that ran codex', () => {
  send('L-claude', 'claude', 'SessionStart');
  send('L-claude', 'claude', 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_ls', tool_input: { command: 'ls' } });
  send('L-claude', 'claude', 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_codex', tool_input: { command: 'codex exec -s read-only "review"' } });
  send('L-claude', 'claude', 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_codex2', tool_input: { command: 'codex exec "another"' } });
  const child = send('L-codex', 'codex', 'SessionStart', {}, [{ agent: 'claude', session_id: 'L-claude' }]);
  // the latest call running codex before the child began
  assert.deepEqual(sessionSummary(child).parent, { id: 'L-claude', agent: 'claude', callId: 'toolu_codex2' });
  assert.equal(sessionSummary(child).parentCandidates, undefined);
});

test('Codex → Claude Code: the tool call id from the environment', () => {
  send('L-codex-2', 'codex', 'SessionStart');
  const child = send('L-claude-2', 'claude', 'SessionStart', {}, [{ agent: 'codex', session_id: 'L-codex-2', tool_call_id: 'exec-1' }]);
  assert.deepEqual(sessionSummary(child).parent, { id: 'L-codex-2', agent: 'codex', callId: 'exec-1' });
});

test('a chain: the direct parent is the named session that started last', () => {
  send('L-root', 'claude', 'SessionStart');
  send('L-middle', 'codex', 'SessionStart', {}, [{ agent: 'claude', session_id: 'L-root' }]);
  const leaf = send('L-leaf', 'claude', 'SessionStart', {}, [
    { agent: 'codex', session_id: 'L-middle', tool_call_id: 'exec-7' },
    { agent: 'claude', session_id: 'L-root' },
  ]);
  assert.deepEqual(sessionSummary(leaf).parent, { id: 'L-middle', agent: 'codex', callId: 'exec-7' });
});

test('no parent: none named, or the named one is not loaded', () => {
  assert.equal(sessionSummary(send('L-alone', 'claude', 'SessionStart')).parent, null);
  assert.equal(sessionSummary(send('L-orphan', 'codex', 'SessionStart', {}, [{ agent: 'claude', session_id: 'not-loaded' }])).parent, null);
});

test('Claude Code → Codex: a command that only names codex is not the one that started it', () => {
  send('L-bg', 'claude', 'SessionStart');
  send('L-bg', 'claude', 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_bg', tool_input: { command: 'codex exec -s read-only "ok"' } });
  send('L-bg', 'claude', 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_cfg', tool_input: { command: 'ls ~/.codex/config.toml' } });
  send('L-bg', 'claude', 'PostToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_cfg' });
  send('L-bg', 'claude', 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_js', tool_input: { command: 'node codex-rollout.js' } });
  const child = send('L-bg-codex', 'codex', 'SessionStart', {}, [{ agent: 'claude', session_id: 'L-bg' }]);
  assert.equal(sessionSummary(child).parent.callId, 'toolu_bg');
});

test('Claude Code → Codex: the call still running when the child began wins over a later finished one', () => {
  send('L-run', 'claude', 'SessionStart');
  send('L-run', 'claude', 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_running', tool_input: { command: 'npx @openai/codex exec "review"' } });
  send('L-run', 'claude', 'PreToolUse', { tool_name: 'PowerShell', tool_use_id: 'toolu_done', tool_input: { command: '& "C:\\npm\\codex.cmd" --version' } });
  send('L-run', 'claude', 'PostToolUse', { tool_name: 'PowerShell', tool_use_id: 'toolu_done' });
  const child = send('L-run-codex', 'codex', 'SessionStart', {}, [{ agent: 'claude', session_id: 'L-run' }]);
  assert.equal(sessionSummary(child).parent.callId, 'toolu_running');
});

test('Claude Code → Codex: a refused or interrupted call does not stay running and take the link', () => {
  send('L-refused', 'claude', 'SessionStart');
  send('L-refused', 'claude', 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_refused', tool_input: { command: 'codex exec "review"' } });
  send('L-refused', 'claude', 'PermissionDenied', { tool_name: 'Bash', tool_use_id: 'toolu_refused' });
  send('L-refused', 'claude', 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_bg', tool_input: { command: 'codex exec "review"' } });
  send('L-refused', 'claude', 'PostToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_bg' });
  const afterRefused = send('L-refused-codex', 'codex', 'SessionStart', {}, [{ agent: 'claude', session_id: 'L-refused' }]);
  assert.equal(sessionSummary(afterRefused).parent.callId, 'toolu_bg');

  send('L-stopped', 'claude', 'SessionStart');
  send('L-stopped', 'claude', 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_interrupted', tool_input: { command: 'codex exec "one"' } });
  send('L-stopped', 'claude', 'UserPromptSubmit', { prompt: 'run it in the background' });
  send('L-stopped', 'claude', 'PreToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_bg2', tool_input: { command: 'codex exec "one"' } });
  send('L-stopped', 'claude', 'PostToolUse', { tool_name: 'Bash', tool_use_id: 'toolu_bg2' });
  const afterInterrupt = send('L-stopped-codex', 'codex', 'SessionStart', {}, [{ agent: 'claude', session_id: 'L-stopped' }]);
  assert.equal(sessionSummary(afterInterrupt).parent.callId, 'toolu_bg2');
});

// the dashboard's links.js and Home's model, as plain browser scripts, over a session list and their activities
function dashboardOver(sessions) {
  const source = file => fs.readFileSync(path.join(__dirname, '..', 'server', 'dashboard', file), 'utf8');
  const prelude = 'const state = { sessions: new Map(sessions.map(session => [session.id, session])) };\n'
    + 'const sessionActivity = session => session.activity;\n';
  return new Function('sessions', prelude + source('features/sessions/links.js') + '\n' + source('features/home/model.js')
    + '\nreturn { homeStartedTree, sessionsStartedByCall, childSessionsOf, forgetSessionLinks, state };')(sessions);
}
const row = (id, activity, parentId, callId) =>
  ({ id, activity, started: `2026-11-22T10:00:${id.replace(/\D/g, '').padStart(2, '0')}Z`, parent: parentId ? { id: parentId, callId } : null });
const homeTree = sessions => {
  const { top, startedUnder } = dashboardOver(sessions).homeStartedTree(sessions);
  return { top: top.map(session => session.id), under: Object.fromEntries([...startedUnder].map(([id, list]) => [id, list.map(child => child.id)])) };
};

test('Home: a working session is not nested under an idle parent, an idle one under a working parent is', () => {
  assert.deepEqual(homeTree([row('p1', 'inactive'), row('c2', 'working', 'p1')]), { top: ['p1', 'c2'], under: {} });
  assert.deepEqual(homeTree([row('p1', 'working'), row('c2', 'ended', 'p1')]), { top: ['p1'], under: { p1: ['c2'] } });
  assert.deepEqual(homeTree([row('p1', 'ended'), row('c2', 'ended', 'p1')]), { top: ['p1'], under: { p1: ['c2'] } });
});

test('Home: sessions deeper than the nesting limit, or in a loop, stay at the top: none is left out', () => {
  const chain = ['s1', 's2', 's3', 's4', 's5', 's6'].map((id, index, ids) => row(id, 'working', ids[index - 1]));
  assert.deepEqual(homeTree(chain), { top: ['s1', 's6'], under: { s1: ['s2'], s2: ['s3'], s3: ['s4'], s4: ['s5'] } });
  assert.deepEqual(homeTree([row('a1', 'working', 'b2'), row('b2', 'working', 'a1')]), { top: ['a1', 'b2'], under: {} });
});

test('the sessions a call started come from one index, rebuilt after the sessions change', () => {
  const dashboard = dashboardOver([row('p1', 'working'), row('c2', 'working', 'p1', 'toolu_1'), row('c3', 'working', 'p1', 'toolu_1')]);
  assert.deepEqual(dashboard.sessionsStartedByCall('toolu_1').map(session => session.id), ['c2', 'c3']);
  assert.deepEqual(dashboard.sessionsStartedByCall('toolu_none'), []);
  dashboard.state.sessions.set('c4', row('c4', 'working', 'p1', 'toolu_2'));
  dashboard.forgetSessionLinks();
  assert.deepEqual(dashboard.sessionsStartedByCall('toolu_2').map(session => session.id), ['c4']);
  assert.deepEqual(dashboard.childSessionsOf({ id: 'p1' }).map(session => session.id), ['c2', 'c3', 'c4']);
});
