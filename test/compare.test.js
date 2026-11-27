'use strict';
// The Compare view's model (server/dashboard/features/compare/model.js), run in a sandbox with the dashboard scripts it
// builds on: what it measures from a session's events, and how it compares the sessions.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DASHBOARD = path.join(__dirname, '../server/dashboard');

function compareSandbox() {
  const saved = new Map();
  const context = vm.createContext({
    TEXT: { groups: {}, categories: {}, units: {} },
    storage: { get: (key, fallback) => (saved.has(key) ? saved.get(key) : fallback), set: (key, value) => saved.set(key, value) },
    SETTING_KEYS: { compare: 'so.compare' },
    location: { search: '', href: 'http://127.0.0.1:4777/' },
    history: { state: null, replaceState() {} },
    state: { sessions: new Map(), view: 'home' },
    turnBySeq: new Map([['page', 'kept']]),
    DEFAULT_AGENT: 'claude',
    FILE_TOOLS: new Set(['Read', 'Edit', 'Write', 'Grep']), COMMAND_TOOLS: new Set(['Bash']), PATCH_TOOLS: new Set(), PATH_FIELDS: ['file_path', 'path'],
    READ_TOOLS: new Set(['Read']), EDIT_TOOLS: new Set(['Edit', 'Write']), // (Grep searches: neither)
    SUBAGENT_CALL_TOOLS: new Set(),
    toolGroupOfEvent: event => (event.data?.tool_name === 'Bash' ? 'shell' : event.data?.tool_name ? 'files' : null),
    isProblemEvent: event => event.event === 'PostToolUseFailure',
    formatDuration: String, formatCompactNumber: String, formatUsd: String,
    sessionCostOf: session => (session.cost?.priced ? session.cost.usd : null), isCostPartial: () => false,
    toolDisplayName: name => name, toolArgument: data => data.tool_input?.command || data.tool_input?.file_path || '',
    scheduleRender() {}, markViewDirty() {},
  });
  const files = ['building-blocks/format.js', 'building-blocks/tech-badges.js', 'features/events/model/tool-groups.js', 'features/events/model/turns.js', 'features/compare/model.js'];
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(DASHBOARD, file), 'utf8'), context, { filename: file });
  }
  return context;
}

// a session's events, one second apart: [event, data]
const eventsOf = (sessionId, rows) => rows.map(([event, data, cost], seq) => ({
  event, data, ...(cost !== undefined && { cost_usd: cost }), seq: seq + 1, session_id: sessionId, ts: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(),
}));

test('a session is measured from its events: turns, time, files from its folder, commands, prompts', () => {
  const sandbox = compareSandbox();
  const events = eventsOf('s1', [
    ['UserPromptSubmit', { prompt: 'fix the bug' }],
    ['PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'D:\\work\\app\\src\\a.ts' } }],
    ['PreToolUse', { tool_name: 'Edit', tool_input: { file_path: 'D:\\work\\app\\src\\a.ts' } }],
    ['PreToolUse', { tool_name: 'Read', tool_input: { file_path: 'D:\\elsewhere\\notes.md' } }],
    ['PreToolUse', { tool_name: 'Grep', tool_input: { pattern: 'x', path: 'D:\\work\\app\\lib' } }],
    ['Stop', { last_assistant_message: 'first answer' }],
    ['UserPromptSubmit', { prompt: 'run the tests' }],
    ['PreToolUse', { tool_name: 'Bash', tool_input: { command: 'cd app && cat src/b.ts | head -5; sed -n 1,20p src/c.ts 2>/dev/null' } }],
    ['Stop', { last_assistant_message: 'tests pass' }],
  ]);
  sandbox.events = events;
  const measure = vm.runInContext(`measureSessionEvents(events, 'D:\\\\work\\\\app\\\\')`, sandbox);
  assert.deepEqual([...measure.edited], ['src/a.ts'], 'an edited path is read from the session folder, with /');
  assert.deepEqual([...measure.read], ['D:/elsewhere/notes.md', 'src/b.ts', 'src/c.ts'],
    'a file read and edited counts once, as edited; a search reads no file; cat and sed -n read theirs');
  assert.equal(measure.commands, 1);
  assert.deepEqual({ ...measure.groups }, { files: 4, shell: 1 });
  assert.equal(measure.turns.length, 2);
  assert.equal(measure.activeMs, 5000 + 2000);
  assert.equal(measure.firstPrompt, 'fix the bug');
  assert.deepEqual(Array.from(measure.turns, turn => turn.answer), ['first answer', 'tests pass']);
  assert.equal(vm.runInContext(`turnBySeq.get('page')`, sandbox), 'kept', "the page's own turn index is left as it was");
});

test('each turn keeps its route in short: steps, tool calls and subagents in order, failures and subagent work marked', () => {
  const sandbox = compareSandbox();
  sandbox.events = eventsOf('s1', [
    ['UserPromptSubmit', { prompt: 'go' }],
    ['ModelStep', {}, 0.25],
    ['ModelText', { kind: 'thinking', text: 'run the tests first' }],
    ['PreToolUse', { tool_name: 'Bash', tool_use_id: 'c1', tool_input: { command: 'npm test' } }],
    ['PostToolUseFailure', { tool_name: 'Bash', tool_use_id: 'c1' }],
    ['SubagentStart', { agent_id: 'a1', agent_type: 'Explore' }],
    ['PreToolUse', { tool_name: 'Read', tool_use_id: 'c2', agent_id: 'a1', tool_input: { file_path: 'x.ts' } }],
    ['Stop', {}],
  ]);
  sandbox.events[4].duration_ms = 1500; // the server times a call from its PreToolUse to its result
  const turn = vm.runInContext('measureSessionEvents(events, "").turns[0]', sandbox);
  assert.equal(turn.key, 's1:1');
  assert.equal(turn.stopCount, 4);
  assert.equal(turn.cost, 0.25, "the turn costs what its model steps cost");
  assert.deepEqual(Array.from(turn.stops, stop => [stop.kind, stop.group, stop.tool || stop.text, stop.argument, stop.failed, stop.sub, stop.ms, stop.cost]), [
    ['step', 'model', '', '', false, false, null, 0.25],
    ['text', 'model', 'run the tests first', '', false, false, null, null],
    ['tool', 'shell', 'Bash', 'npm test', true, false, 1500, null],
    ['subagent', 'agents', 'Explore', '', false, false, null, null],
    ['tool', 'files', 'Read', 'x.ts', false, true, null, null],
  ]);
  assert.ok(turn.stops[1].thinking);
});

test('each value is compared with the baseline, and the best is marked where less is better', () => {
  const sandbox = compareSandbox();
  const cells = vm.runInContext(`
    const sessions = [{ toolCalls: 10, turns: 2 }, { toolCalls: 5, turns: 3 }, { toolCalls: 15, turns: 2 }];
    ({ tools: compareCells(COMPARE_METRICS.find(m => m.id === 'toolCalls'), sessions, []),
       turns: compareCells(COMPARE_METRICS.find(m => m.id === 'turns'), sessions, []),
       fromNone: compareCells(COMPARE_METRICS.find(m => m.id === 'problems'), [{ failures: 0 }, { failures: 2 }], []),
       loading: compareCells(COMPARE_METRICS.find(m => m.id === 'activeTime'), [{}, {}], [null, { activeMs: 10 }]) })`, sandbox);
  assert.deepEqual(Array.from(cells.tools, cell => [cell.value, cell.best, cell.change, cell.verdict]),
    [[10, false, null, ''], [5, true, -0.5, 'better'], [15, false, 0.5, 'worse']]);
  assert.deepEqual(Array.from(cells.turns, cell => [cell.best, cell.verdict]), [[false, ''], [false, ''], [false, '']], 'turns are neither better nor worse');
  assert.equal(cells.fromNone[1].change, Infinity);
  assert.equal(cells.fromNone[1].verdict, 'worse');
  assert.deepEqual(Array.from(cells.loading, cell => [cell.value, cell.change]), [[null, null], [10, null]], 'no change while the baseline loads');
});

test('the kind of comparison, and the files edited by more of the sessions first', () => {
  const sandbox = compareSandbox();
  const result = vm.runInContext(`
    const measure = (prompt, edited, read = []) => ({ firstPrompt: prompt, edited: new Set(edited), read: new Set(read) });
    ({ rerun: compareKind([{ agent: 'claude' }, {}], [measure('do  it', []), measure('do it', [])]),
       agents: compareKind([{ agent: 'claude' }, { agent: 'codex' }], [measure('a', []), measure('b', [])]),
       loading: compareKind([{}, {}], [measure('a', []), null]),
       files: comparedFiles([measure('', ['b.ts'], ['a.ts', 'd.ts']), measure('', ['a.ts', 'c.ts'])]) })`, sandbox);
  assert.deepEqual({ ...result.rerun }, { sameAgent: true, samePrompt: true });
  assert.deepEqual({ ...result.agents }, { sameAgent: false, samePrompt: false });
  assert.equal(result.loading.samePrompt, null);
  assert.deepEqual(Array.from(result.files, row => [row.path, [...row.by]]),
    [['a.ts', ['read', 'edited']], ['b.ts', ['edited', '']], ['c.ts', ['', 'edited']], ['d.ts', ['read', '']]], 'edited first, then by how many touched it');
});

test('the files a shell command reads: cat, head, sed -n, Get-Content; not a search, a write or a redirection', () => {
  const sandbox = compareSandbox();
  const read = command => [...vm.runInContext(`filesReadByCommand(${JSON.stringify(command)})`, sandbox)];
  assert.deepEqual(read('cat README.md docs/a.md'), ['README.md', 'docs/a.md']);
  assert.deepEqual(read("sed -n '1,120p' server/lib/x.js && head -n 40 test/y.test.js"), ['server/lib/x.js', 'test/y.test.js']);
  assert.deepEqual(read('Get-Content -Path "D:\\repo\\a.ps1" -TotalCount 50 | Select-Object -First 5'), ['D:\\repo\\a.ps1']);
  assert.deepEqual(read('rg -n pattern src/ && grep -r x lib/a.js'), [], 'a search names the files it looks in, not files it reads');
  assert.deepEqual(read("sed -i 's/a/b/' src/a.js"), [], 'sed -i changes its file');
  assert.deepEqual(read('cat src/*.js > /dev/null; npm test'), []);
  assert.deepEqual(read(['bash', '-lc', 'cat a.txt']), ['a.txt'], 'a command given as words');
});

test('up to three sessions are compared, and a session gone from the page gives its place up', () => {
  const sandbox = compareSandbox();
  const result = vm.runInContext(`
    for (const id of ['a', 'b', 'c', 'd']) state.sessions.set(id, { id });
    for (const id of ['a', 'b', 'c', 'd']) toggleCompared(id);
    const full = [...compareIds];
    makeCompareBaseline('c');
    const baselineFirst = [...compareIds];
    state.sessions.delete('a');
    toggleCompared('d');
    const afterGone = [...compareIds];
    toggleCompared('c');
    ({ full, baselineFirst, afterGone, afterRemove: [...compareIds], saved: storage.get('so.compare') })`, sandbox);
  assert.deepEqual([...result.full], ['a', 'b', 'c']);
  assert.deepEqual([...result.baselineFirst], ['c', 'a', 'b']);
  assert.deepEqual([...result.afterGone], ['c', 'b', 'd']);
  assert.deepEqual([...result.afterRemove], ['b', 'd']);
  assert.equal(result.saved, 'b,d');
});
