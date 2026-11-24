// pi and omp (oh-my-pi) support: the extension in pi-extension/ turns their events into hook events, written to the
// same log in the agent's own process; the server serves them as pi / omp sessions, with model steps and tokens from
// the extension, and an omp subagent nested under its orchestrator; setup-pi.js installs and removes the extension.
// The harnesses are faked: the test calls the handlers the extension subscribes, with events shaped as pi's and omp's
// docs and type definitions give them. Zero dependencies — run with `node --test test/pi.test.js`.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const EXTENSION = path.join(ROOT, 'pi-extension', 'session-observer.js');
const SETUP = path.join(ROOT, 'scripts', 'setup-pi.js');
const SERVER = path.join(ROOT, 'server', 'server.js');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'so-pi-'));
const AGENT_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'so-pi-home-'));
let port, server;

// the extension writes through scripts/hook.js in this process, which reads where to when it is first loaded
process.env.OBSERVER_DATA_DIR = DATA_DIR;
process.env.OBSERVER_AUTOSTART = '0';
delete process.env.OBSERVER_PARENT_AGENT;
delete process.env.OBSERVER_PARENT_SESSION;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port: free } = probe.address();
      probe.close(() => resolve(free));
    });
    probe.on('error', reject);
  });
}

// a fake harness: the extension subscribes to it, and fire() calls the handlers of one event, returning their results
function fakeHarness(agent) {
  const handlers = new Map();
  const api = { on: (name, handler) => handlers.set(name, [...(handlers.get(name) || []), handler]) };
  require(EXTENSION).forAgent(agent)(api);
  require(EXTENSION).forAgent(agent)(api); // a second load in the same process subscribes nothing more
  return { handlers, fire: (name, event, ctx) => (handlers.get(name) || []).map(handler => handler({ type: name, ...event }, ctx)) };
}
const MODEL = { provider: 'anthropic', id: 'claude-sonnet-4-5', contextWindow: 200000 };
const ctxOf = (sessionId, { file = `/sessions/2026-11-24_${sessionId}.jsonl`, header = { type: 'session', id: sessionId } } = {}) => ({
  cwd: '/work/app', model: MODEL,
  sessionManager: { getSessionId: () => sessionId, getSessionFile: () => file, getHeader: () => header },
});
const reply = (fields = {}) => ({
  role: 'assistant', model: 'claude-sonnet-4-5', provider: 'anthropic', stopReason: 'toolUse', responseId: 'resp-1', timestamp: Date.now(),
  content: [
    { type: 'thinking', thinking: 'List the folder first.' },
    { type: 'text', text: 'Looking around.' },
    { type: 'toolCall', id: 'call-1', name: 'bash', arguments: { command: 'ls' } },
  ],
  usage: { input: 1000, output: 50, cacheRead: 9000, cacheWrite: 0, totalTokens: 10050, cost: { total: 0.01 } },
  ...fields,
});

async function waitFor(check, ms = 8000) {
  const end = Date.now() + ms;
  let lastError;
  while (Date.now() < end) {
    if (server.exitCode != null) throw new Error(`the server exited (${server.exitCode})`);
    try { const value = await check(); if (value) return value; } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw lastError || new Error('timed out');
}
const getJson = async apiPath => (await fetch(`http://127.0.0.1:${port}${apiPath}`)).json();
const sessionById = async id => waitFor(async () => (await getJson('/api/sessions')).find(session => session.id === id));

const handlerResults = [];
before(async () => {
  port = await freePort();

  // a pi session: a prompt, a command that works, a read that fails, one reply, the end of the run and of the session
  const pi = fakeHarness('pi');
  const piCtx = ctxOf('pi-sess-1');
  pi.fire('session_start', { reason: 'startup' }, piCtx);
  pi.fire('before_agent_start', { messageType: 'user', prompt: 'fix the bug' }, piCtx);
  pi.fire('message_end', { message: reply() }, piCtx);
  handlerResults.push(...pi.fire('tool_execution_start', { toolCallId: 'call-1', toolName: 'bash', args: { command: 'ls' } }, piCtx));
  pi.fire('tool_execution_end', { toolCallId: 'call-1', toolName: 'bash', result: { content: [{ type: 'text', text: 'src\ntest' }] }, isError: false }, piCtx);
  pi.fire('tool_execution_start', { toolCallId: 'call-2', toolName: 'read', args: { path: 'missing.ts' } }, piCtx);
  pi.fire('tool_execution_end', { toolCallId: 'call-2', toolName: 'read', result: { content: [{ type: 'text', text: 'ENOENT: missing.ts' }] }, isError: true }, piCtx);
  pi.fire('message_end', { message: reply({ responseId: 'resp-2', stopReason: 'stop', content: [{ type: 'text', text: 'Fixed.' }] }) }, piCtx);
  pi.fire('agent_end', { messages: [] }, piCtx); // not the end of the turn: pi may still retry or continue
  pi.fire('agent_settled', { aborted: false }, piCtx);
  pi.fire('session_shutdown', { reason: 'quit' }, piCtx);
  // a broken context must not throw into pi
  assert.doesNotThrow(() => pi.fire('tool_execution_start', null, { sessionManager: { getSessionId: () => { throw new Error('x'); } } }));

  // an omp session that runs a subagent (omp's task tool, in the same process, with a session of its own)
  const omp = fakeHarness('omp');
  const mainCtx = ctxOf('omp-main');
  const subCtx = ctxOf('omp-sub', { file: '/sessions/omp-main/Explorer.jsonl', header: { type: 'session', id: 'omp-sub', parentSession: '/sessions/2026-11-24_omp-main.jsonl' } });
  omp.fire('session_start', {}, mainCtx);
  omp.fire('before_agent_start', { reason: 'prompt', prompt: 'map the repo', systemPrompt: [] }, mainCtx);
  omp.fire('tool_execution_start', { toolCallId: 'task-1', toolName: 'task', args: { agent: 'Explorer' } }, mainCtx);
  omp.fire('session_start', {}, subCtx);
  omp.fire('before_agent_start', { reason: 'prompt', prompt: 'list the modules', systemPrompt: [] }, subCtx);
  omp.fire('message_end', { message: reply({ responseId: 'sub-1', stopReason: 'stop', content: [{ type: 'text', text: 'Three modules.' }] }) }, subCtx);
  omp.fire('agent_end', { messages: [], willContinue: false }, subCtx);
  omp.fire('tool_execution_end', { toolCallId: 'task-1', toolName: 'task', result: { content: [{ type: 'text', text: 'Three modules.' }] }, isError: false }, mainCtx);
  omp.fire('agent_end', { messages: [], willContinue: false }, mainCtx); // the main session's turn ends with session_stop
  omp.fire('session_stop', { messages: [], turn_id: 1, session_id: 'omp-main', stop_hook_active: false }, mainCtx);

  server = spawn(process.execPath, [SERVER], { env: { ...process.env, OBSERVER_PORT: String(port) }, stdio: 'ignore' });
  await waitFor(async () => (await getJson('/api/health')).ok);
});

after(async () => {
  if (server) {
    const stopped = server.exitCode == null ? new Promise(resolve => server.once('exit', resolve)) : Promise.resolve();
    server.kill();
    await stopped;
  }
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.rmSync(AGENT_HOME, { recursive: true, force: true });
});

test('the extension subscribes once per harness and never blocks a tool', () => {
  assert.deepEqual(handlerResults, [undefined], 'one handler, returning nothing');
});

test('a pi session is served as pi, with its prompt, tools, failure and end', async () => {
  const session = await sessionById('pi-sess-1');
  assert.equal(session.agent, 'pi');
  assert.equal(session.title, 'fix the bug');
  assert.equal(session.cwd, '/work/app');
  assert.equal(session.model, 'claude-sonnet-4-5');
  assert.equal(session.toolCalls, 2);
  assert.equal(session.failures, 1);
  assert.equal(session.busy, false);
  assert.equal(session.ended, true);
  assert.equal(session.endReason, 'quit');
  assert.equal(session.parent, null);
  const events = await getJson('/api/events?session=pi-sess-1');
  assert.ok(events.every(event => event.agent === 'pi'));
  assert.equal(events.filter(event => event.event === 'Stop').length, 1, 'agent_end is not the end of the turn');
  const result = events.find(event => event.event === 'PostToolUse');
  assert.deepEqual([result.data.tool_name, result.data.tool_input, result.data.tool_response], ['bash', { command: 'ls' }, 'src\ntest']);
  assert.ok(result.duration_ms >= 0, 'timed from its PreToolUse');
  assert.equal(events.find(event => event.event === 'PostToolUseFailure').data.error, 'ENOENT: missing.ts');
});

test("pi's replies become model steps, with their tokens, tool calls and text", async () => {
  const events = await getJson('/api/events?session=pi-sess-1');
  const steps = events.filter(event => event.event === 'ModelStep');
  assert.equal(steps.length, 2);
  assert.equal(steps[0].category, 'model');
  assert.deepEqual(steps[0].data.tokens, { input: 1000, output: 50, cache_read: 9000, cache_write: 0, context: 10000 });
  assert.deepEqual([steps[0].data.tools, steps[0].data.tool_ids], [['bash'], ['call-1']]);
  assert.deepEqual(events.filter(event => event.event === 'ModelText').map(event => [event.data.kind, event.data.text]),
    [['thinking', 'List the folder first.'], ['text', 'Looking around.'], ['text', 'Fixed.']]);
  assert.equal(events.find(event => event.event === 'Stop').data.last_assistant_message, 'Fixed.');

  const session = await sessionById('pi-sess-1');
  assert.deepEqual([session.usage.input, session.usage.output, session.usage.cache_read, session.usage.turns], [2000, 100, 18000, 2]);
  assert.deepEqual([session.context.tokens, session.context.window], [10000, 200000], "the model's own context window");
  assert.equal(session.modelSteps, 2);
});

test('an omp subagent is a session of its own, nested under the session that ran it', async () => {
  const main = await sessionById('omp-main');
  const sub = await sessionById('omp-sub');
  assert.equal(main.agent, 'omp');
  assert.equal(sub.agent, 'omp');
  assert.equal(main.parent, null);
  assert.deepEqual([sub.parent?.id, sub.parent?.agent], ['omp-main', 'omp']);
  assert.equal(sub.title, 'list the modules');
  assert.equal(sub.busy, false, "agent_end ends a subagent's turn");
  const mainEvents = await getJson('/api/events?session=omp-main');
  assert.equal(mainEvents.filter(event => event.event === 'Stop').length, 1, "the main session's turn ends at session_stop only");
  assert.equal(main.busy, false);
});

test('pi and omp sessions say they have no Context view yet', async () => {
  const context = await getJson('/api/context?session=pi-sess-1');
  assert.match(context.error, /pi sessions have no Context view/);
});

test('what a pi session runs names it as its parent', () => {
  assert.equal(process.env.OBSERVER_PARENT_AGENT, 'omp', 'the latest main session in this process');
  assert.equal(process.env.OBSERVER_PARENT_SESSION, 'omp-main', 'not the subagent');
  const hook = require(path.join(ROOT, 'scripts', 'hook.js'));
  assert.deepEqual(hook.parentSessions('claude-child', { OBSERVER_PARENT_AGENT: 'pi', OBSERVER_PARENT_SESSION: 'pi-sess-1' }),
    [{ agent: 'pi', session_id: 'pi-sess-1' }]);
  assert.deepEqual(hook.parentSessions('x', { OBSERVER_PARENT_AGENT: 'other', OBSERVER_PARENT_SESSION: 'y' }), [], 'an unknown agent is no parent');
});

test('setup-pi.js installs a one-line loader for pi and omp, and removes only its own', async () => {
  const env = { ...process.env, PI_CODING_AGENT_DIR: path.join(AGENT_HOME, 'pi'), OMP_AGENT_DIR: path.join(AGENT_HOME, 'omp') };
  const run = (...args) => spawnSync(process.execPath, [SETUP, ...args], { env, encoding: 'utf8', timeout: 10000 });
  const piFile = path.join(AGENT_HOME, 'pi', 'extensions', 'session-observer.js');
  const ompFile = path.join(AGENT_HOME, 'omp', 'extensions', 'session-observer.js');

  assert.equal(run('pi', 'omp').status, 0);
  assert.match(fs.readFileSync(ompFile, 'utf8'), /\.forAgent\("omp"\);/);
  const loaded = await import(pathToFileURL(piFile).href);
  assert.equal(typeof loaded.default, 'function', "an ES module's default export: what pi and omp take as the extension");
  assert.equal(run('pi', 'omp').status, 0, 'running it again replaces its own files');

  assert.equal(run('--remove', 'pi').status, 0);
  assert.ok(!fs.existsSync(piFile));
  assert.ok(fs.existsSync(ompFile));

  fs.writeFileSync(piFile, 'module.exports = () => {};\n');
  assert.equal(run('pi').status, 1, "someone else's file is not overwritten");
  assert.equal(run('--remove', 'pi').status, 1);
  assert.equal(fs.readFileSync(piFile, 'utf8'), 'module.exports = () => {};\n');
  assert.equal(run('nope').status, 1);
});

test('setup-pi.js --data-dir makes the extension log there, unless OBSERVER_DATA_DIR says otherwise', () => {
  const env = { ...process.env, OMP_AGENT_DIR: path.join(AGENT_HOME, 'omp-data') };
  delete env.OBSERVER_DATA_DIR;
  const logDir = path.join(AGENT_HOME, 'logs');
  const installed = spawnSync(process.execPath, [SETUP, 'omp', '--data-dir', logDir], { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(installed.status, 0, installed.stderr);
  const file = path.join(AGENT_HOME, 'omp-data', 'extensions', 'session-observer.js');
  // what the agent's process sees once the extension is loaded
  const dataDirAfterLoad = extraEnv => spawnSync(process.execPath, ['--input-type=module', '-e',
    `await import(${JSON.stringify(pathToFileURL(file).href)}); console.log(process.env.OBSERVER_DATA_DIR);`],
    { env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 10000 }).stdout.trim();
  assert.equal(dataDirAfterLoad({}), logDir);
  assert.equal(dataDirAfterLoad({ OBSERVER_DATA_DIR: '/elsewhere' }), '/elsewhere');
  assert.equal(spawnSync(process.execPath, [SETUP, 'omp', '--data-dir'], { env, encoding: 'utf8', timeout: 10000 }).status, 1);
});
