// End-to-end smoke test: feed hook payloads through scripts/hook.js into a temp
// log, start server/server.js on a free port, and check the HTTP API sees them.
// Zero dependencies — run with `node --test test/smoke.test.js`.
'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { freePort, waitFor, stopProcess } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const HOOK = path.join(ROOT, 'scripts', 'hook.js');
const STATUSLINE = path.join(ROOT, 'scripts', 'claude-statusline.js');
const SERVER = path.join(ROOT, 'server', 'server.js');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'so-test-'));
const SESSION_LOGS = path.join(DATA_DIR, 'sessions');
let PORT, server, base;

const env = () => ({ ...process.env, OBSERVER_DATA_DIR: DATA_DIR, OBSERVER_PORT: String(PORT), OBSERVER_AUTOSTART: '0' });

function runHook(eventName, payload, extraEnv = {}) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return spawnSync(process.execPath, [HOOK, eventName], { input, env: { ...env(), ...extraEnv }, timeout: 10000 });
}

const get = async p => { const r = await fetch(base + p); return { status: r.status, body: await r.text(), type: r.headers.get('content-type') }; };
const getJson = async p => JSON.parse((await get(p)).body);
// every session file of every day folder
const sessionLogFiles = () => fs.readdirSync(SESSION_LOGS).filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day))
  .flatMap(day => fs.readdirSync(path.join(SESSION_LOGS, day)).filter(name => /^[a-f0-9]{64}[.]jsonl$/.test(name)).map(name => path.join(SESSION_LOGS, day, name)));
const readLog = () => sessionLogFiles()
  .flatMap(file => fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)))
  .sort((a, b) => a.ts.localeCompare(b.ts));

async function startServer() {
  server = spawn(process.execPath, [SERVER], { env: env(), stdio: 'ignore' });
  await waitFor(async () => (await getJson('/api/health')).ok);
}

const stopServer = () => stopProcess(server);

before(async () => {
  PORT = await freePort();
  base = `http://127.0.0.1:${PORT}`;
  await startServer();
});

after(async () => {
  await stopServer();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('hook appends one JSON line per event', () => {
  const r = runHook('SessionStart', { hook_event_name: 'SessionStart', session_id: 'sess-1', cwd: '/tmp/proj', source: 'startup' });
  assert.equal(r.status, 0);
  const evs = readLog();
  assert.equal(evs.length, 1);
  assert.equal(evs[0].event, 'SessionStart');
  assert.equal(evs[0].session_id, 'sess-1');
  assert.ok(!Number.isNaN(Date.parse(evs[0].ts)));
});

test('hook never fails on bad input', () => {
  const r = runHook('Notification', 'this is not json');
  assert.equal(r.status, 0);
  const last = readLog().at(-1);
  assert.equal(last.event, 'Notification');
  assert.equal(last.session_id, 'unknown');
  assert.equal(last.data.raw, 'this is not json');
});

test('hook truncates long strings', () => {
  runHook('PostToolUse', { hook_event_name: 'PostToolUse', session_id: 'sess-1', tool_name: 'Read', tool_response: 'x'.repeat(500) }, { OBSERVER_MAX_FIELD: '50' });
  const last = readLog().at(-1);
  assert.ok(last.data.tool_response.length < 100, 'long field should be cut');
  assert.match(last.data.tool_response, /\[\+450 chars]$/);
});

test('server ingests hook events and serves the API', async () => {
  runHook('UserPromptSubmit', { hook_event_name: 'UserPromptSubmit', session_id: 'sess-1', prompt: 'hello' });
  runHook('PreToolUse', { hook_event_name: 'PreToolUse', session_id: 'sess-1', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 't1' });
  runHook('PostToolUse', { hook_event_name: 'PostToolUse', session_id: 'sess-1', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 't1', tool_response: 'ok' });

  const sess = await waitFor(async () => {
    const list = await getJson('/api/sessions');
    const s = list.find(x => x.id === 'sess-1');
    return s && s.eventCount >= 5 ? s : null;
  });
  assert.equal(sess.cwd, '/tmp/proj');

  const events = await getJson('/api/events?session=sess-1');
  assert.ok(Array.isArray(events));
  assert.ok(events.some(e => e.event === 'UserPromptSubmit'));
  assert.ok(Array.isArray(await getJson('/api/events?session=all')));
  assert.equal((await get('/api/events?session=nope')).status, 404);
  assert.equal((await get('/api/nope')).status, 404);
});

test('the server reports its version: in the health check and first on the live stream', async () => {
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal((await getJson('/api/health')).version, version);
  const ac = new AbortController();
  const r = await fetch(base + '/api/stream', { signal: ac.signal });
  const reader = r.body.getReader(); let text = '';
  while (!text.includes('event: hello')) { const { value, done } = await reader.read(); if (done) break; text += Buffer.from(value).toString(); }
  ac.abort();
  assert.match(text, /event: hello\ndata: (.+)\n/);
  assert.equal(JSON.parse(/event: hello\ndata: (.+)\n/.exec(text)[1]).version, version);
});

test('the agents the dashboard draws come from the server', async () => {
  const agents = await getJson('/api/agents');
  assert.deepEqual(agents.map(agent => agent.id), ['claude', 'codex']);
  assert.equal(agents[1].name, 'Codex');
  assert.ok(agents[1].tools.roles.patch.includes('apply_patch'));
});

test('dashboard HTML is served', async () => {
  const r = await get('/');
  assert.equal(r.status, 200);
  assert.match(r.type, /text\/html/);
  assert.match(r.body, /<html/i);
  assert.match(r.body, /<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,/, 'the tab icon is inline, so the server needs no route for it');
});

test('every stylesheet and script the dashboard asks for is served', async () => {
  const html = (await get('/')).body;
  const refs = [...html.matchAll(/<(?:script[^>]* src|link[^>]* href)="([^"]+)"/g)].map(m => m[1]).filter(r => !r.startsWith('data:'));
  assert.ok(refs.length > 1, 'the dashboard should load its files from dashboard/');
  for (const ref of refs) {
    const r = await get('/' + ref);
    assert.equal(r.status, 200, ref);
    assert.match(r.type, ref.endsWith('.css') ? /text\/css/ : /javascript/, ref);
    assert.ok(r.body.length > 0, ref);
  }
});

test('nothing else is served from the dashboard folder', async () => {
  for (const p of ['/dashboard/nope.js', '/dashboard/', '/dashboard/..%2Fserver.js', '/dashboard/%2e%2e/server.js', '/dashboard/sub/core.js', '/dashboard/core.js.map', '/server.js',
    '/dashboard/features/..%2F..%2Fserver.js', '/dashboard/features/%2e%2e/%2e%2e/server.js', '/dashboard//app.js', '/dashboard/features/.js']) {
    assert.equal((await get(p)).status, 404, p);
  }
});

test('Claude status line corrects the context window for its session and model without adding activity', async () => {
  const id = 'observed-context', tp = path.join(DATA_DIR, 'observed-transcript.jsonl');
  const model = 'claude-opus-5-5';
  runHook('SessionStart', { session_id: id, cwd: '/tmp/proj', transcript_path: tp });
  const assistant = {
    type: 'assistant', timestamp: new Date().toISOString(),
    message: { role: 'assistant', id: 'observed-reply', model, usage: { input_tokens: 1000, cache_read_input_tokens: 128000, output_tokens: 400 },
      content: [{ type: 'text', text: 'OK' }] },
  };
  fs.writeFileSync(tp, JSON.stringify(assistant) + '\n');
  const summary = async () => (await getJson('/api/sessions')).find(session => session.id === id);
  const estimated = await waitFor(async () => { const session = await summary(); return session?.context && session; });
  assert.equal(Math.round(estimated.context.pct * 100), 65);

  const sendWindow = (session_id, modelId, window) => {
    const input = JSON.stringify({ session_id, model: { id: modelId }, cwd: '/tmp/private', context_window: { context_window_size: window } }) + '\n';
    const result = spawnSync(process.execPath, [STATUSLINE], { input, env: env(), encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, input);
  };
  sendWindow('no-hook-session', model, 1000000);
  sendWindow(id, 'claude-sonnet-5-5', 1000000);
  await waitFor(async () => (await summary()).observedContext?.model === 'claude-sonnet-5-5');
  assert.equal((await summary()).context.window, 200000);
  assert.ok(!(await getJson('/api/sessions')).some(session => session.id === 'no-hook-session'));

  sendWindow(id, model, 1000000);
  const corrected = await waitFor(async () => { const session = await summary(); return session.context.window === 1000000 && session; });
  assert.equal(corrected.context.tokens, 129000);
  assert.equal(Math.round(corrected.context.pct * 100), 13);
  assert.equal(corrected.eventCount, estimated.eventCount);
  assert.equal(corrected.last, estimated.last);
  assert.equal((await getJson('/api/context?session=' + id)).window, 1000000);

  sendWindow(id, model, 0);
  const files = fs.readdirSync(path.join(DATA_DIR, 'context-windows'));
  const samples = files.map(file => JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'context-windows', file), 'utf8')));
  assert.deepEqual(samples, [{ model, window: 1000000 }, { model, window: 1000000 }]);
  const response = await fetch(base + '/api/sessions/' + id, { method: 'DELETE', headers: { Origin: base } });
  assert.equal(response.status, 200);
  assert.equal(fs.readdirSync(path.join(DATA_DIR, 'context-windows')).length, 1);
});

test('context: the whole transcript, in full, with subagents and the request shape', async () => {
  const tp = path.join(DATA_DIR, 'ctx-sess.jsonl'), subDir = path.join(DATA_DIR, 'ctx-sess', 'subagents');
  fs.mkdirSync(subDir, { recursive: true });
  const big = 'x'.repeat(20000); // longer than the hook log keeps (OBSERVER_MAX_FIELD 8000)
  const usage = { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, output_tokens: 50 };
  const rows = [
    { type: 'api-request-shape', shape: { system: [{ type: 'text', text: 'You are a test.' }], tools: [{ name: 'Bash', description: 'Run a command', input_schema: { type: 'object' } }] } },
    { type: 'attachment', timestamp: '2026-01-01T00:00:00Z', attachment: { type: 'instructions', files: [{ path: '/home/me/.claude/CLAUDE.md', type: 'User', content: 'Be brief.' }, { path: '/tmp/proj/AGENTS.md', type: 'Project', content: 'Run npm test.' }] } },
    { type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: 'run the tests' } },
    { type: 'assistant', timestamp: '2026-01-01T00:00:01Z', message: { id: 'm1', role: 'assistant', model: 'claude-test', usage, content: [{ type: 'thinking', thinking: 'plan' }] } },
    { type: 'assistant', timestamp: '2026-01-01T00:00:01Z', message: { id: 'm1', role: 'assistant', model: 'claude-test', usage, content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'npm test' } }] } },
    { type: 'user', timestamp: '2026-01-01T00:00:02Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: big }] } },
    { type: 'assistant', timestamp: '2026-01-01T00:00:03Z', message: { id: 'm2', role: 'assistant', usage, content: [{ type: 'tool_use', id: 'tu2', name: 'Agent', input: { subagent_type: 'Explore', prompt: 'look' } }] } },
    { type: 'user', timestamp: '2026-01-01T00:00:04Z', toolUseResult: { agentId: 'a1' }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu2', content: [{ type: 'text', text: 'found it' }] }] } },
    { type: 'attachment', timestamp: '2026-01-01T00:00:05Z', attachment: { type: 'hook_success', hookName: 'SessionStart:startup', content: 'hello from a hook' } },
    { type: 'system', subtype: 'compact_boundary', timestamp: '2026-01-01T00:00:06Z', compactMetadata: { trigger: 'auto', preTokens: 150000 } },
    { type: 'user', timestamp: '2026-01-01T00:00:06Z', isCompactSummary: true, message: { role: 'user', content: 'Summary of before' } },
    { type: 'assistant', timestamp: '2026-01-01T00:00:07Z', message: { id: 'm3', role: 'assistant', usage, content: [{ type: 'text', text: 'All green.' }] } },
  ];
  // listings: skills (plugin names hold a colon), subagent types, deferred tools; they are pinned, not counted as items
  const listings = [
    { type: 'attachment', attachment: { type: 'skill_listing', isInitial: true, names: ['tidy', 'obs:dashboard'], content: '- tidy: Tidy up\n  across two lines\n- obs:dashboard: Open the dashboard' } },
    { type: 'attachment', attachment: { type: 'agent_listing_delta', isInitial: true, addedTypes: ['Explore', 'Plan'], addedLines: ['- Explore: Search', '- Plan: Design'], removedTypes: [] } },
    { type: 'attachment', attachment: { type: 'agent_listing_delta', addedTypes: [], removedTypes: ['Plan'] } },
    { type: 'attachment', attachment: { type: 'deferred_tools_delta', addedNames: ['WebFetch', 'Monitor'], removedNames: [], surfacedNames: ['Monitor'], failedMcpServers: [{ name: 'down', error: 'ECONNREFUSED' }] } },
    { type: 'attachment', attachment: { type: 'mcp_instructions_delta', addedNames: ['docs'], addedBlocks: ['## docs\nUse the docs tools.'] } },
    { type: 'attachment', attachment: { type: 'prompt_snapshot', systemPrompt: ['You are a test.'] } }, // bookkeeping: never sent
    { type: 'attachment', attachment: { type: 'date', date: '2026-01-01' } }, // sent as text made from data
  ];
  rows.splice(2, 0, ...listings);
  // the requests as sent: the first one is stored in full; the second keeps those two messages and adds the reply and the
  // tool result, which are not stored as blobs and come back from the transcript
  rows.unshift(
    { type: 'api-request-blob', hash: 'h1', message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>\nBe brief.\n</system-reminder>' }, { type: 'text', text: 'run the tests' }] } },
    { type: 'api-request-blob', hash: 'h2', message: { role: 'system', content: [{ type: 'text', text: 'hook said hi' }, { type: 'tool_addition', tool: { type: 'tool_definition', definition: { name: 'Monitor', description: 'Watch', input_schema: { type: 'object' } } } }] } },
    { type: 'api-request', timestamp: '2026-01-01T00:00:00.500Z', querySource: 'repl_main_thread', keep: 0, tail: ['h1', 'h2'], params: { model: 'claude-test', context_management: { edits: [{ type: 'clear_thinking_20251015' }] } } },
    { type: 'api-request', timestamp: '2026-01-01T00:00:02.500Z', querySource: 'repl_main_thread', keep: 2, tail: ['h3', 'h4'], params: { model: 'claude-test' } },
  );
  fs.writeFileSync(tp, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(subDir, 'agent-a1.jsonl'), JSON.stringify({ type: 'api-request-shape', shape: { system: [{ type: 'text', text: 'You are the reviewer agent.' }], tools: [] } }) + '\n' + JSON.stringify({ type: 'assistant', isSidechain: true, message: { id: 's1', role: 'assistant', usage, content: [{ type: 'text', text: 'searching' }] } }) + '\n');
  fs.writeFileSync(path.join(subDir, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'look around', toolUseId: 'tu2' }));
  runHook('SessionStart', { hook_event_name: 'SessionStart', session_id: 'sess-ctx', cwd: '/tmp/proj', transcript_path: tp });

  const d = await waitFor(async () => { const r = await get('/api/context?session=sess-ctx'); return r.status === 200 && JSON.parse(r.body); });
  assert.equal(d.system, 'You are a test.');
  assert.deepEqual(d.tools.map(t => t.name), ['Bash']);
  const kinds = d.items.map(i => i.kind);
  assert.deepEqual(kinds, ['attachment', 'attachment', 'attachment', 'attachment', 'attachment', 'attachment', 'attachment', 'attachment', 'user','step', 'thinking', 'call', 'result', 'step', 'call', 'result', 'attachment', 'compact', 'summary', 'step', 'text']);
  const result = d.items.find(i => i.kind === 'result' && i.id === 'tu1');
  assert.equal(result.text.length, 20000, 'tool results are not cut at the hook log limit');
  assert.equal(d.items.find(i => i.kind === 'step').ctx, 1010);
  assert.equal(d.items.find(i => i.kind === 'compact').preTokens, 150000);
  assert.deepEqual(d.instructions.map(f => [f.path, f.type, f.content]), [['/home/me/.claude/CLAUDE.md', 'User', 'Be brief.'], ['/tmp/proj/AGENTS.md', 'Project', 'Run npm test.']]);
  assert.match(d.items[0].text, /Contents of \/tmp\/proj\/AGENTS\.md \(Project\):\s+Run npm test\./);
  assert.deepEqual(d.skills, [{ name: 'tidy', description: 'Tidy up\n  across two lines' }, { name: 'obs:dashboard', description: 'Open the dashboard' }]);
  assert.deepEqual(d.agents, [{ name: 'Explore', description: 'Search' }]);
  assert.deepEqual(d.deferred, { tools: [{ name: 'WebFetch', loaded: false }, { name: 'Monitor', loaded: true }], failedMcp: [{ name: 'down', error: 'ECONNREFUSED' }] });
  assert.deepEqual(d.mcp, [{ name: 'docs', description: '## docs\nUse the docs tools.' }]);
  // attachments: sent, pinned on top, or bookkeeping; data-only ones are turned into readable text
  const att = d.items.filter(i => i.kind === 'attachment');
  assert.deepEqual(att.map(i => [i.type, i.role]), [['instructions', 'pinned'], ['skill_listing', 'pinned'], ['agent_listing_delta', 'pinned'], ['agent_listing_delta', 'pinned'],
    ['deferred_tools_delta', 'pinned'], ['mcp_instructions_delta', 'pinned'], ['prompt_snapshot', 'meta'], ['date', 'sent'], ['hook_success', 'sent']]);
  assert.equal(att.find(i => i.type === 'date').text, "Today's date is 2026-01-01.");
  assert.equal(att.find(i => i.type === 'hook_success').text, 'SessionStart:startup hook success: hello from a hook');
  // as sent: two stored messages, then the reply and the tool result rebuilt from the transcript
  assert.deepEqual(d.wire.messages.map(m => [m.role, m.recorded]), [['user', true], ['system', true], ['assistant', false], ['user', false]]);
  assert.deepEqual(d.wire.messages[1].blocks.map(b => b.type), ['text', 'tool_addition']);
  assert.equal(d.wire.messages[1].blocks[1].name, 'Monitor');
  assert.deepEqual(d.wire.messages[2].blocks.map(b => b.type), ['thinking', 'tool_use']);
  assert.equal(d.wire.messages[3].blocks[0].id, 'tu1');
  assert.equal(d.wire.messages[3].blocks[0].text.length, 20000);
  assert.deepEqual(d.wire.edits, []);
  assert.equal(d.wire.requests, 2);
  assert.equal(d.measured.firstCtx, 1010);
  assert.equal(d.subagents.a1.toolUseId, 'tu2');
  assert.equal(d.subagents.a1.system, 'You are the reviewer agent.', "a subagent's own system prompt (a custom agent's .md body)");
  assert.equal(d.subagents.a1.items.find(i => i.kind === 'text').text, 'searching');
  assert.equal((await get('/api/context?session=nope')).status, 404);
});

// ---- Home: what a session waits on you for, and its subagents
const WAIT_SESSION = 'sess-wait';
const waitHook = (eventName, fields) => runHook(eventName, { hook_event_name: eventName, session_id: WAIT_SESSION, cwd: '/tmp/waits', ...fields });
const waitingSession = () => getJson('/api/sessions').then(list => list.find(session => session.id === WAIT_SESSION));
const waitsAre = expected => waitFor(async () => {
  const session = await waitingSession();
  return session && JSON.stringify(session.needsYou.map(wait => wait.kind)) === JSON.stringify(expected) && session;
});

test('a session tracks what it waits on you for, until it is answered', async () => {
  waitHook('UserPromptSubmit', { prompt: 'deploy it' });
  waitHook('PreToolUse', { tool_name: 'AskUserQuestion', tool_use_id: 'q1', tool_input: { questions: [{ question: 'Which region?' }] } });
  // Claude Code asks permission for the question tool too: still one wait
  waitHook('PermissionRequest', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Which region?' }] } });
  waitHook('Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission' });
  let session = await waitsAre(['question']);
  assert.equal(session.needsYou[0].text, 'Which region?');

  waitHook('PostToolUse', { tool_name: 'AskUserQuestion', tool_use_id: 'q1', tool_response: { answers: { 'Which region?': 'eu' } } });
  await waitsAre([]);

  waitHook('PreToolUse', { tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'rm -rf build' } });
  waitHook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' } });
  waitHook('Elicitation', { server_name: 'docs', message: 'Pick a space' });
  session = await waitsAre(['permission', 'mcp']);
  assert.deepEqual([session.needsYou[0].tool, session.needsYou[0].text], ['Bash', 'rm -rf build']);

  waitHook('PostToolUse', { tool_name: 'Bash', tool_use_id: 'b1', tool_response: 'ok' });
  await waitsAre(['mcp']);
  waitHook('ElicitationResult', { server_name: 'docs', action: 'accept' });
  await waitsAre([]);

  waitHook('PermissionRequest', { tool_name: 'Write', tool_input: { file_path: '/tmp/a' } });
  await waitsAre(['permission']);
  waitHook('Stop', {});
  await waitsAre([]);
});

test('a call refused at its prompt, or an interrupt, ends its wait though no hook comes', async () => {
  const id = 'sess-refused', tp = path.join(DATA_DIR, 'refused.jsonl');
  const hook = (eventName, fields) => runHook(eventName, { hook_event_name: eventName, session_id: id, cwd: '/tmp/waits', transcript_path: tp, ...fields });
  const waits = expected => waitFor(async () => {
    const session = (await getJson('/api/sessions')).find(s => s.id === id);
    return session && JSON.stringify(session.needsYou.map(wait => wait.kind)) === JSON.stringify(expected);
  });
  const writeTranscript = rows => fs.appendFileSync(tp, rows.map(row => JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), ...row }) + '\n').join(''));
  fs.writeFileSync(tp, '');
  hook('UserPromptSubmit', { prompt: 'ask me' });
  hook('PreToolUse', { tool_name: 'AskUserQuestion', tool_use_id: 'rq1', tool_input: { questions: [{ question: 'Tabs or spaces?' }] } });
  hook('PermissionRequest', { tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Tabs or spaces?' }] } });
  await waits(['question']);
  // you decline: Claude Code writes the refusal and the interrupt to the transcript, and sends no hook
  writeTranscript([
    { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'rq1', is_error: true, content: "The user doesn't want to proceed with this tool use." }] } },
    { message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } },
  ]);
  await waits([]);
  // and the interrupt ends the turn: no Stop comes, so the call no longer runs and the session is not busy
  const ended = await waitFor(async () => {
    const session = (await getJson('/api/sessions')).find(s => s.id === id);
    return session && !session.busy && session.running === 0 && session;
  });
  assert.equal(ended.busy, false);
  const interrupts = (await getJson('/api/events?session=' + id)).filter(event => event.event === 'Interrupt');
  assert.equal(interrupts.length, 1);

  hook('UserPromptSubmit', { prompt: 'clean up' });
  hook('PreToolUse', { tool_name: 'Bash', tool_use_id: 'rb1', tool_input: { command: 'rm -rf build' } });
  hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' } });
  await waits(['permission']);
  // refused with a note for Claude: only the tool result, no interrupt
  writeTranscript([{ message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'rb1', is_error: true, content: "The user doesn't want to proceed with this tool use." }] } }]);
  await waits([]);
});

test("a session lists its subagents: each one's type, task and whether it still runs", async () => {
  waitHook('UserPromptSubmit', { prompt: 'look around' });
  waitHook('PreToolUse', { tool_name: 'Agent', tool_use_id: 'a1', tool_input: { description: 'Find the config', subagent_type: 'Explore' } });
  waitHook('SubagentStart', { agent_id: 'sub-1', agent_type: 'Explore' });
  const running = await waitFor(async () => (await waitingSession())?.subagentList.find(subagent => subagent.id === 'sub-1'));
  assert.deepEqual([running.type, running.description, running.ended], ['Explore', 'Find the config', null]);

  waitHook('SubagentStop', { agent_id: 'sub-1', agent_type: 'Explore' });
  await waitFor(async () => (await waitingSession())?.subagentList.find(subagent => subagent.id === 'sub-1').ended);
});

test('a permission asked without a call id waits for its own call, not for a call run beside it', async () => {
  const id = 'sess-parallel';
  const hook = (eventName, fields) => runHook(eventName, { hook_event_name: eventName, session_id: id, cwd: '/tmp/waits', ...fields });
  const waits = expected => waitFor(async () => {
    const session = (await getJson('/api/sessions')).find(s => s.id === id);
    return session && JSON.stringify(session.needsYou.map(wait => wait.tool)) === JSON.stringify(expected) && session;
  });
  hook('UserPromptSubmit', { prompt: 'read and clean' });
  hook('PreToolUse', { tool_name: 'Read', tool_use_id: 'p-read', tool_input: { file_path: '/tmp/a' } });
  hook('PreToolUse', { tool_name: 'Bash', tool_use_id: 'p-bash', tool_input: { command: 'rm -rf build' } });
  hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf build' } });
  await waits(['Bash']);
  // the Read run beside it finishes: the permission still waits
  hook('PostToolUse', { tool_name: 'Read', tool_use_id: 'p-read', tool_input: { file_path: '/tmp/a' }, tool_response: 'text' });
  await waitFor(async () => (await getJson('/api/sessions')).find(s => s.id === id)?.running === 1);
  await waits(['Bash']);
  hook('PostToolUse', { tool_name: 'Bash', tool_use_id: 'p-bash', tool_input: { command: 'rm -rf build' }, tool_response: 'ok' });
  await waits([]);

  // two permissions with no call to tie them to: each ends with a result of its own tool and input
  hook('PermissionRequest', { tool_name: 'Write', tool_input: { file_path: '/tmp/b' } });
  hook('PermissionRequest', { tool_name: 'Write', tool_input: { file_path: '/tmp/c' } });
  await waits(['Write', 'Write']);
  hook('PostToolUse', { tool_name: 'Write', tool_use_id: 'p-write-b', tool_input: { file_path: '/tmp/b' }, tool_response: 'ok' });
  const left = await waits(['Write']);
  assert.equal(left.needsYou[0].text, '/tmp/c');
  hook('Stop', {});
  await waits([]);
});

test('a background subagent goes on after its turn stops, until its own SubagentStop', async () => {
  waitHook('UserPromptSubmit', { prompt: 'watch the build' });
  waitHook('PreToolUse', { tool_name: 'Agent', tool_use_id: 'bg1', tool_input: { description: 'Watch CI', subagent_type: 'general-purpose', run_in_background: true } });
  waitHook('SubagentStart', { agent_id: 'sub-bg', agent_type: 'general-purpose' });
  waitHook('PreToolUse', { tool_name: 'Agent', tool_use_id: 'fg1', tool_input: { description: 'Read the log', subagent_type: 'Explore' } });
  waitHook('SubagentStart', { agent_id: 'sub-fg', agent_type: 'Explore' });
  waitHook('Stop', {});
  const subagentsOf = async () => (await waitingSession())?.subagentList || [];
  const afterStop = await waitFor(async () => {
    const list = await subagentsOf();
    return list.find(subagent => subagent.id === 'sub-fg')?.ended && list;
  });
  assert.deepEqual(afterStop.find(subagent => subagent.id === 'sub-bg').ended, null, 'the background agent still runs');
  waitHook('SubagentStop', { agent_id: 'sub-bg', agent_type: 'general-purpose' });
  await waitFor(async () => (await subagentsOf()).find(subagent => subagent.id === 'sub-bg').ended);
});

test('a subagent whose call returns while it runs is a background one, without run_in_background', async () => {
  const id = 'sess-async';
  const hook = (eventName, fields) => runHook(eventName, { hook_event_name: eventName, session_id: id, cwd: '/tmp/waits', ...fields });
  const subagent = async agentId => (await getJson('/api/sessions')).find(s => s.id === id)?.subagentList.find(s => s.id === agentId);
  // as a real session logged it: the call returns 25ms after SubagentStart, the turn stops, the agent ends a minute later
  hook('UserPromptSubmit', { prompt: 'wait a minute' });
  hook('PreToolUse', { tool_name: 'Agent', tool_use_id: 'as-call', tool_input: { description: 'Wait 60s and report', subagent_type: 'general-purpose', prompt: 'sleep' } });
  hook('SubagentStart', { agent_id: 'as-sub', agent_type: 'general-purpose' });
  hook('PostToolUse', { tool_name: 'Agent', tool_use_id: 'as-call', tool_input: { description: 'Wait 60s and report', subagent_type: 'general-purpose', prompt: 'sleep' }, tool_response: 'launched' });
  // and when the call's result lands before the SubagentStart
  hook('PreToolUse', { tool_name: 'Agent', tool_use_id: 'as-call-2', tool_input: { description: 'Watch the build', subagent_type: 'Explore' } });
  hook('PostToolUse', { tool_name: 'Agent', tool_use_id: 'as-call-2', tool_input: { description: 'Watch the build', subagent_type: 'Explore' }, tool_response: 'launched' });
  hook('SubagentStart', { agent_id: 'as-sub-2', agent_type: 'Explore' });
  hook('Stop', {});
  await waitFor(async () => (await getJson('/api/sessions')).find(s => s.id === id)?.busy === false);
  for (const agentId of ['as-sub', 'as-sub-2']) {
    const running = await subagent(agentId);
    assert.deepEqual([running.background, running.ended], [true, null], `${agentId} still runs after the Stop`);
  }
  hook('SubagentStop', { agent_id: 'as-sub', agent_type: 'general-purpose' });
  await waitFor(async () => (await subagent('as-sub'))?.ended);
  hook('SessionEnd', { reason: 'other' });
});

test('an interrupt written while a turn runs ends the turn though no hook comes after it', async () => {
  const id = 'sess-esc', tp = path.join(DATA_DIR, 'esc.jsonl');
  const hook = (eventName, fields) => runHook(eventName, { hook_event_name: eventName, session_id: id, cwd: '/tmp/waits', transcript_path: tp, ...fields });
  const sessionNow = async () => (await getJson('/api/sessions')).find(s => s.id === id);
  fs.writeFileSync(tp, '');
  hook('UserPromptSubmit', { prompt: 'write a long answer' });
  await waitFor(async () => (await sessionNow())?.busy);
  // the read right after the hook has passed; then you press Esc while the model writes (a busy session's transcript is
  // polled: server.js)
  await new Promise(resolve => setTimeout(resolve, 1200));
  fs.appendFileSync(tp, JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } }) + '\n');
  await waitFor(async () => (await sessionNow())?.busy === false);
});

test("a subagent's interrupt with no agentId (an older sidechain row) does not end the main turn", async () => {
  const id = 'sess-sidechain', tp = path.join(DATA_DIR, 'sidechain.jsonl');
  const hook = (eventName, fields) => runHook(eventName, { hook_event_name: eventName, session_id: id, cwd: '/tmp/waits', transcript_path: tp, ...fields });
  const sessionNow = async () => (await getJson('/api/sessions')).find(s => s.id === id);
  fs.writeFileSync(tp, '');
  hook('UserPromptSubmit', { prompt: 'look and build' });
  hook('PreToolUse', { tool_name: 'Bash', tool_use_id: 'sc-main', tool_input: { command: 'make' } });
  hook('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'make' } });
  await waitFor(async () => (await sessionNow())?.needsYou.length === 1);
  fs.appendFileSync(tp, JSON.stringify({ type: 'user', isSidechain: true, timestamp: new Date().toISOString(), message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } }) + '\n');
  // the read after the next hook has seen the row
  hook('Notification', { notification_type: 'idle_prompt', message: 'still here' });
  await new Promise(resolve => setTimeout(resolve, 1500));
  const session = await sessionNow();
  assert.equal(session.busy, true, 'the main turn still runs');
  assert.equal(session.needsYou.length, 1, "the main agent's wait stays");
  assert.equal((await getJson('/api/events?session=' + id)).filter(event => event.event === 'Interrupt').length, 0);
  hook('Stop', {});
});

test('a subagent takes the description of its own call: by type, and never from a call refused at its prompt', async () => {
  const id = 'sess-subcalls', tp = path.join(DATA_DIR, 'subcalls.jsonl');
  const hook = (eventName, fields) => runHook(eventName, { hook_event_name: eventName, session_id: id, cwd: '/tmp/waits', transcript_path: tp, ...fields });
  const subagent = async agentId => (await getJson('/api/sessions')).find(s => s.id === id)?.subagentList.find(s => s.id === agentId);
  fs.writeFileSync(tp, '');
  hook('UserPromptSubmit', { prompt: 'look around' });
  // two calls in parallel, whose SubagentStarts land in the other order
  hook('PreToolUse', { tool_name: 'Agent', tool_use_id: 'sc-a', tool_input: { description: 'Plan the change', subagent_type: 'Plan' } });
  hook('PreToolUse', { tool_name: 'Agent', tool_use_id: 'sc-b', tool_input: { description: 'Find the tests', subagent_type: 'Explore' } });
  hook('SubagentStart', { agent_id: 'sc-explore', agent_type: 'Explore' });
  hook('SubagentStart', { agent_id: 'sc-plan', agent_type: 'Plan' });
  assert.equal((await waitFor(() => subagent('sc-explore'))).description, 'Find the tests');
  assert.equal((await waitFor(() => subagent('sc-plan'))).description, 'Plan the change');
  // refused at its prompt: only the transcript says so
  hook('PreToolUse', { tool_name: 'Agent', tool_use_id: 'sc-refused', tool_input: { description: 'Delete the cache', subagent_type: 'Explore' } });
  fs.appendFileSync(tp, JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'sc-refused', is_error: true, content: "The user doesn't want to proceed with this tool use." }] } }) + '\n');
  // the next call comes straight after, before the transcript would be read on its own
  hook('PreToolUse', { tool_name: 'Agent', tool_use_id: 'sc-ok', tool_input: { description: 'Read the README', subagent_type: 'Explore' } });
  hook('SubagentStart', { agent_id: 'sc-next', agent_type: 'Explore' });
  assert.equal((await waitFor(() => subagent('sc-next'))).description, 'Read the README');
  // the transcript's refusal read before the log gives that call's PreToolUse
  fs.appendFileSync(tp, JSON.stringify({ type: 'user', timestamp: new Date().toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'sc-early', is_error: true, content: "The user doesn't want to proceed with this tool use." }] } }) + '\n');
  hook('Notification', { notification_type: 'idle_prompt', message: 'read the transcript' });
  await new Promise(resolve => setTimeout(resolve, 1500));
  hook('PreToolUse', { tool_name: 'Agent', tool_use_id: 'sc-early', tool_input: { description: 'Drop the table', subagent_type: 'Explore' } });
  hook('PreToolUse', { tool_name: 'Agent', tool_use_id: 'sc-late', tool_input: { description: 'List the routes', subagent_type: 'Explore' } });
  hook('SubagentStart', { agent_id: 'sc-last', agent_type: 'Explore' });
  assert.equal((await waitFor(() => subagent('sc-last'))).description, 'List the routes');
  hook('Stop', {});
});

test("a background subagent's wait outlasts its turn's Stop", async () => {
  const id = 'sess-bgwait';
  const hook = (eventName, fields) => runHook(eventName, { hook_event_name: eventName, session_id: id, cwd: '/tmp/waits', ...fields });
  const waits = expected => waitFor(async () => {
    const session = (await getJson('/api/sessions')).find(s => s.id === id);
    return session && JSON.stringify(session.needsYou.map(wait => wait.agentId)) === JSON.stringify(expected) && session;
  });
  hook('UserPromptSubmit', { prompt: 'watch CI' });
  hook('PreToolUse', { tool_name: 'Agent', tool_use_id: 'bw-agent', tool_input: { description: 'Watch CI', subagent_type: 'general-purpose', run_in_background: true } });
  hook('SubagentStart', { agent_id: 'bw-sub', agent_type: 'general-purpose' });
  hook('PreToolUse', { agent_id: 'bw-sub', agent_type: 'general-purpose', tool_name: 'Bash', tool_use_id: 'bw-bash', tool_input: { command: 'gh run watch' } });
  hook('PermissionRequest', { agent_id: 'bw-sub', agent_type: 'general-purpose', tool_name: 'Bash', tool_input: { command: 'gh run watch' } });
  hook('PermissionRequest', { tool_name: 'Write', tool_input: { file_path: '/tmp/notes' } });
  await waits(['bw-sub', null]);
  hook('Stop', {});
  await waits(['bw-sub']);
  hook('PostToolUse', { agent_id: 'bw-sub', agent_type: 'general-purpose', tool_name: 'Bash', tool_use_id: 'bw-bash', tool_input: { command: 'gh run watch' }, tool_response: 'ok' });
  await waits([]);
  hook('SessionEnd', { reason: 'other' });
});

// raw request with a chosen Host header (fetch always sends the real one)
function rawGet(p, host, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = require('node:http').request({ host: '127.0.0.1', port: PORT, path: p, headers: { Host: host, ...headers } }, res => {
      let body = ''; res.on('data', c => body += c); res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject); req.end();
  });
}

test('a foreign Host is refused (DNS rebinding)', async () => {
  assert.equal((await rawGet('/api/events?session=all', `attacker.example:${PORT}`)).status, 403);
  assert.equal((await rawGet('/api/sessions', `127.0.0.1:${PORT + 1}`)).status, 403, 'right name, wrong port');
  assert.equal((await rawGet('/api/sessions', `localhost:${PORT}`)).status, 200);
  assert.equal((await rawGet('/api/sessions', `[::1]:${PORT}`)).status, 200);
});

test('a malformed Host is refused and does not crash the server', async () => {
  assert.equal((await rawGet('/', '[bad')).status, 403);
  assert.equal((await get('/api/health')).status, 200);
});

test('a foreign Origin is refused, and a POST needs one', async () => {
  assert.equal((await fetch(base + '/api/sessions', { headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await fetch(base + '/api/clear', { method: 'POST', headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await fetch(base + '/api/clear', { method: 'POST' })).status, 403, 'no Origin');
  assert.ok(readLog().length > 0, 'the log is untouched');
});

test('responses carry security headers; the page a CSP allowing its inline script', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  const csp = r.headers.get('content-security-policy') || '';
  assert.match(csp, /frame-ancestors 'none'/);
  const inline = /<script>([\s\S]*?)<\/script>/.exec(await r.text())[1].replace(/\r\n?/g, '\n');
  const hash = require('node:crypto').createHash('sha256').update(inline).digest('base64');
  assert.ok(csp.includes(`'sha256-${hash}'`), 'inline script hash in script-src');
});

test('a cross-site fetch is refused; a link from another site still opens the page', async () => {
  // raw requests: fetch sets Sec-Fetch-Mode itself
  const host = `127.0.0.1:${PORT}`;
  assert.equal((await rawGet('/api/sessions', host, { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors' })).status, 403);
  assert.equal((await rawGet('/', host, { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate' })).status, 200);
});

// another machine: a server on every interface, reached through this machine's own network address (not loopback)
const LAN_IP = Object.values(os.networkInterfaces()).flat().find(a => a && a.family === 'IPv4' && !a.internal)?.address;
async function remoteServer(extraEnv) {
  const port = await freePort();
  const proc = spawn(process.execPath, [SERVER], { env: { ...env(), OBSERVER_PORT: String(port), OBSERVER_HOST: '0.0.0.0', ...extraEnv }, stdio: 'ignore' });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/api/health`)).ok);
  // the forged Host passes the Host check, so only the peer check stands in the way
  const call = (p, headers = {}) => new Promise((resolve, reject) => {
    const r = require('node:http').request({ host: LAN_IP, port, path: p, headers: { Host: `localhost:${port}`, ...headers } }, res => {
      let body = ''; res.on('data', c => body += c); res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    r.on('error', reject); r.end();
  });
  return { port, proc, call };
}

test('another machine is refused without OBSERVER_TOKEN, even with a forged Host', { skip: !LAN_IP && 'no network address' }, async () => {
  const { port, proc, call } = await remoteServer({});
  try {
    assert.equal((await call('/api/events?session=all')).status, 403);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/sessions`)).status, 200, 'this machine needs no token');
  } finally { proc.kill(); }
});

test('another machine gets in with OBSERVER_TOKEN, by header or by the cookie /?token= sets', { skip: !LAN_IP && 'no network address' }, async () => {
  const { proc, call } = await remoteServer({ OBSERVER_TOKEN: 's3cret-token' });
  try {
    assert.equal((await call('/api/sessions')).status, 401, 'no token');
    assert.equal((await call('/api/sessions', { Authorization: 'Bearer wrong' })).status, 401, 'wrong token');
    assert.equal((await call('/api/sessions', { Authorization: 'Bearer s3cret-token' })).status, 200);
    const login = await call('/?token=s3cret-token');
    assert.equal(login.status, 302);
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    assert.match(String(login.headers['set-cookie']), /HttpOnly; SameSite=Strict/);
    assert.equal((await call('/api/sessions', { Cookie: cookie })).status, 200);
  } finally { proc.kill(); }
});

test('deleting a session removes its log and indexed events, and keeps other sessions', async () => {
  runHook('SessionStart', { hook_event_name: 'SessionStart', session_id: 'delete-me', cwd: '/tmp/delete-me' });
  runHook('UserPromptSubmit', { hook_event_name: 'UserPromptSubmit', session_id: 'delete-me', cwd: '/tmp/delete-me', prompt: 'private prompt' });
  runHook('SessionStart', { hook_event_name: 'SessionStart', session_id: 'keep-me', cwd: '/tmp/keep-me' });
  await waitFor(async () => (await getJson('/api/sessions')).some(session => session.id === 'delete-me'));

  const response = await fetch(base + '/api/sessions/delete-me', { method: 'DELETE', headers: { Origin: base } });
  assert.equal(response.status, 200);
  await waitFor(async () => !(await getJson('/api/sessions')).some(session => session.id === 'delete-me'));
  assert.ok((await getJson('/api/sessions')).some(session => session.id === 'keep-me'));
  assert.ok(readLog().every(event => event.session_id !== 'delete-me'));
  const deletedName = require('../server/lib/building-blocks/session-logs').sessionLogName('delete-me');
  assert.ok(sessionLogFiles().every(file => path.basename(file) !== deletedName));
  assert.equal((await get('/api/events?session=delete-me')).status, 404);
  assert.ok((await getJson('/api/events?session=all')).every(event => event.session_id !== 'delete-me'));
});

test('pins persist across restarts, load older sessions directly and can be removed', async () => {
  const mutate = (route, method) => fetch(base + '/api/sessions/' + route, { method, headers: { Origin: base } });
  const pinsFile = path.join(DATA_DIR, 'pins.json');
  const readPins = () => JSON.parse(fs.readFileSync(pinsFile, 'utf8'));
  const { today, addDays, sessionLogPath } = require('../server/lib/building-blocks/session-logs');
  const ids = ['old-pin', 'old-unpinned'];
  for (const session_id of ids) runHook('SessionStart', { hook_event_name: 'SessionStart', session_id, cwd: '/tmp/proj' });
  await waitFor(async () => {
    const sessionIds = new Set((await getJson('/api/sessions')).map(session => session.id));
    return ids.every(id => sessionIds.has(id));
  });
  assert.equal((await fetch(base + '/api/sessions/old-pin/pin', { method: 'PUT' })).status, 403);
  assert.equal((await mutate('missing/pin', 'PUT')).status, 404);
  for (const id of ids) assert.deepEqual(await (await mutate(`${id}/pin`, 'PUT')).json(), { pinned: true });
  assert.deepEqual(await (await mutate('old-unpinned/pin', 'DELETE')).json(), { pinned: false });
  assert.deepEqual(readPins(), ['old-pin']);

  await stopServer();
  const oldTime = addDays(today(), -30) + 'T00:00:00.000Z';
  for (const id of ids) {
    const current = sessionLogPath(SESSION_LOGS, id, new Date().toISOString());
    const older = sessionLogPath(SESSION_LOGS, id, oldTime);
    const event = JSON.parse(fs.readFileSync(current, 'utf8'));
    fs.mkdirSync(path.dirname(older), { recursive: true });
    fs.writeFileSync(older, JSON.stringify({ ...event, ts: oldTime }) + '\n');
    fs.unlinkSync(current);
  }
  await startServer();
  const sessions = await getJson('/api/sessions');
  assert.equal(sessions.find(session => session.id === 'old-pin').pinned, true);
  assert.equal(sessions.some(session => session.id === 'old-unpinned'), false);
  assert.equal((await getJson('/api/events?session=old-pin'))[0].ts, oldTime);
  assert.equal((await mutate('old-pin', 'DELETE')).status, 200);
  assert.deepEqual(readPins(), []);
});

test('clear wipes the log, sessions and pins', async () => {
  assert.equal((await fetch(base + '/api/sessions/keep-me/pin', { method: 'PUT', headers: { Origin: base } })).status, 200);
  const r = await fetch(base + '/api/clear', { method: 'POST', headers: { Origin: base } });
  assert.equal(r.status, 200);
  assert.equal(sessionLogFiles().length, 0);
  assert.deepEqual(await getJson('/api/sessions'), []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'pins.json'), 'utf8')), []);
});
