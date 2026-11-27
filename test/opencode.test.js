// OpenCode support: its plugin hooks and bus events become contract events (translate.js), and setup-opencode.js
// adds and removes the plugin loader. The recorded sessions run through a real server in test/agents.test.js.
// Zero dependencies — run with `node --test test/opencode.test.js`.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createOpencodeTranslator } = require('../server/lib/features/agents/opencode/translate');
const { eventProblems } = require('../server/lib/building-blocks/event-contract');
const { createOpencodePlugin } = require('../server/lib/features/agents/opencode/capture/plugin');

const SETUP = path.join(__dirname, '..', 'scripts', 'setup-opencode.js');

// a translator whose events land in a list, as the recorder would write them
function translator() {
  const events = [];
  let started = 0;
  const translate = createOpencodeTranslator({
    emit: (event, sessionId, data, options = {}) => {
      const line = { ts: options.ts || '2026-11-27T10:00:00.000Z', event, session_id: sessionId, agent: 'opencode', data: { ...data, session_id: sessionId }, ...(options.native ? { native: options.native } : {}), ...(options.parents?.length ? { parents: options.parents } : {}) };
      events.push(line);
      return line;
    },
    onFirstSession: () => { started++; },
  });
  return { translate, events, started: () => started };
}

const session = (id, extra = {}) => ({ type: 'session.created', properties: { info: { id, directory: '/work', title: 'New session', version: '1.17.8', ...extra } } });
const part = props => ({ type: 'message.part.updated', properties: { part: { sessionID: 's1', messageID: 'm1', ...props } } });

test('a session, its prompt, a tool call and its result become contract events', () => {
  const { translate, events, started } = translator();
  translate.event(session('s1'));
  translate.chatMessage({ sessionID: 's1', agent: 'build', model: { modelID: 'm' } }, { message: {}, parts: [{ type: 'text', text: 'run echo' }] });
  translate.toolBefore({ tool: 'bash', sessionID: 's1', callID: 'c1' }, { args: { command: 'echo hi' } });
  translate.toolAfter({ tool: 'bash', sessionID: 's1', callID: 'c1', args: { command: 'echo hi' } }, { title: 'Echo', output: 'hi\n', metadata: { exit: 0 } });
  translate.event({ type: 'session.idle', properties: { sessionID: 's1' } });
  assert.deepEqual(events.map(event => event.event), ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']);
  assert.equal(events[1].data.prompt, 'run echo');
  assert.deepEqual([events[2].data.tool_name, events[2].data.tool_input, events[2].data.tool_use_id], ['bash', { command: 'echo hi' }, 'c1']);
  assert.equal(events[3].data.tool_response, 'hi\n');
  assert.equal(started(), 1, 'the dashboard server is started with the first session');
  for (const event of events) {
    assert.deepEqual(eventProblems(event), [], event.event);
    assert.ok(event.native?.event, `${event.event} keeps OpenCode's own event`);
  }
});

test('a model step carries its tokens, the window from chat.params and the calls it asked for, placed at its start', () => {
  const { translate, events } = translator();
  translate.chatParams({ sessionID: 's1', agent: 'build', model: { id: 'gemma', limit: { context: 64000 } } });
  translate.event(part({ id: 'p0', type: 'step-start' }));
  translate.event(part({ id: 'p1', type: 'tool', tool: 'read', callID: 'c1', state: { status: 'pending' } }));
  translate.event(part({ id: 'p1', type: 'tool', tool: 'read', callID: 'c1', state: { status: 'running' } }));
  const finish = part({ id: 'p2', type: 'step-finish', reason: 'tool-calls', cost: 0, tokens: { input: 1000, output: 30, reasoning: 5, cache: { read: 200, write: 10 } } });
  translate.event(finish);
  translate.event(finish); // OpenCode can send a part again: one step
  const steps = events.filter(event => event.event === 'ModelStep');
  assert.equal(steps.length, 1);
  assert.deepEqual(steps[0].data.tokens, { input: 1000, output: 35, cache_read: 200, cache_write: 10, context: 1210 });
  assert.deepEqual([steps[0].data.tools, steps[0].data.tool_ids, steps[0].data.model_context_window, steps[0].data.model], [['read'], ['c1'], 64000, 'gemma']);
  assert.notEqual(steps[0].ts, '2026-11-27T10:00:00.000Z', 'placed at its step-start');
  assert.deepEqual(eventProblems(steps[0]), []);
});

test('a failed tool part is a failure, unless its result already came', () => {
  const { translate, events } = translator();
  translate.event(part({ id: 'p1', type: 'tool', tool: 'read', callID: 'c1', state: { status: 'error', input: { filePath: 'x' }, error: 'File not found' } }));
  translate.toolAfter({ tool: 'bash', sessionID: 's1', callID: 'c2', args: {} }, { output: 'ok' });
  translate.event(part({ id: 'p2', type: 'tool', tool: 'bash', callID: 'c2', state: { status: 'error', error: 'late' } }));
  assert.deepEqual(events.map(event => [event.event, event.data.tool_use_id]), [['PostToolUseFailure', 'c1'], ['PostToolUse', 'c2']]);
  assert.equal(events[0].data.error, 'File not found');
});

test("a subagent's session links to the task call that started it", () => {
  const { translate, events } = translator();
  translate.event(session('parent'));
  translate.toolBefore({ tool: 'task', sessionID: 'parent', callID: 'call_task' }, { args: { description: 'Child run', subagent_type: 'general' } });
  translate.event(session('child', { parentID: 'parent', title: 'Child run (@general subagent)' }));
  const child = events.find(event => event.session_id === 'child');
  assert.deepEqual(child.parents, [{ agent: 'opencode', session_id: 'parent', tool_call_id: 'call_task' }]);
});

test("the title generator's call is left out, and the system prompt is recorded once until it changes", () => {
  const { translate, events } = translator();
  translate.systemTransform({ sessionID: 's1' }, { system: ['You are a title generator.'] });
  translate.chatParams({ sessionID: 's1', agent: 'title', model: { id: 'm', limit: { context: 1000 } } });
  translate.systemTransform({ sessionID: 's1' }, { system: ['You are opencode.', 'Always be brief.'] });
  translate.chatParams({ sessionID: 's1', agent: 'build', model: { id: 'm', limit: { context: 64000 } } });
  translate.chatParams({ sessionID: 's1', agent: 'build', model: { id: 'm', limit: { context: 64000 } } });
  const loaded = events.filter(event => event.event === 'InstructionsLoaded');
  assert.equal(loaded.length, 1);
  assert.match(loaded[0].data.system_prompt, /Always be brief/);
});

test('noise is dropped, other session events pass through, and commands see their session', () => {
  const { translate, events } = translator();
  for (const type of ['plugin.added', 'catalog.updated', 'message.part.delta', 'session.status', 'session.diff']) translate.event({ type, properties: { sessionID: 's1' } });
  translate.event({ type: 'todo.updated', properties: { sessionID: 's1', todos: [] } });
  translate.event({ type: 'lsp.updated', properties: {} });
  assert.deepEqual(events.map(event => [event.event, event.data.native_event]), [['AgentEvent', 'todo.updated']]);
  assert.deepEqual(eventProblems(events[0]), []);
  const output = { env: {} };
  translate.shellEnv({ sessionID: 's1', cwd: '/work' }, output);
  assert.deepEqual(output.env, { OBSERVER_PARENT_AGENT: 'opencode', OBSERVER_PARENT_SESSION: 's1' });
});

test('closing OpenCode ends every session it ran', () => {
  const { translate, events } = translator();
  translate.event(session('a'));
  translate.event(session('b'));
  translate.dispose();
  assert.deepEqual(events.filter(event => event.event === 'SessionEnd').map(event => event.session_id), ['a', 'b']);
});

test('the plugin answers every hook OpenCode calls, and an error never reaches OpenCode', async () => {
  const hooks = await createOpencodePlugin()({});
  for (const name of ['event', 'chat.message', 'chat.params', 'tool.execute.before', 'tool.execute.after', 'permission.ask', 'shell.env', 'dispose']) {
    assert.equal(typeof hooks[name], 'function', name);
  }
  await hooks['tool.execute.before'](null, null); // malformed input: swallowed
  await hooks.event({ event: null });
});

test('setup-opencode.js adds the plugin loader, keeps a file it did not write, and removes its own', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'so-opencode-'));
  const env = { ...process.env, XDG_CONFIG_HOME: home };
  const run = (...args) => spawnSync(process.execPath, [SETUP, ...args], { env, encoding: 'utf8' });
  const loader = path.join(home, 'opencode', 'plugin', 'session-observer.js');
  try {
    assert.equal(run().status, 0);
    const source = fs.readFileSync(loader, 'utf8');
    assert.match(source, /createRequire\(import\.meta\.url\)/);
    assert.match(source, /export const SessionObserver = createOpencodePlugin\(\);/);
    assert.equal(run('--remove').status, 0);
    assert.throws(() => fs.readFileSync(loader), { code: 'ENOENT' }, 'removed');
    fs.writeFileSync(loader, '// my own plugin', { flag: 'wx' });
    assert.notEqual(run().status, 0, 'a file it did not write is not replaced');
    assert.notEqual(run('--remove').status, 0, 'nor removed');
    assert.equal(fs.readFileSync(loader, 'utf8'), '// my own plugin');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
