// Codex support: Codex hook events go through the same hook and server as Claude Code's and come out as Codex
// sessions; model requests become model steps; setup-codex.js adds and removes the hooks in a Codex hooks file; and
// the dashboard reads Codex's tool names; the Context view reads Codex's session file.
// Zero dependencies — run with `node --test test/codex.test.js`.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { freePort, waitFor: waitUntil, stopProcess } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hook.js');
const SETUP = path.join(ROOT, 'scripts', 'setup-codex.js');
const SERVER = path.join(ROOT, 'server', 'server.js');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'so-codex-'));
const CODEX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'so-codex-home-'));
const SESSION = 'codex-sess-1';
let port, server;

const env = () => ({ ...process.env, OBSERVER_DATA_DIR: DATA_DIR, OBSERVER_PORT: String(port), OBSERVER_AUTOSTART: '0' });
const runHook = (eventName, payload, ...extraArgs) =>
  spawnSync(process.execPath, [HOOK, eventName, ...extraArgs], { input: JSON.stringify(payload), env: env(), timeout: 10000 });
const codexHook = (eventName, fields) =>
  runHook(eventName, { hook_event_name: eventName, session_id: SESSION, cwd: '/work/app', model: 'gpt-5-codex', ...fields }, '--agent', 'codex');

const waitFor = (check, ms = 8000) => waitUntil(check, ms, server);
const getJson = async apiPath => (await fetch(`http://127.0.0.1:${port}${apiPath}`)).json();

const PATCH = '*** Begin Patch\n*** Update File: src/app.ts\n@@\n-old\n+new\n*** Add File: src/new.ts\n+export {};\n*** End Patch';

before(async () => {
  port = await freePort();
  codexHook('SessionStart', { source: 'startup', transcript_path: path.join(DATA_DIR, 'rollout.jsonl') });
  codexHook('UserPromptSubmit', { turn_id: 'turn-1', prompt: 'fix the bug' });
  codexHook('PreToolUse', { turn_id: 'turn-1', tool_name: 'apply_patch', tool_use_id: 'call-1', tool_input: { command: PATCH } });
  codexHook('PostToolUse', { turn_id: 'turn-1', tool_name: 'apply_patch', tool_use_id: 'call-1', tool_input: { command: PATCH }, tool_response: 'Success' });
  codexHook('PostModelRequest', {
    turn_id: 'turn-1', status: 'completed', error: null,
    token_usage: { input_tokens: 12000, cached_input_tokens: 10000, output_tokens: 300, reasoning_output_tokens: 120, total_tokens: 12300 },
  });
  codexHook('PostModelRequest', { turn_id: 'turn-1', agent_id: 'sub-1', agent_type: 'worker', model: 'gpt-5-mini', status: 'completed', token_usage: { input_tokens: 500, output_tokens: 50 } });
  codexHook('Stop', { turn_id: 'turn-1', stop_hook_active: false, last_assistant_message: 'Fixed.' });
  runHook('SessionStart', { hook_event_name: 'SessionStart', session_id: 'claude-sess-1', cwd: '/work/app', source: 'startup' });
  server = spawn(process.execPath, [SERVER], { env: env(), stdio: 'ignore' });
  await waitFor(async () => (await getJson('/api/health')).ok);
});

after(async () => {
  await stopProcess(server);
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.rmSync(CODEX_HOME, { recursive: true, force: true });
});

test('the hook marks Codex events, and Claude Code events without --agent stay Claude', () => {
  const sessionLogs = path.join(DATA_DIR, 'sessions');
  const log = fs.readdirSync(sessionLogs).flatMap(day => fs.readdirSync(path.join(sessionLogs, day)).map(name => path.join(sessionLogs, day, name)))
    .flatMap(file => fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)));
  assert.ok(log.filter(event => event.session_id === SESSION).every(event => event.agent === 'codex'));
  assert.equal(log.find(event => event.session_id === 'claude-sess-1').agent, 'claude');
});

test('Codex and Claude Code sessions are served side by side, each with its agent', async () => {
  const sessions = await waitFor(async () => {
    const list = await getJson('/api/sessions');
    return list.length >= 2 ? list : null;
  });
  const codex = sessions.find(session => session.id === SESSION);
  assert.equal(codex.agent, 'codex');
  assert.equal(sessions.find(session => session.id === 'claude-sess-1').agent, 'claude');
  assert.equal(codex.model, 'gpt-5-codex', "a subagent's model request does not change the session's model");
  assert.equal(codex.toolCalls, 1);
  assert.equal(codex.busy, false);
});

test("a Codex model request becomes a model step with the request's tokens", async () => {
  const events = await getJson(`/api/events?session=${SESSION}`);
  assert.ok(!events.some(event => event.event === 'PostModelRequest'), 'turned into ModelSteps');
  const steps = events.filter(event => event.event === 'ModelStep');
  assert.equal(steps.length, 2);
  const [main, subagent] = steps;
  assert.equal(main.agent, 'codex');
  assert.equal(main.category, 'model');
  assert.deepEqual(main.data.tokens, { input: 2000, output: 300, cache_read: 10000, cache_write: 0, context: 12000 });
  assert.equal(main.data.stop_reason, 'completed');
  assert.equal(main.data.subagent, false);
  assert.equal(subagent.data.subagent, true);
  assert.equal(subagent.data.agent_id, 'sub-1');

  const session = (await getJson('/api/sessions')).find(candidate => candidate.id === SESSION);
  assert.deepEqual([session.usage.input, session.usage.output, session.usage.cache_read, session.usage.turns], [2500, 350, 10000, 2]);
  assert.equal(session.modelSteps, 2);
  assert.equal(session.context.tokens, 12000, 'the main agent sets the context size, not the subagent');
  assert.equal(session.context.window, 272000);
});

test('a Codex model step lists the tool calls it started, and comes before them', async () => {
  const events = await getJson(`/api/events?session=${SESSION}`);
  const [main, subagent] = events.filter(event => event.event === 'ModelStep');
  const call = events.find(event => event.event === 'PreToolUse');
  assert.deepEqual([main.data.tools, main.data.tool_ids], [['apply_patch'], ['call-1']], "the hook's own tool_use_id");
  assert.ok(main.ts < call.ts, 'Codex sends PostModelRequest after the calls it started');
  assert.deepEqual(subagent.data.tools, [], "the main agent's calls are not the subagent's");
});

test('a Codex permission waits for its own call, not for a call run beside it', async () => {
  const id = 'codex-wait';
  const hook = (eventName, fields) =>
    runHook(eventName, { hook_event_name: eventName, session_id: id, cwd: '/work/app', turn_id: 'turn-w', ...fields }, '--agent', 'codex');
  const waits = expected => waitFor(async () => {
    const session = (await getJson('/api/sessions')).find(s => s.id === id);
    return session && JSON.stringify(session.needsYou.map(wait => wait.tool)) === JSON.stringify(expected) && session;
  });
  hook('UserPromptSubmit', { prompt: 'clean up' });
  hook('PreToolUse', { tool_name: 'exec_command', tool_use_id: 'w-ls', tool_input: { cmd: 'ls' } });
  hook('PreToolUse', { tool_name: 'exec_command', tool_use_id: 'w-rm', tool_input: { cmd: 'rm -rf build' } });
  // as Codex sends it: no tool_use_id, and a description the call's own input doesn't have
  hook('PermissionRequest', { tool_name: 'exec_command', tool_input: { cmd: 'rm -rf build', description: 'Remove the build folder' } });
  await waits(['exec_command']);
  hook('PostToolUse', { tool_name: 'exec_command', tool_use_id: 'w-ls', tool_input: { cmd: 'ls' }, tool_response: 'src' });
  await waitFor(async () => (await getJson('/api/sessions')).find(s => s.id === id)?.running === 1);
  await waits(['exec_command']);
  hook('PostToolUse', { tool_name: 'exec_command', tool_use_id: 'w-rm', tool_input: { cmd: 'rm -rf build' }, tool_response: '' });
  await waits([]);
});

test("what a Codex model wrote comes from Codex's session file, with its step's id", async () => {
  const id = 'codex-live', rollout = path.join(DATA_DIR, 'live-rollout.jsonl');
  const hook = (eventName, fields) => runHook(eventName,
    { hook_event_name: eventName, session_id: id, cwd: '/work/app', model: 'gpt-5-codex', transcript_path: rollout, ...fields }, '--agent', 'codex');
  fs.writeFileSync(rollout, '');
  hook('UserPromptSubmit', { turn_id: 't1', prompt: 'look around' });
  const now = () => new Date(Date.now() + 1000).toISOString();
  const rows = [
    { type: 'response_item', payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Check the folder first.' }], encrypted_content: 'x' } },
    { type: 'response_item', payload: { type: 'reasoning', summary: [], encrypted_content: 'y' } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Listing the files.' }] } },
    { type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'c1', name: 'exec', input: 'ls' } },
    { type: 'token_usage_record', payload: { response_id: 'resp-1', usage: { input_tokens: 900, output_tokens: 40 } } },
  ];
  fs.appendFileSync(rollout, rows.map(row => JSON.stringify({ timestamp: now(), ...row }) + '\n').join(''));
  hook('PostModelRequest', { turn_id: 't1', response_id: 'resp-1', status: 'completed', token_usage: { input_tokens: 900, output_tokens: 40 } });
  const texts = await waitFor(async () => {
    const list = (await getJson(`/api/events?session=${id}`)).filter(event => event.event === 'ModelText');
    return list.length >= 2 && list;
  });
  assert.deepEqual(texts.map(event => [event.data.kind, event.data.text]),
    [['thinking', 'Check the folder first.'], ['text', 'Listing the files.']], 'encrypted reasoning stays out');
  assert.ok(texts.every(event => event.data.msg_id === 'resp-1' && event.agent === 'codex'));
  const step = (await getJson(`/api/events?session=${id}`)).find(event => event.event === 'ModelStep');
  assert.equal(step.data.msg_id, 'resp-1');
});

// ---- the Context view, from Codex's session file (the "rollout" transcript_path points to)
const kinds = (...list) => ({ internal_chat_message_metadata_passthrough: { content_item_kinds: list } });
const message = (role, texts, ...list) => ({ type: 'message', role, content: texts.map(text => ({ type: role === 'assistant' ? 'output_text' : 'input_text', text })), ...kinds(...list) });
const SKILLS = '<skills_instructions>\n## Skills\n### Available skills\n- review: Review a diff (file: r0/review/SKILL.md)\n- docs: Write docs (file: r0/docs/SKILL.md)\n</skills_instructions>';
const SKILLS_UPDATE = '<skills_instructions>\n## Host skills update\n### Added or updated skills:\n- deploy: Ship it (file: r0/deploy/SKILL.md)\n</skills_instructions>';
const DEFERRED = '<tools>\nDeferred tool namespaces:\n- mcp__docs: Search the docs\n</tools>';
const ROLLOUT = [
  { type: 'session_meta', payload: { base_instructions: { text: 'You are Codex.' } } },
  { type: 'event_msg', payload: { type: 'task_started', model_context_window: 258400 } },
  { type: 'turn_context', payload: { model: 'gpt-5-codex' } },
  { type: 'response_item', payload: { type: 'additional_tools', tools: [
    { type: 'namespace', name: 'functions', tools: [{ type: 'function', name: 'shell', description: 'Run a command', parameters: { type: 'object' } }] },
    { type: 'namespace', name: 'mcp__docs', tools: [{ type: 'function', name: 'search', description: 'Search', parameters: {} }] },
  ] } },
  { type: 'response_item', payload: message('developer', ['You are Codex.'], 'model.base_instructions') },
  { type: 'response_item', payload: message('developer', ['<permissions instructions>sandboxed</permissions instructions>', SKILLS, DEFERRED],
    'permissions.instructions', 'host_skills.instructions', 'tools.deferred_namespaces') },
  { type: 'response_item', payload: message('user', ['# AGENTS.md instructions for /work/app\n\n<INSTRUCTIONS>Use tabs.</INSTRUCTIONS>']) },
  { type: 'response_item', payload: message('user', ['<environment_context><cwd>/work/app</cwd></environment_context>'], 'environments.environment_context') },
  { type: 'response_item', payload: message('user', ['fix the bug\n'], 'user.text') },
  { type: 'response_item', payload: { type: 'reasoning', summary: [], encrypted_content: 'xyz' } },
  { type: 'response_item', payload: message('assistant', ['Looking.'], 'unknown') },
  { type: 'response_item', payload: { type: 'function_call', call_id: 'c1', name: 'shell', arguments: '{"command":"ls"}' } },
  { type: 'token_usage_record', payload: { usage: { input_tokens: 12000, cached_input_tokens: 10000, output_tokens: 300 } } },
  { type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: 'src' } },
  { type: 'response_item', payload: message('developer', [SKILLS_UPDATE], 'host_skills.instructions') },
  { type: 'some_future_row', payload: { anything: true } },
  'not json',
].map(row => (typeof row === 'string' ? row : JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z', ...row }))).join('\n');

test("the Context view reads a Codex session from Codex's session file", async () => {
  fs.writeFileSync(path.join(DATA_DIR, 'rollout.jsonl'), ROLLOUT);
  const context = await getJson(`/api/context?session=${SESSION}`);
  assert.equal(context.agent, 'codex');
  assert.equal(context.system, 'You are Codex.');
  assert.equal(context.window, 258400);
  assert.deepEqual(context.tools.map(tool => tool.name), ['shell', 'mcp__docs__search'], 'MCP tools keep the mcp__server__tool form');
  assert.deepEqual(context.instructions.map(file => file.path), ['permissions instructions', '/work/app/AGENTS.md']);
  assert.deepEqual(context.skills.map(skill => skill.name), ['review', 'docs', 'deploy'], 'an update adds to the list');
  assert.equal(context.skills[0].description, 'Review a diff', "the SKILL.md's path is left out");
  assert.deepEqual(context.deferred.tools, [{ name: 'mcp__docs', loaded: false }]);

  const conversation = context.items.filter(item => item.role !== 'pinned').map(item => item.kind);
  assert.deepEqual(conversation, ['attachment', 'user', 'step', 'text', 'call', 'result'],
    'the model step goes before its reply; encrypted reasoning and unknown rows are left out');
  const step = context.items.find(item => item.kind === 'step');
  assert.deepEqual([step.ctx, step.out, step.model], [12000, 300, 'gpt-5-codex'], 'input_tokens already includes the cached part');
  assert.deepEqual(context.items.find(item => item.kind === 'call').input, { command: 'ls' });
  assert.equal(context.items.find(item => item.kind === 'result').id, 'c1');
  assert.equal(context.measured.firstCtx, 12000);
});

test('the Context view says when the Codex session file is missing', async () => {
  fs.rmSync(path.join(DATA_DIR, 'rollout.jsonl'), { force: true });
  const context = await getJson(`/api/context?session=${SESSION}`);
  assert.match(context.error, /not found/);
});

// ---- setup-codex.js
const HOOKS_FILE = path.join(CODEX_HOME, 'hooks.json');
const runSetup = (...args) => spawnSync(process.execPath, [SETUP, ...args], { env: { ...process.env, CODEX_HOME }, encoding: 'utf8', timeout: 10000 });
const readHooksFile = () => JSON.parse(fs.readFileSync(HOOKS_FILE, 'utf8'));
const OTHER_HOOK = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] };
const ourHandlers = config => Object.values(config.hooks).flat().flatMap(group => group.hooks).filter(handler => handler.command.includes('--agent codex'));

test('setup-codex adds the hooks next to the ones already there, once however often it runs', () => {
  fs.writeFileSync(HOOKS_FILE, JSON.stringify({ description: 'mine', hooks: { PreToolUse: [OTHER_HOOK] } }));
  assert.equal(runSetup().status, 0);
  assert.equal(runSetup().status, 0);
  const config = readHooksFile();
  const pluginEvents = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, '.codex-plugin', 'plugin.json'), 'utf8')).hooks.hooks);
  assert.equal(config.description, 'mine');
  assert.deepEqual(config.hooks.PreToolUse[0], OTHER_HOOK, 'the existing hook is kept, first');
  assert.equal(ourHandlers(config).length, pluginEvents.length, 'one handler per event, not two');
  for (const handler of ourHandlers(config)) {
    assert.ok(handler.command.includes(HOOK), 'the full path to this hook.js, not ${PLUGIN_ROOT}');
    assert.equal(handler.async, true);
  }
});

test('setup-codex --remove takes out only its own hooks', () => {
  assert.equal(runSetup('--remove').status, 0);
  assert.deepEqual(readHooksFile().hooks, { PreToolUse: [OTHER_HOOK] });
});

test('setup-codex leaves a broken hooks file alone', () => {
  fs.writeFileSync(HOOKS_FILE, '{ not json');
  const result = runSetup();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Could not read/);
  assert.equal(fs.readFileSync(HOOKS_FILE, 'utf8'), '{ not json');
});

// ---- the dashboard's view of Codex tools (plain browser scripts, evaluated in the page's order)
const source = file => fs.readFileSync(path.join(ROOT, 'server', 'dashboard', file), 'utf8');
const SCRIPTS = [
  'building-blocks/language/i18n.js', 'building-blocks/language/translations/en.js', 'building-blocks/language/selected-language.js',
  'building-blocks/format.js', 'building-blocks/tech-badges.js', 'features/agents/model/agents.js', 'features/events/model/tool-groups.js', 'features/events/model/tool-techs.js',
  'features/events/model/meaning.js',
];
// the agents as the server lists them (/api/agents)
const dashboard = new Function('AGENT_LIST', SCRIPTS.map(source).join('\n')
  + '\nsetAgents(AGENT_LIST);\nreturn { patchedFiles, filesOfToolCall, toolGroupOf, toolArgument, firstTechOfToolCall, isSubagentCall };')(
  require('../server/lib/features/agents/registry').publicAgents());

test("the dashboard reads Codex's tools: patches edit files, exec_command runs commands, spawn_agent starts a subagent", () => {
  const input = { command: PATCH };
  assert.deepEqual(dashboard.patchedFiles(input), ['src/app.ts', 'src/new.ts']);
  assert.deepEqual(dashboard.patchedFiles({ command: PATCH.replace(/\n/g, '\r\n') }), ['src/app.ts', 'src/new.ts'], 'Windows line ends');
  assert.deepEqual(dashboard.patchedFiles({ command: '*** Update File: a.js\n*** Move to: b.js' }), ['a.js', 'b.js']);
  assert.deepEqual(dashboard.filesOfToolCall('Edit', { file_path: 'x.py' }), ['x.py']);
  assert.equal(dashboard.toolGroupOf('apply_patch', input), 'files');
  assert.equal(dashboard.toolArgument({ tool_name: 'apply_patch', tool_input: input }), 'src/app.ts, src/new.ts');
  assert.equal(dashboard.firstTechOfToolCall('apply_patch', input), 'ts');
  assert.equal(dashboard.toolGroupOf('exec_command', { command: 'git status' }), 'git');
  assert.equal(dashboard.toolGroupOf('exec_command', { command: 'npm test' }), 'shell');
  assert.ok(dashboard.isSubagentCall('spawn_agent'));
  assert.equal(dashboard.toolGroupOf('spawn_agent', {}), 'agents');
});
