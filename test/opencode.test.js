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
  assert.match(loaded[0].data.system_prompt_parts.join(''), /Always be brief/, 'the whole prompt, in parts the log keeps whole');
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

test('the plugin loader imports, and does nothing instead of failing when this copy has moved', async () => {
  const { loaderSource } = require('../server/lib/features/agents/opencode/setup');
  const { pathToFileURL } = require('node:url');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-opencode-loader-'));
  try {
    const write = (name, source) => { const file = path.join(dir, name); fs.writeFileSync(file, source); return pathToFileURL(file).href; };
    const real = await import(write('real.mjs', loaderSource()));
    assert.equal(typeof real.SessionObserver, 'function');
    const moved = await import(write('moved.mjs', loaderSource(path.join(dir, 'gone', 'plugin.js'))));
    assert.deepEqual(await moved.SessionObserver({}), {}, 'a plugin with no hooks');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
    assert.match(source, /SessionObserver = createOpencodePlugin\(\);/);
    assert.match(source, /export \{ SessionObserver \};/);
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

// ---- the Context view, from OpenCode's database (a copy built from fixtures/context-db.json)
const { opencodeSessionContext, databasePathOf } = require('../server/lib/features/agents/opencode/context');
const DB_ROWS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'features', 'agents', 'opencode', 'fixtures', 'context-db.json'), 'utf8'));
const PARENT = 'ses_de33d44e3ffeQJYNIZqP65DOAN', CHILD = 'ses_de33d4169ffeqrU9f7TyfNv5hk';
// node:sqlite is in Node 22.5 and later; on an older Node these tests are skipped and the view says why instead
const hasSqlite = (() => { try { require('node:sqlite'); return true; } catch { return false; } })();
const NEEDS_SQLITE = { skip: !hasSqlite && 'node:sqlite needs Node 22.5 or later' };

// OpenCode's tables, with only the columns the reader uses
function fixtureDatabase() {
  const { DatabaseSync } = require('node:sqlite');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-opencode-db-'));
  const file = path.join(dir, 'opencode.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, title TEXT, time_created INTEGER);'
    + 'CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);'
    + 'CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT);');
  for (const row of DB_ROWS.session) db.prepare('INSERT INTO session VALUES (?, ?, ?, ?)').run(row.id, row.parent_id, row.title, row.time_created);
  for (const row of DB_ROWS.message) db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run(row.id, row.session_id, row.time_created, row.data);
  for (const row of DB_ROWS.part) db.prepare('INSERT INTO part VALUES (?, ?, ?, ?)').run(row.id, row.message_id, row.session_id, row.data);
  db.close();
  return { dir, file };
}

const recordedSession = (id, file) => ({
  id, model: 'fake-model', context: { tokens: 1200, window: 64000 },
  events: [
    { event: 'SessionStart', data: { opencode_db: file } },
    { event: 'InstructionsLoaded', data: { file_path: 'system prompt', system_prompt_parts: ['You are opencode. ', 'Always be brief.'],
      tools: [{ name: 'bash', description: 'Runs a command.', schema: { type: 'object' } }], skills: [{ name: 'aspire', description: 'Router.' }],
      agents: [{ name: 'general', description: 'General agent' }] } },
  ],
});

test('the Context view reads the conversation from OpenCode\'s database, in the shape the view shows', NEEDS_SQLITE, () => {
  const { dir, file } = fixtureDatabase();
  try {
    const context = opencodeSessionContext(recordedSession(PARENT, file));
    assert.equal(context.error, undefined);
    assert.equal(context.agent, 'opencode');
    assert.equal(context.window, 64000);
    assert.equal(context.system, 'You are opencode. Always be brief.', 'the system prompt the plugin recorded');
    assert.deepEqual(context.tools, [{ name: 'bash', description: 'Runs a command.', schema: { type: 'object' } }], 'as sent to the model (tool.definition)');
    assert.deepEqual([context.skills, context.agents], [[{ name: 'aspire', description: 'Router.' }], [{ name: 'general', description: 'General agent' }]]);
    const kinds = context.items.map(item => item.kind);
    assert.deepEqual(kinds, ['user', 'step', 'call', 'result', 'step', 'text'], 'each step before what it produced');
    const call = context.items.find(item => item.kind === 'call');
    assert.deepEqual([call.name, call.id, call.input.subagent_type], ['task', 'call_task', 'general']);
    assert.deepEqual(context.items.find(item => item.kind === 'step'), { kind: 'step', ts: context.items[1].ts, model: 'fake-model', out: 30, ctx: 1200 });
    assert.match(context.items.at(-1).text, /spike-ok/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a subagent session shows under its parent, linked to the task call that started it', NEEDS_SQLITE, () => {
  const { dir, file } = fixtureDatabase();
  try {
    const { subagents } = opencodeSessionContext(recordedSession(PARENT, file));
    assert.deepEqual(Object.keys(subagents), [CHILD]);
    assert.deepEqual([subagents[CHILD].toolUseId, subagents[CHILD].type, subagents[CHILD].description], ['call_task', 'general', 'Child run']);
    const bash = subagents[CHILD].items.find(item => item.kind === 'call');
    assert.deepEqual([bash.name, bash.input.command], ['bash', 'echo spike-ok']);
    assert.match(subagents[CHILD].items.find(item => item.kind === 'result').text, /spike-ok/, 'the full tool output');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing database or session says so instead of failing', NEEDS_SQLITE, () => {
  assert.match(opencodeSessionContext(recordedSession(PARENT, path.join(os.tmpdir(), 'no-such-dir', 'opencode.db'))).error, /not found/);
  const { dir, file } = fixtureDatabase();
  try {
    assert.match(opencodeSessionContext(recordedSession('ses_unknown', file)).error, /not in the OpenCode database/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('on a Node without node:sqlite, the Context view says which Node it needs', { skip: hasSqlite && 'this Node has node:sqlite' }, () => {
  assert.match(opencodeSessionContext(recordedSession(PARENT, path.join(os.tmpdir(), 'opencode.db'))).error, /needs Node 22\.5 or later/);
});

test("the database is the one the plugin recorded, unless OBSERVER_OPENCODE_DB says otherwise", () => {
  const session = recordedSession(PARENT, '/data/opencode/opencode.db');
  assert.equal(databasePathOf(session, {}), '/data/opencode/opencode.db');
  assert.equal(databasePathOf(session, { OBSERVER_OPENCODE_DB: '/elsewhere.db' }), '/elsewhere.db');
  assert.equal(databasePathOf({ events: [] }, { XDG_DATA_HOME: '/xdg' }), path.join('/xdg', 'opencode', 'opencode.db'));
});

// ---- instruction files (AGENTS.md, CLAUDE.md, …), which OpenCode puts in the system prompt
const { instructionFilesOf } = require('../server/lib/features/agents/opencode/translate');
const SYSTEM_WITH_FILES = [
  'You are opencode.', '<env>', '  Working directory: /work/app', '</env>',
  'Instructions from: /work/app/AGENTS.md', '# App', 'Always be brief.', '',
  'Instructions from: /home/me/.config/opencode/AGENTS.md', 'Use tabs.',
  'Skills provide specialized instructions and workflows for specific tasks.', '<available_skills>', '</available_skills>',
].join('\n');

test("the instruction files in OpenCode's system prompt are found, each with its own content", () => {
  assert.deepEqual(instructionFilesOf(SYSTEM_WITH_FILES), [
    { path: '/work/app/AGENTS.md', content: '# App\nAlways be brief.' },
    { path: '/home/me/.config/opencode/AGENTS.md', content: 'Use tabs.' },
  ]);
  assert.deepEqual(instructionFilesOf('You are opencode.\nNo files here.'), []);
});

test('each instruction file is recorded on its own, and the Context view lists them', NEEDS_SQLITE, () => {
  const { translate, events } = translator();
  translate.systemTransform({ sessionID: 's1' }, { system: [SYSTEM_WITH_FILES] });
  translate.chatParams({ sessionID: 's1', agent: 'build', model: { id: 'm', limit: { context: 64000 } } });
  const files = events.filter(event => event.event === 'InstructionsLoaded' && event.data.from === 'system prompt');
  assert.deepEqual(files.map(event => event.data.file_path), ['/work/app/AGENTS.md', '/home/me/.config/opencode/AGENTS.md']);
  for (const event of files) assert.deepEqual(eventProblems(event), []);

  const { dir, file } = fixtureDatabase();
  try {
    const context = opencodeSessionContext({ ...recordedSession(PARENT, file), cwd: '/work/app', events: [{ event: 'SessionStart', data: { opencode_db: file } }, ...events] });
    assert.deepEqual(context.instructions, [
      { path: '/work/app/AGENTS.md', type: 'Project', content: '# App\nAlways be brief.' },
      { path: '/home/me/.config/opencode/AGENTS.md', type: null, content: 'Use tabs.' },
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tool definitions, skills and subagent types are recorded with the system prompt, and older recordings still read', NEEDS_SQLITE, () => {
  const { translate, events } = translator();
  translate.toolDefinition({ toolID: 'bash' }, { description: 'Runs a command.', parameters: { type: 'object' } });
  const taskDescription = ['Launch a subagent.', 'Available agent types:', '- general: General agent', '- explore: Fast search'].join('\n');
  translate.toolDefinition({ toolID: 'task' }, { description: taskDescription, parameters: {} });
  const system = ['You are opencode.', '<available_skills>', '<skill>', '<name>aspire</name>', '<description>Router.</description>', '</skill>', '</available_skills>'].join('\n');
  translate.systemTransform({ sessionID: 's1' }, { system: [system] });
  translate.chatParams({ sessionID: 's1', agent: 'build', model: { id: 'm', limit: { context: 64000 } } });
  const prompt = events.find(event => event.data.file_path === 'system prompt');
  assert.deepEqual(prompt.data.tools.map(tool => tool.name), ['bash', 'task']);
  assert.deepEqual(prompt.data.skills, [{ name: 'aspire', description: 'Router.', location: null }]);
  assert.deepEqual(prompt.data.agents.map(agent => agent.name), ['general', 'explore']);
  assert.deepEqual(eventProblems(prompt), []);

  const { dir, file } = fixtureDatabase();
  try {
    const old = opencodeSessionContext({ id: PARENT, events: [{ event: 'SessionStart', data: { opencode_db: file } }, { event: 'InstructionsLoaded', data: { file_path: 'system prompt', system_prompt: 'Recorded in one field.' } }] }, () => null);
    assert.equal(old.system, 'Recorded in one field.');
    assert.deepEqual(old.tools, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a reasoning part becomes the model's thinking, once, when it ends", () => {
  const { translate, events } = translator();
  translate.event(part({ id: 'r1', type: 'reasoning', text: 'Let me think.', time: { start: 1 } }));
  translate.event(part({ id: 'r1', type: 'reasoning', text: 'Let me think.', time: { start: 1, end: 2 } }));
  translate.event(part({ id: 'r1', type: 'reasoning', text: 'Let me think.', time: { start: 1, end: 2 } }));
  assert.deepEqual(events.map(event => [event.event, event.data.kind, event.data.text]), [['ModelText', 'thinking', 'Let me think.']]);
});

test("a subagent's own recorded prompt and tools show under it", NEEDS_SQLITE, () => {
  const { dir, file } = fixtureDatabase();
  try {
    const child = { id: CHILD, events: [{ event: 'InstructionsLoaded', data: { file_path: 'system prompt', system_prompt_parts: ['Child prompt.'], tools: [{ name: 'bash', description: '', schema: null }] } }] };
    const { subagents } = opencodeSessionContext(recordedSession(PARENT, file), id => (id === CHILD ? child : null));
    assert.equal(subagents[CHILD].system, 'Child prompt.');
    assert.deepEqual(subagents[CHILD].tools.map(tool => tool.name), ['bash']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
