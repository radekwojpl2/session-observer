// The agents registry (server/lib/features/agents/): each agent's folder has a manifest and a tool map, the server's
// tool roles come from them, and the tool maps give the same sets the server and dashboard used to spell out.
// Zero dependencies — run with `node --test test/agent-registry.test.js`.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AGENT_IDS, DEFAULT_AGENT, agentById, isKnownAgent, toolsWithRole, publicAgents, agentServer } = require('../server/lib/features/agents/registry');

const ROLES = ['command', 'subagentCall', 'subagent', 'question', 'asyncQuestion', 'task', 'patch'];
const sorted = set => [...set].sort();

test('Claude Code and Codex are registered, Claude Code first and the default', () => {
  assert.deepEqual(AGENT_IDS, ['claude', 'codex']);
  assert.equal(DEFAULT_AGENT, 'claude');
  assert.ok(isKnownAgent('codex'));
  assert.equal(isKnownAgent('nobody'), false);
  assert.equal(agentById('nobody'), null);
});

test('every manifest names the agent, its colours, its command and how its events are captured', () => {
  for (const id of AGENT_IDS) {
    const agent = agentById(id);
    assert.equal(agent.id, id);
    for (const key of ['name', 'shortName', 'command', 'capture', 'runtime']) assert.equal(typeof agent[key], 'string', `${id}.${key}`);
    assert.match(agent.color.light, /^#[0-9a-f]{6}$/i);
    assert.match(agent.color.dark, /^#[0-9a-f]{6}$/i);
    assert.equal(typeof agent.reportsContextWindow, 'boolean');
  }
});

test('every tool map has its groups, all roles and its path fields', () => {
  for (const id of AGENT_IDS) {
    const { tools } = agentById(id);
    assert.ok(Array.isArray(tools.groups.files) && Array.isArray(tools.groups.shell), `${id}: groups`);
    for (const role of ROLES) assert.ok(Array.isArray(tools.roles[role]), `${id}: roles.${role}`);
    assert.ok(Array.isArray(tools.pathFields), `${id}: pathFields`);
    for (const name of tools.roles.command) assert.ok(tools.groups.shell.includes(name), `${id}: ${name} runs commands, so it is a shell tool`);
  }
});

test('the roles add up to the sets the server spelled out before', () => {
  assert.deepEqual(sorted(toolsWithRole('question')), ['AskUserQuestion', 'request_user_input', 'request_user_input_async']);
  assert.deepEqual(sorted(toolsWithRole('subagent')), ['Agent', 'SendMessage', 'Task', 'spawn_agent']);
  assert.deepEqual(sorted(toolsWithRole('task')), ['TaskCreate', 'TaskGet', 'TaskList', 'TaskStop', 'TaskUpdate', 'TodoWrite', 'update_plan']);
  assert.deepEqual(sorted(toolsWithRole('command')), ['Bash', 'PowerShell', 'exec_command', 'local_shell', 'shell']);
  assert.deepEqual(sorted(toolsWithRole('subagentCall')), ['Agent', 'Task', 'spawn_agent']);
  assert.deepEqual(sorted(toolsWithRole('patch')), ['apply_patch']);
  assert.deepEqual(sorted(toolsWithRole('asyncQuestion')), ['request_user_input_async']);
});

test('the dashboard gets names, colours, tools and how the context differs, but not server-side behaviour', () => {
  const [claude, codex] = publicAgents();
  assert.deepEqual(Object.keys(claude).sort(), ['autocompactBuffer', 'color', 'contextNoteKey', 'id', 'name', 'reportsContextWindow', 'shortName', 'tools']);
  assert.equal(claude.name, 'Claude Code');
  assert.deepEqual([claude.reportsContextWindow, claude.autocompactBuffer, claude.contextNoteKey], [false, true, null]);
  assert.deepEqual([codex.reportsContextWindow, codex.autocompactBuffer, codex.contextNoteKey], [true, false, 'codexContextNote']);
});

test('Codex has server hooks for its model steps, session file and Context view; an unknown agent has none', () => {
  const codex = agentServer('codex');
  for (const hook of ['noteEvent', 'modelStepFrom', 'addStepUsage', 'transcriptRowEvents', 'sessionContext', 'reset', 'clearSession']) {
    assert.equal(typeof codex[hook], 'function', hook);
  }
  assert.equal(codex.readsSubagentTranscripts, false);
  assert.equal(agentServer('nobody'), null);
  const request = { event: 'PostModelRequest', agent: 'codex', session_id: 's', ts: '2026-11-27T10:00:00.000Z', data: { token_usage: { input_tokens: 10, output_tokens: 2 } } };
  assert.equal(codex.modelStepFrom(request), true);
  assert.equal(request.event, 'ModelStep');
  assert.equal(codex.modelStepFrom({ event: 'Stop', agent: 'codex', data: {} }), false);
});
