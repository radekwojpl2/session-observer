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
const DIR = path.join(os.tmpdir(), 'session-observer-demo');
const LOG = path.join(DIR, 'events.jsonl');
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const MODEL = 'claude-opus-5-5';
const TOOLS = [
  ['Read', { file_path: 'src/routes/auth.ts' }], ['Grep', { pattern: 'rateLimit' }], ['Glob', { pattern: 'src/**/*.test.ts' }],
  ['Edit', { file_path: 'src/middleware/limiter.ts' }], ['Write', { file_path: 'src/middleware/limiter.test.ts' }],
  ['Bash', { command: 'npm test' }], ['Bash', { command: 'git status' }], ['Bash', { command: 'git diff --stat' }],
  ['WebFetch', { url: 'https://expressjs.com/en/guide/behind-proxies.html' }], ['WebSearch', { query: 'express rate limit redis store' }],
  ['Skill', { skill: 'patterns' }], ['Agent', { subagent_type: 'Explore', description: 'find all route handlers' }],
  ['mcp__claude-in-chrome__navigate', { url: 'http://localhost:3000' }], ['mcp__codebase-memory-mcp__search_graph', { name_pattern: 'Limiter' }],
  ['TodoWrite', { todos: [] }],
];
const pick = a => a[Math.floor(Math.random() * a.length)];
let uid = 0;

function session(id, project) {
  const cwd = `D:/git/${project}`;
  const transcript = path.join(DIR, 'projects', `${id}.jsonl`);
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  let ctx = 18000;
  return {
    id, cwd, transcript,
    hook(ts, event, data = {}) {
      fs.appendFileSync(LOG, JSON.stringify({ ts: new Date(ts).toISOString(), event, session_id: id,
        data: { session_id: id, transcript_path: transcript, cwd, hook_event_name: event, ...data } }) + '\n');
    },
    step(ts, tools, stop = 'tool_use') {
      ctx += 1500 + Math.floor(Math.random() * 4000);
      fs.appendFileSync(transcript, JSON.stringify({ type: 'assistant', timestamp: new Date(ts).toISOString(), uuid: 'u' + (++uid),
        message: { id: 'msg_' + uid, role: 'assistant', model: MODEL, stop_reason: stop,
          usage: { input_tokens: 3, output_tokens: 120 + Math.floor(Math.random() * 900), cache_read_input_tokens: ctx - 1200, cache_creation_input_tokens: 1200 },
          content: tools.map(name => ({ type: 'tool_use', name })) } }) + '\n');
    },
  };
}

// one turn as a list of [delayMs, fn(ts)] so it can be written instantly (history) or in real time (live)
function turnPlan(s, prompt, n) {
  const plan = [[0, ts => s.hook(ts, 'UserPromptSubmit', { prompt })]];
  for (let i = 0; i < n; i++) {
    const [tool, input] = pick(TOOLS); const id = 'toolu_' + (++uid);
    const fail = Math.random() < 0.08;
    plan.push([900 + Math.random() * 1500, ts => s.step(ts, [tool])]);
    plan.push([250, ts => s.hook(ts, 'PreToolUse', { tool_name: tool, tool_input: input, tool_use_id: id })]);
    if (tool === 'Agent') plan.push([200, ts => s.hook(ts, 'SubagentStart', { agent_id: 'ag' + uid, agent_type: 'Explore' })]);
    const run = tool === 'Bash' ? 2500 + Math.random() * 5000 : tool === 'Agent' ? 6000 : 300 + Math.random() * 1500;
    if (tool === 'Agent') plan.push([run, ts => s.hook(ts, 'SubagentStop', { agent_id: 'ag' + uid, agent_type: 'Explore', last_assistant_message: 'Found 14 route handlers in src/routes.' })]);
    plan.push([tool === 'Agent' ? 200 : run, ts => fail
      ? s.hook(ts, 'PostToolUseFailure', { tool_name: tool, tool_input: input, tool_use_id: id, error: 'Exit code 1: 2 tests failed' })
      : s.hook(ts, 'PostToolUse', { tool_name: tool, tool_input: input, tool_use_id: id, tool_response: 'ok' })]);
  }
  plan.push([1200, ts => s.step(ts, [], 'end_turn')]);
  plan.push([300, ts => s.hook(ts, 'Stop', { last_assistant_message: `Done — ${prompt.toLowerCase()}. Tests pass; changes are in the working tree, not committed.` })]);
  return plan;
}
function writeNow(plan, start) { let t = start; for (const [d, f] of plan) { t += d; f(t); } return t; }

// ---------- history ----------
let t = Date.now() - 4 * 3600e3;
const history = [
  ['infra', ['Bump Node to 22 in the CI workflow']],
  ['web-ui', ['Make the header sticky on scroll', 'Add a dark mode toggle that remembers the choice', 'Fix the layout shift on the pricing page']],
  ['api-server', ['Add a login endpoint with JWT', 'The auth tests are flaky, find out why']],
];
const sessions = {};
for (const [project, prompts] of history) {
  const s = sessions[project] = session(`${project}-${Math.random().toString(16).slice(2, 10)}`, project);
  s.hook(t, 'SessionStart', { source: 'startup', model: MODEL, permission_mode: 'default' });
  s.hook(t + 200, 'InstructionsLoaded', { file_path: `${s.cwd}/CLAUDE.md` });
  for (const p of prompts) t = writeNow(turnPlan(s, p, 6 + Math.floor(Math.random() * 14)), t + 60000);
  if (project !== 'api-server') s.hook(t + 5000, 'SessionEnd', { reason: 'exit' });
  t += 20 * 60000;
}

// ---------- server + live session ----------
const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
  stdio: 'inherit', env: { ...process.env, OBSERVER_PORT: String(PORT), OBSERVER_DATA_DIR: DIR },
});
process.on('SIGINT', () => { server.kill(); process.exit(0); });
process.on('exit', () => server.kill());

const live = sessions['api-server'];
const prompts = ['Add rate limiting to the public API', 'Store the limiter counters in Redis', 'Write tests for the limiter', 'Document the new limits in the README'];
(async () => {
  await new Promise(r => setTimeout(r, 1500));
  console.log(`Demo running → http://localhost:${PORT}  (Ctrl+C to stop)`);
  for (let k = 0; ; k++) {
    for (const [d, f] of turnPlan(live, prompts[k % prompts.length], 5 + Math.floor(Math.random() * 6))) {
      await new Promise(r => setTimeout(r, d)); f(Date.now());
    }
    await new Promise(r => setTimeout(r, 6000));
  }
})();
