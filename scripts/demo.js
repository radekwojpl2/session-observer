#!/usr/bin/env node
// Demo mode: starts the dashboard on its own port with made-up sessions
// (history + one session that keeps working live). Touches nothing in ~/.claude.
//   node scripts/demo.js        → http://localhost:4800
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.DEMO_PORT || 4800);
const DEMO_DIR = path.join(os.tmpdir(), 'session-observer-demo');
const LOG_FILE = path.join(DEMO_DIR, 'events.jsonl');
fs.rmSync(DEMO_DIR, { recursive: true, force: true });
fs.mkdirSync(DEMO_DIR, { recursive: true });

const MODEL = 'claude-opus-5-5';
const TOOLS = [
  ['Read', { file_path: 'src/routes/auth.ts' }], ['Grep', { pattern: 'rateLimit' }], ['Glob', { pattern: 'src/**/*.test.ts' }],
  ['Edit', { file_path: 'src/middleware/limiter.ts' }], ['Write', { file_path: 'src/middleware/limiter.test.ts' }],
  ['Bash', { command: 'npm test' }], ['Bash', { command: 'git status' }], ['Bash', { command: 'git diff --stat' }],
  ['Bash', { command: 'node scripts/seed.js' }], ['Bash', { command: 'docker compose up -d redis' }], ['Read', { file_path: 'package.json' }],
  ['WebFetch', { url: 'https://expressjs.com/en/guide/behind-proxies.html' }], ['WebSearch', { query: 'express rate limit redis store' }],
  ['Skill', { skill: 'patterns' }], ['Agent', { subagent_type: 'Explore', description: 'find all route handlers' }],
  ['mcp__claude-in-chrome__navigate', { url: 'http://localhost:3000' }], ['mcp__codebase-memory-mcp__search_graph', { name_pattern: 'Limiter' }],
  ['TodoWrite', { todos: [] }],
];
const SUBAGENT_TOOLS = [
  ['Grep', { pattern: 'router\\.(get|post)' }], ['Glob', { pattern: 'src/routes/**/*.ts' }], ['Read', { file_path: 'src/routes/users.ts' }],
  ['Read', { file_path: 'src/app.ts' }], ['Bash', { command: 'git log --oneline -5 -- src/routes' }],
];
const SUBAGENT_TASKS = ['find all route handlers', 'check how auth middleware is wired', 'list existing tests for routes'];
const FAILURE_RATE = 0.08;

const pickOne = list => list[Math.floor(Math.random() * list.length)];
const randomBetween = (low, high) => low + Math.random() * (high - low);
const randomHex = length => Math.random().toString(16).slice(2, 2 + length);
let lastId = 0;
const nextId = () => ++lastId;

// an assistant response as Claude Code writes it to a transcript: usage, and the tools it asked for
function transcriptResponse(ts, tools, stopReason, usage, extra = {}) {
  const id = nextId();
  return JSON.stringify({
    type: 'assistant', timestamp: new Date(ts).toISOString(), uuid: 'u' + id, ...extra,
    message: { id: 'msg_' + id, role: 'assistant', model: MODEL, stop_reason: stopReason, usage, content: tools.map(name => ({ type: 'tool_use', name })) },
  }) + '\n';
}

// a made-up session: writes its hook events to the log and its model steps to its transcript
function createSession(id, project) {
  const cwd = `D:/git/${project}`;
  const transcript = path.join(DEMO_DIR, 'projects', `${id}.jsonl`);
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  let contextTokens = 18000;
  return {
    id, cwd, transcript,
    hook(ts, event, data = {}) {
      const payload = { session_id: id, transcript_path: transcript, cwd, hook_event_name: event, ...data };
      fs.appendFileSync(LOG_FILE, JSON.stringify({ ts: new Date(ts).toISOString(), event, session_id: id, data: payload }) + '\n');
    },
    // a subagent's model step: its own transcript under <session>/subagents/, as Claude Code writes it
    subagentStep(ts, agentId, tools, stopReason = 'tool_use') {
      const file = path.join(path.dirname(transcript), id, 'subagents', `agent-${agentId}.jsonl`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const usage = { input_tokens: 3, output_tokens: 80 + Math.floor(Math.random() * 400), cache_read_input_tokens: 9000, cache_creation_input_tokens: 800 };
      fs.appendFileSync(file, transcriptResponse(ts, tools, stopReason, usage, { isSidechain: true, agentId }));
    },
    // a main-agent model step; the context grows a little with each one
    step(ts, tools, stopReason = 'tool_use') {
      contextTokens += 1500 + Math.floor(Math.random() * 4000);
      const usage = { input_tokens: 3, output_tokens: 120 + Math.floor(Math.random() * 900), cache_read_input_tokens: contextTokens - 1200, cache_creation_input_tokens: 1200 };
      fs.appendFileSync(transcript, transcriptResponse(ts, tools, stopReason, usage));
    },
  };
}

// One turn as a list of [delay ms, write(ts)], so it can be written instantly (history) or in real time (live).
// Built on absolute offsets first so parallel subagents can interleave, then turned into delays.
function planTurn(session, prompt, toolCalls, subagentsFirst = 0) {
  const plan = []; // [offset ms, write(ts)]
  let offset = 0;
  const after = (delay, write) => { offset += delay; plan.push([offset, write]); };

  // a tool call: the model asks for it, the hook sees it start, then finish (or fail)
  function toolCall() {
    const [tool, input] = pickOne(TOOLS);
    if (tool === 'Agent') return subagents(Math.random() < 0.4 ? 2 : 1);
    const toolUseId = 'toolu_' + nextId(), fails = Math.random() < FAILURE_RATE;
    const call = { tool_name: tool, tool_input: input, tool_use_id: toolUseId };
    after(randomBetween(900, 2400), ts => session.step(ts, [tool]));
    after(250, ts => session.hook(ts, 'PreToolUse', call));
    after(tool === 'Bash' ? randomBetween(2500, 7500) : randomBetween(300, 1800), ts => (fails
      ? session.hook(ts, 'PostToolUseFailure', { ...call, error: 'Exit code 1: 2 tests failed' })
      : session.hook(ts, 'PostToolUse', { ...call, tool_response: 'ok' })));
  }

  // one subagent from its Agent call to its hand-back; returns when it finished
  function subagent(index, startsAt) {
    const toolUseId = 'toolu_' + nextId(), agentId = 'a' + randomHex(10), task = SUBAGENT_TASKS[(lastId + index) % SUBAGENT_TASKS.length];
    const input = { subagent_type: 'Explore', description: task }, agent = { agent_id: agentId, agent_type: 'Explore' };
    let at = startsAt + 150 + index * 120;
    const add = (delay, write) => { at += delay; plan.push([at, write]); };
    add(0, ts => session.hook(ts, 'PreToolUse', { tool_name: 'Agent', tool_input: input, tool_use_id: toolUseId }));
    add(200, ts => session.hook(ts, 'SubagentStart', agent));
    for (let calls = 2 + Math.floor(Math.random() * 3); calls > 0; calls--) {
      const [tool, toolInput] = pickOne(SUBAGENT_TOOLS), callId = 'toolu_' + nextId();
      add(randomBetween(700, 1600), ts => session.subagentStep(ts, agentId, [tool]));
      add(200, ts => session.hook(ts, 'PreToolUse', { tool_name: tool, tool_input: toolInput, tool_use_id: callId, ...agent }));
      add(randomBetween(300, 1200), ts => session.hook(ts, 'PostToolUse', { tool_name: tool, tool_input: toolInput, tool_use_id: callId, tool_response: 'ok', ...agent }));
    }
    add(600, ts => session.subagentStep(ts, agentId, [], 'end_turn'));
    add(150, ts => session.hook(ts, 'SubagentStop', { ...agent, last_assistant_message: `Done: ${task}.` }));
    add(150, ts => session.hook(ts, 'PostToolUse', { tool_name: 'Agent', tool_input: input, tool_use_id: toolUseId, tool_response: 'ok' }));
    return at;
  }

  // several subagents launched together; each runs its own model steps and tool calls, then hands back
  function subagents(count) {
    after(randomBetween(900, 2400), ts => session.step(ts, new Array(count).fill('Agent')));
    let lastFinished = offset;
    for (let index = 0; index < count; index++) lastFinished = Math.max(lastFinished, subagent(index, offset));
    offset = lastFinished;
  }

  after(0, ts => session.hook(ts, 'UserPromptSubmit', { prompt }));
  if (subagentsFirst) subagents(subagentsFirst);
  for (let index = 0; index < toolCalls; index++) toolCall();
  after(1200, ts => session.step(ts, [], 'end_turn'));
  after(300, ts => session.hook(ts, 'Stop', { last_assistant_message: `Done — ${prompt.toLowerCase()}. Tests pass; changes are in the working tree, not committed.` }));

  plan.sort((a, b) => a[0] - b[0]);
  let previous = 0;
  return plan.map(([at, write]) => {
    const delay = at - previous;
    previous = at;
    return [delay, write];
  });
}

// writes a whole plan at once, as if it happened from `start`; returns when it ended
function writeAtOnce(plan, start) {
  let time = start;
  for (const [delay, write] of plan) {
    time += delay;
    write(time);
  }
  return time;
}

// ---------- history ----------
const HISTORY = [
  ['infra', ['Bump Node to 22 in the CI workflow']],
  ['web-ui', ['Make the header sticky on scroll', 'Add a dark mode toggle that remembers the choice', 'Fix the layout shift on the pricing page']],
  ['api-server', ['Add a login endpoint with JWT', 'The auth tests are flaky, find out why']],
];
const sessionsByProject = {};
let clock = Date.now() - 4 * 3600e3;
for (const [project, prompts] of HISTORY) {
  const session = sessionsByProject[project] = createSession(`${project}-${randomHex(8)}`, project);
  session.hook(clock, 'SessionStart', { source: 'startup', model: MODEL, permission_mode: 'default' });
  session.hook(clock + 200, 'InstructionsLoaded', { file_path: `${session.cwd}/CLAUDE.md` });
  for (const prompt of prompts) clock = writeAtOnce(planTurn(session, prompt, 6 + Math.floor(Math.random() * 14)), clock + 60000);
  if (project !== 'api-server') session.hook(clock + 5000, 'SessionEnd', { reason: 'exit' });
  clock += 20 * 60000;
}

// ---------- server + live session ----------
const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
  stdio: 'inherit', env: { ...process.env, OBSERVER_PORT: String(PORT), OBSERVER_DATA_DIR: DEMO_DIR },
});
process.on('SIGINT', () => { server.kill(); process.exit(0); });
process.on('exit', () => server.kill());

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const liveSession = sessionsByProject['api-server'];
const LIVE_PROMPTS = ['Add rate limiting to the public API', 'Store the limiter counters in Redis', 'Write tests for the limiter', 'Document the new limits in the README'];
(async () => {
  await sleep(1500);
  console.log(`Demo running → http://localhost:${PORT}  (Ctrl+C to stop)`);
  // noinspection InfiniteLoopJS: the demo runs until Ctrl+C
  for (let turn = 0; ; turn++) {
    const plan = planTurn(liveSession, LIVE_PROMPTS[turn % LIVE_PROMPTS.length], 5 + Math.floor(Math.random() * 6), turn % 2 ? 0 : 2);
    for (const [delay, write] of plan) {
      await sleep(delay);
      write(Date.now());
    }
    await sleep(6000);
  }
})();
