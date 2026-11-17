#!/usr/bin/env node
// Demo mode: starts the dashboard on its own port with made-up sessions from a made-up project, written
// the way Claude Code writes them (hook events + transcripts with replies, tool inputs and outputs, subagents).
// One session keeps working live. Touches nothing in ~/.claude. The README screenshots are taken from it.
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
const HOME = '/home/dev/code';
let uid = 0;
const hex = n => Array.from({ length: n }, (_, i) => ((uid * 7919 + i * 104729) % 16).toString(16)).join('');
const iso = ts => new Date(ts).toISOString();
const append = (file, obj) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, JSON.stringify(obj) + '\n'); };
const tok = s => Math.round(String(s || '').length / 3.6);

// ---------------------------------------------------------------- one session: hook log + transcript
function session(project, id) {
  const cwd = `${HOME}/${project}`;
  const dir = path.join(DIR, 'projects', '-home-dev-code-' + project);
  const s = { id, cwd, dir, transcript: path.join(dir, `${id}.jsonl`), ctx: 34000 };
  s.abs = f => `${cwd}/${f}`;
  s.hook = (ts, event, data = {}) => append(LOG, { ts: iso(ts), event, session_id: id,
    data: { session_id: id, transcript_path: s.transcript, cwd, hook_event_name: event, ...data } });
  s.row = (file, ts, obj) => append(file, { ...obj, uuid: 'u' + (++uid), timestamp: iso(ts), sessionId: id, cwd });
  return s;
}

// what a tool hands back: tool_response in the hook event, and the tool_result text the model reads
function toolResponse(s, c) {
  const i = c.input, out = c.out ?? '';
  switch (c.tool) {
    case 'Bash': return { stdout: out, stderr: '', interrupted: false, isImage: false };
    case 'Read': { const n = out.split('\n').length; return { type: 'text', file: { filePath: i.file_path, content: out, numLines: n, startLine: 1, totalLines: n } }; }
    case 'Edit': return { filePath: i.file_path, oldString: i.old_string, newString: i.new_string, userModified: false, replaceAll: false };
    case 'Write': return { type: 'create', filePath: i.file_path, content: i.content };
    case 'Grep': return { mode: 'content', numFiles: new Set(out.split('\n').map(l => l.split(':')[0])).size, filenames: [], content: out, numLines: out.split('\n').length };
    case 'Glob': return { filenames: out.split('\n'), numFiles: out.split('\n').length, truncated: false };
    case 'Skill': return { success: true, commandName: i.skill };
    case 'Agent': return { status: 'completed', agentId: c.aid, resolvedModel: MODEL, content: [{ type: 'text', text: c.agent.report }], totalToolUseCount: c.agent.steps.reduce((n, st) => n + (st.calls || []).length, 0) };
    default: return c.tool.startsWith('mcp__') ? [{ type: 'text', text: out }] : out;
  }
}
function resultText(c) {
  switch (c.tool) {
    case 'Read': return c.out.split('\n').map((l, k) => `${String(k + 1).padStart(6)}\t${l}`).join('\n');
    case 'Edit': return `The file ${c.input.file_path} has been updated successfully.`;
    case 'Write': return `File created successfully at: ${c.input.file_path}`;
    case 'Skill': return `Launching skill: ${c.input.skill}`;
    case 'Agent': return c.agent.report;
    default: return c.out || '(no output)';
  }
}
const MS = { Read: 40, Grep: 140, Glob: 70, Edit: 60, Write: 50, Bash: 2600, Skill: 30 };

// one model response: one transcript line per content block, all under one message id, like Claude Code writes them
function respond(s, agent, ts, text, calls, stop) {
  const who = agent || s, file = agent ? agent.file : s.transcript;
  const out = 30 + tok(text) + calls.reduce((n, c) => n + 25 + tok(JSON.stringify(c.input)), 0);
  const cw = 600 + out * 2, msg = 'msg_demo' + (++uid);
  const usage = { input_tokens: 3, cache_read_input_tokens: who.ctx - cw, cache_creation_input_tokens: cw, output_tokens: out };
  const blocks = [...(text ? [{ type: 'text', text }] : []), ...calls.map(c => ({ type: 'tool_use', id: c.id, name: c.tool, input: c.input }))];
  for (const b of blocks.length ? blocks : [{ type: 'text', text: '' }])
    s.row(file, ts, { type: 'assistant', isSidechain: !!agent, ...(agent ? { agentId: agent.id } : {}),
      message: { id: msg, type: 'message', role: 'assistant', model: MODEL, content: [b], stop_reason: stop, usage } });
  who.ctx += out;
}

// steps of one agent (the main one, or a subagent): returns when the last one ends
function runSteps(s, t, steps, agent, plan) {
  const who = agent ? { agent_id: agent.id, agent_type: agent.type } : {};
  for (const st of steps) {
    const calls = (st.calls || []).map(c => ({ ...c, id: 'toolu_demo' + (++uid) }));
    t += 900 + Math.min(3500, (st.say || '').length * 14);
    plan(t, ts => respond(s, agent, ts, st.say, calls, 'tool_use'));
    let end = t;
    calls.forEach((c, j) => {
      const start = t + 150 + j * 80;
      if (c.agent) { end = Math.max(end, runAgent(s, start, c, plan)); return; }
      const mcp = c.tool.startsWith('mcp__') ? { mcp_server: { name: c.tool.split('__')[1], source: 'dynamic' } } : {};
      plan(start, ts => s.hook(ts, 'PreToolUse', { ...who, tool_name: c.tool, tool_input: c.input, tool_use_id: c.id }));
      const fin = start + (c.ms ?? (c.tool.startsWith('mcp__') ? 700 : MS[c.tool] ?? 300));
      plan(fin, ts => {
        if (c.fail) s.hook(ts, 'PostToolUseFailure', { ...who, tool_name: c.tool, tool_input: c.input, tool_use_id: c.id, error: c.fail, is_interrupt: false, ...mcp });
        else s.hook(ts, 'PostToolUse', { ...who, tool_name: c.tool, tool_input: c.input, tool_response: toolResponse(s, c), tool_use_id: c.id, ...mcp });
        const text = c.fail || resultText(c);
        s.row(agent ? agent.file : s.transcript, ts, { type: 'user', isSidechain: !!agent, ...(agent ? { agentId: agent.id } : {}),
          message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: c.id, content: text, is_error: !!c.fail }] } });
        (agent || s).ctx += tok(text) + 20;
      });
      end = Math.max(end, fin);
    });
    t = end;
  }
  return t;
}

// a subagent: its own transcript under <session>/subagents/, its own model steps and tools, then it reports back
function runAgent(s, start, c, plan) {
  const a = c.agent, id = 'a' + hex(16);
  c.aid = id;
  const agent = { id, type: a.type, ctx: 9200, file: path.join(s.dir, s.id, 'subagents', `agent-${id}.jsonl`) };
  const who = { agent_id: id, agent_type: a.type };
  plan(start, ts => s.hook(ts, 'PreToolUse', { tool_name: 'Agent', tool_input: c.input, tool_use_id: c.id }));
  plan(start + 150, ts => {
    s.hook(ts, 'SubagentStart', who);
    fs.mkdirSync(path.dirname(agent.file), { recursive: true });
    fs.writeFileSync(agent.file.replace(/\.jsonl$/, '.meta.json'), JSON.stringify({ agentType: a.type, description: c.input.description, toolUseId: c.id }));
    s.row(agent.file, ts, { type: 'user', isSidechain: true, agentId: id, message: { role: 'user', content: c.input.prompt } });
  });
  let t = runSteps(s, start + 300, a.steps, agent, plan);
  t += 1500;
  plan(t, ts => respond(s, agent, ts, a.report, [], 'end_turn'));
  plan(t + 150, ts => s.hook(ts, 'SubagentStop', { ...who, agent_transcript_path: agent.file, last_assistant_message: a.report, stop_hook_active: false }));
  plan(t + 300, ts => {
    s.hook(ts, 'PostToolUse', { tool_name: 'Agent', tool_input: c.input, tool_response: toolResponse(s, c), tool_use_id: c.id });
    s.row(s.transcript, ts, { type: 'user', isSidechain: false, toolUseResult: { status: 'completed', agentId: id },
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: c.id, content: [{ type: 'text', text: a.report }] }] } });
    s.ctx += tok(a.report) + 20;
  });
  return t + 300;
}

function start(s, t, plan, instructions) {
  plan(t, ts => {
    s.hook(ts, 'SessionStart', { source: 'startup', model: MODEL, permission_mode: 'default' });
    s.hook(ts + 120, 'InstructionsLoaded', { file_path: s.abs('CLAUDE.md'), memory_type: 'Project', load_reason: 'session_start' });
    s.row(s.transcript, ts + 150, { type: 'attachment', attachment: { type: 'instructions', files: [{ path: s.abs('CLAUDE.md'), type: 'Project', content: instructions }] } });
  });
  return t + 400;
}
function playTurn(s, t, turn, plan) {
  plan(t, ts => {
    s.hook(ts, 'UserPromptSubmit', { prompt: turn.prompt, permission_mode: 'default' });
    s.row(s.transcript, ts, { type: 'user', isSidechain: false, message: { role: 'user', content: turn.prompt } });
    s.ctx += tok(turn.prompt);
  });
  t = runSteps(s, t + 200, turn.steps, null, plan);
  t += 1200 + Math.min(4000, turn.reply.length * 12);
  plan(t, ts => respond(s, null, ts, turn.reply, [], 'end_turn'));
  plan(t + 250, ts => s.hook(ts, 'Stop', { stop_hook_active: false, last_assistant_message: turn.reply }));
  return t + 250;
}
// write a whole session at once, ending at `endAt` (ms since epoch)
function writeSession(s, turns, endAt, { instructions, ended } = {}) {
  const ops = [], plan = (t, f) => ops.push([t, f]);
  let t = start(s, 0, plan, instructions || '');
  for (const turn of turns) t = playTurn(s, t + (turn.gap ?? 45000), turn, plan) ;
  if (ended) plan(t + 30000, ts => s.hook(ts, 'SessionEnd', { reason: 'prompt_input_exit' }));
  const shift = endAt - t;
  ops.sort((a, b) => a[0] - b[0]);
  for (const [x, f] of ops) f(x + shift);
}

// ---------------------------------------------------------------- the made-up project: orders-api
// A .NET order service with a React client in web/. Every path, command and output below is invented.
const bash = (command, out, more = {}) => ({ tool: 'Bash', input: { command, description: more.description || '' }, out, ...more });
const ORDERS = session('orders-api', 'd6a1c4e2-7b39-4f0a-9c55-2e81f0b3a7d4');
const P = ORDERS.abs;

const ORDER_SERVICE = `using Microsoft.EntityFrameworkCore;
using Orders.Api.Data;
using Orders.Api.Domain;

namespace Orders.Api.Services;

public class OrderService(OrdersDbContext db, IShippingRates shipping)
{
    public async Task<Order> GetAsync(int id) =>
        await db.Orders.Include(o => o.Lines).SingleAsync(o => o.Id == id);

    public decimal CalculateTotal(Order order)
    {
        var subtotal = order.Lines.Sum(l => l.UnitPrice * l.Quantity);
        var shippingCost = shipping.For(order.Country, order.Lines.Count);
        return subtotal + shippingCost;
    }
}`;
const DISCOUNT_TESTS = `using Orders.Api.Services;

namespace Orders.Api.Tests;

public class DiscountTests
{
    [Fact] public void Under200_NoDiscount() => Assert.Equal(0m, OrderService.ApplyDiscount(150m));
    [Fact] public void Over200_TenPercent() => Assert.Equal(25m, OrderService.ApplyDiscount(250m));

    [Fact]
    public void Exactly200_NoDiscount()
    {
        var order = TestOrders.WithSubtotal(200m, country: "DE");
        Assert.Equal(204.90m, TestOrders.Service().CalculateTotal(order));
    }
}`;
const BUILD = `  Determining projects to restore...
  All projects are up-to-date for restore.
  Orders.Api -> ${P('src/Orders.Api/bin/Debug/net8.0/Orders.Api.dll')}
  Orders.Api.Tests -> ${P('tests/Orders.Api.Tests/bin/Debug/net8.0/Orders.Api.Tests.dll')}
Test run for Orders.Api.Tests.dll (.NETCoreApp,Version=v8.0)
Starting test execution, please wait...`;
const TEST_FAIL = `Exit code 1
${BUILD}
  Failed Orders.Api.Tests.DiscountTests.Exactly200_NoDiscount [9 ms]
  Error Message:
   Assert.Equal() Failure: Values differ
Expected: 204.90
Actual:   184.90
  Stack Trace:
     at Orders.Api.Tests.DiscountTests.Exactly200_NoDiscount() in ${P('tests/Orders.Api.Tests/DiscountTests.cs')}:line 14

Failed!  - Failed:     1, Passed:     2, Skipped:     0, Total:     3, Duration: 38 ms - Orders.Api.Tests.dll (net8.0)`;

const ordersTurns = [
  {
    prompt: 'Add a 10% discount to OrderService for orders over 200 EUR and cover it with tests',
    gap: 0,
    steps: [
      { say: "I'll find where the order total is calculated.", calls: [
        { tool: 'Grep', input: { pattern: 'CalculateTotal', path: 'src', output_mode: 'content', '-n': true },
          out: 'src/Orders.Api/Services/OrderService.cs:12:    public decimal CalculateTotal(Order order)\nsrc/Orders.Api/Controllers/OrdersController.cs:41:        var total = orders.CalculateTotal(order);\nsrc/Orders.Api/Controllers/CartController.cs:27:        return Ok(new { total = orders.CalculateTotal(cart.ToOrder()) });' }] },
      { calls: [{ tool: 'Read', input: { file_path: P('src/Orders.Api/Services/OrderService.cs') }, out: ORDER_SERVICE }] },
      { say: '`CalculateTotal` sums the lines and adds shipping. The discount goes on the subtotal, before shipping, in a static `ApplyDiscount` so it can be tested on its own.', calls: [
        { tool: 'Edit', input: { file_path: P('src/Orders.Api/Services/OrderService.cs'),
          old_string: '        return subtotal + shippingCost;\n    }',
          new_string: '        return subtotal - ApplyDiscount(subtotal) + shippingCost;\n    }\n\n    public const decimal DiscountThreshold = 200m;\n    public const decimal DiscountRate = 0.10m;\n\n    public static decimal ApplyDiscount(decimal subtotal) =>\n        subtotal >= DiscountThreshold ? Math.Round(subtotal * DiscountRate, 2) : 0m;' } }] },
      { calls: [{ tool: 'Write', input: { file_path: P('tests/Orders.Api.Tests/DiscountTests.cs'), content: DISCOUNT_TESTS } }] },
      { calls: [bash('dotnet test tests/Orders.Api.Tests --filter DiscountTests', '', { description: 'Run the discount tests', ms: 6400, fail: TEST_FAIL })] },
      { say: 'An order of exactly 200 got the discount, but the rule says over 200. Changing `>=` to `>`.', calls: [
        { tool: 'Edit', input: { file_path: P('src/Orders.Api/Services/OrderService.cs'),
          old_string: 'subtotal >= DiscountThreshold', new_string: 'subtotal > DiscountThreshold' } }] },
      { calls: [bash('dotnet test tests/Orders.Api.Tests --filter DiscountTests', `${BUILD}\n\nPassed!  - Failed:     0, Passed:     3, Skipped:     0, Total:     3, Duration: 35 ms - Orders.Api.Tests.dll (net8.0)`, { description: 'Run the discount tests again', ms: 5900 })] },
    ],
    reply: 'Added the discount: orders with a subtotal over €200 get 10% off before shipping (`OrderService.ApplyDiscount`, used by `CalculateTotal`).\n\nThree tests in `DiscountTests.cs` cover under, exactly at and over the threshold, and all pass. The first run caught a `>=` that should have been `>`, so an order of exactly €200 no longer gets the discount.',
  },
  {
    prompt: 'Use two Explore subagents in parallel: one to find every place we validate order input, the other to find EF Core queries that are missing AsNoTracking. Then list the three worst findings.',
    gap: 70000,
    steps: [
      { say: 'Starting both searches in parallel.', calls: [
        { tool: 'Agent', input: { subagent_type: 'Explore', description: 'Find order input validation', prompt: 'Find every place in src/ where order input is validated: FluentValidation validators, data annotations, and manual checks in controllers or services. Report file:line and what each one checks. Read-only.' },
          agent: { type: 'Explore', steps: [
            { calls: [{ tool: 'Grep', input: { pattern: 'AbstractValidator|\\[Required\\]|\\[Range', path: 'src', output_mode: 'content', '-n': true },
              out: 'src/Orders.Api/Validation/CreateOrderValidator.cs:6:public class CreateOrderValidator : AbstractValidator<CreateOrderRequest>\nsrc/Orders.Api/Contracts/CreateOrderRequest.cs:8:    [Required] public string Country { get; init; } = "";\nsrc/Orders.Api/Contracts/OrderLineDto.cs:5:    [Range(1, 999)] public int Quantity { get; init; }' }] },
            { calls: [{ tool: 'Read', input: { file_path: P('src/Orders.Api/Validation/CreateOrderValidator.cs') },
              out: 'using FluentValidation;\n\nnamespace Orders.Api.Validation;\n\npublic class CreateOrderValidator : AbstractValidator<CreateOrderRequest>\n{\n    public CreateOrderValidator()\n    {\n        RuleFor(o => o.Country).Length(2);\n        RuleFor(o => o.Lines).NotEmpty();\n        RuleForEach(o => o.Lines).ChildRules(l => l.RuleFor(x => x.UnitPrice).GreaterThan(0));\n    }\n}' }] },
            { calls: [{ tool: 'Grep', input: { pattern: 'Validate|ModelState|BadRequest', path: 'src/Orders.Api/Controllers', output_mode: 'content', '-n': true },
              out: 'src/Orders.Api/Controllers/OrdersController.cs:24:        var check = await validator.ValidateAsync(request);\nsrc/Orders.Api/Controllers/OrdersController.cs:25:        if (!check.IsValid) return BadRequest(check.ToDictionary());\nsrc/Orders.Api/Controllers/OrdersController.cs:58:        if (request.Lines.Any(l => l.Quantity <= 0)) return BadRequest();' }] },
            { calls: [{ tool: 'Read', input: { file_path: P('src/Orders.Api/Controllers/OrdersController.cs') },
              out: '[ApiController]\n[Route("orders")]\npublic class OrdersController(OrderService orders, IValidator<CreateOrderRequest> validator) : ControllerBase\n{\n    [HttpPost]\n    public async Task<IActionResult> Create(CreateOrderRequest request)\n    {\n        var check = await validator.ValidateAsync(request);\n        if (!check.IsValid) return BadRequest(check.ToDictionary());\n        ...\n    }\n\n    [HttpPut("{id}")]\n    public async Task<IActionResult> Update(int id, CreateOrderRequest request)\n    {\n        if (request.Lines.Any(l => l.Quantity <= 0)) return BadRequest();\n        ...\n    }\n}' }] },
          ], report: 'Order input is validated in three places:\n\n- `CreateOrderValidator.cs:6`: country is 2 letters, at least one line, unit price > 0.\n- Data annotations: `[Required]` Country, `[Range(1, 999)]` Quantity.\n- `OrdersController.cs:58`: `Update` skips the validator and only checks Quantity > 0, so an update can set a negative price or an empty country.' } },
        { tool: 'Agent', input: { subagent_type: 'Explore', description: 'Find EF Core queries without AsNoTracking', prompt: 'Find EF Core read-only queries in src/Orders.Api that load entities with change tracking (no AsNoTracking) or could be N+1. Report file:line and how much data each one loads. Read-only.' },
          agent: { type: 'Explore', steps: [
            { calls: [{ tool: 'Grep', input: { pattern: 'ToListAsync|SingleAsync|FirstOrDefaultAsync', path: 'src/Orders.Api', output_mode: 'content', '-n': true },
              out: 'src/Orders.Api/Data/OrderRepository.cs:18:            .ToListAsync();\nsrc/Orders.Api/Data/OrderRepository.cs:31:            .SingleAsync(o => o.Id == id);\nsrc/Orders.Api/Services/ReportService.cs:22:        var orders = await db.Orders.Include(o => o.Lines).ToListAsync();\nsrc/Orders.Api/Services/OrderService.cs:10:        await db.Orders.Include(o => o.Lines).SingleAsync(o => o.Id == id);' }] },
            { calls: [{ tool: 'Read', input: { file_path: P('src/Orders.Api/Services/ReportService.cs') },
              out: 'public class ReportService(OrdersDbContext db)\n{\n    public async Task<IReadOnlyList<MonthTotal>> MonthlyTotals(int year)\n    {\n        var orders = await db.Orders.Include(o => o.Lines).ToListAsync();\n        return orders.Where(o => o.CreatedAt.Year == year)\n            .GroupBy(o => o.CreatedAt.Month)\n            .Select(g => new MonthTotal(g.Key, g.Sum(o => o.Lines.Sum(l => l.UnitPrice * l.Quantity))))\n            .ToList();\n    }\n}' }] },
            { calls: [{ tool: 'Read', input: { file_path: P('src/Orders.Api/Data/OrderRepository.cs') },
              out: 'public async Task<List<Order>> Search(string? customer)\n{\n    var orders = await db.Orders\n        .Where(o => customer == null || o.Customer == customer)\n        .ToListAsync();\n    foreach (var o in orders)\n        await db.Entry(o).Collection(x => x.Lines).LoadAsync();\n    return orders;\n}' }] },
            { calls: [bash('git log --oneline -3 -- src/Orders.Api/Data src/Orders.Api/Services/ReportService.cs', '9c1e4d2 Monthly totals report\n41b7a90 Order search by customer\n0e5f3c8 Initial EF Core model', { description: 'Recent history of the data layer', ms: 180 })] },
          ], report: 'Read-only queries with tracking:\n\n- `ReportService.cs:22` `MonthlyTotals` loads every order and line with tracking, then filters by year in memory.\n- `OrderRepository.cs:18` `Search` tracks all matches, then loads each order\'s lines in its own query (N+1).\n- `OrderService.cs:10` `GetAsync` tracks one order; fine for writes, but it is also used for reads.' } },
      ] },
    ],
    reply: 'The three worst:\n\n1. `OrdersController.Update` skips the validator. It only checks Quantity > 0, so an update can set a negative price or an empty country. Use `CreateOrderValidator` there too.\n2. `ReportService.MonthlyTotals` loads every order with tracking, then filters by year in memory. Filter in the query, project to totals, and add `AsNoTracking()`.\n3. `OrderRepository.Search` is N+1: one query per order for its lines. Use `Include(o => o.Lines)` with `AsNoTracking()`.',
  },
  {
    prompt: 'Which code paths end up calling ApplyDiscount? Use the code graph.',
    gap: 90000,
    steps: [
      { say: 'Looking it up in the code graph.', calls: [
        { tool: 'mcp__codebase-memory-mcp__search_graph', input: { name_pattern: 'ApplyDiscount', label: 'Method' },
          out: JSON.stringify({ results: [{ name: 'ApplyDiscount', qualified_name: 'Orders.Api.Services.OrderService.ApplyDiscount', label: 'Method', file: 'src/Orders.Api/Services/OrderService.cs', line: 22 }], total: 1 }, null, 2) }] },
      { calls: [
        { tool: 'mcp__codebase-memory-mcp__trace_path', input: { function_name: 'Orders.Api.Services.OrderService.ApplyDiscount', mode: 'calls', direction: 'inbound', depth: 3 }, ms: 950,
          out: JSON.stringify({ root: 'OrderService.ApplyDiscount', direction: 'inbound', paths: [
            { depth: 1, caller: 'OrderService.CalculateTotal', file: 'src/Orders.Api/Services/OrderService.cs', line: 16 },
            { depth: 2, caller: 'OrdersController.Create', file: 'src/Orders.Api/Controllers/OrdersController.cs', line: 41, route: 'POST /orders' },
            { depth: 2, caller: 'CartController.Preview', file: 'src/Orders.Api/Controllers/CartController.cs', line: 27, route: 'GET /cart/preview' },
            { depth: 2, caller: 'InvoiceJob.Run', file: 'src/Orders.Api/Jobs/InvoiceJob.cs', line: 33 },
          ], total: 4 }, null, 2) }] },
    ],
    reply: '`ApplyDiscount` is only called by `CalculateTotal`, which is reached from three places:\n\n- `POST /orders` (`OrdersController.Create`)\n- `GET /cart/preview` (`CartController.Preview`), so the cart shows the discount before checkout\n- `InvoiceJob.Run`, the nightly invoice job\n\nThe invoice job also recalculates old orders, so orders placed before today will get the discount on their invoice. Worth deciding whether it should use the stored total instead.',
  },
  {
    prompt: 'Open the web client on localhost:5173, check that the order summary shows the discount line, and record a short GIF of it',
    gap: 120000,
    steps: [
      { calls: [{ tool: 'Skill', input: { skill: 'claude-in-chrome' } }] },
      { calls: [{ tool: 'mcp__claude-in-chrome__tabs_context_mcp', input: { createIfEmpty: true }, out: 'Tab group: 1 tab\n- 2148 "New Tab" (chrome://newtab/)' }] },
      { calls: [{ tool: 'mcp__claude-in-chrome__navigate', input: { tabId: 2148, url: 'http://localhost:5173/orders/1042' }, ms: 1300, out: 'Navigated to http://localhost:5173/orders/1042 ("Order #1042 · Orders")' }] },
      { calls: [{ tool: 'mcp__claude-in-chrome__gif_creator', input: { action: 'start_recording', tabId: 2148 }, out: 'Recording started for tab 2148.' }] },
      { calls: [{ tool: 'mcp__claude-in-chrome__computer', input: { action: 'screenshot', tabId: 2148 }, ms: 900, out: 'Screenshot captured (1280×800).' }] },
      { say: 'The summary shows subtotal and shipping but no discount line. The order is €212.40, so it should have one.', calls: [
        { tool: 'mcp__claude-in-chrome__find', input: { tabId: 2148, query: 'order summary totals' }, out: 'Found 1 match: section "Order summary" [ref_31] with rows Subtotal €212.40, Shipping €4.90, Total €217.30' }] },
      { calls: [{ tool: 'mcp__claude-in-chrome__computer', input: { action: 'left_click', tabId: 2148, ref: 'ref_31' }, out: 'Clicked ref_31.' }] },
      { calls: [{ tool: 'mcp__claude-in-chrome__computer', input: { action: 'screenshot', tabId: 2148 }, ms: 900, out: 'Screenshot captured (1280×800).' }] },
      { calls: [{ tool: 'mcp__claude-in-chrome__gif_creator', input: { action: 'export', tabId: 2148, filename: 'order-1042-summary.gif' }, ms: 2400, out: 'Exported 14 frames to order-1042-summary.gif (412 KB).' }] },
      { calls: [{ tool: 'mcp__claude-in-chrome__tabs_close_mcp', input: { tabId: 2148 }, out: 'Closed tab 2148.' }] },
    ],
    reply: "The web client doesn't show the discount yet. Order #1042 has a €212.40 subtotal; the API now returns €196.06 + €4.90 shipping, but the summary still shows subtotal, shipping and the old total of €217.30. `OrderSummary.tsx` computes the total itself instead of using the one from the API.\n\nThe recording is in `order-1042-summary.gif`.",
  },
  {
    prompt: 'Show the discount in the web client too, then rebuild everything and redeploy to staging',
    gap: 80000,
    steps: [
      { say: 'The client should show the API\'s numbers, not compute its own.', calls: [
        { tool: 'Edit', input: { file_path: P('web/src/components/OrderSummary.tsx'),
          old_string: '  const total = order.subtotal + order.shipping;\n  return (\n    <dl className="summary">',
          new_string: '  return (\n    <dl className="summary">\n      {order.discount > 0 && <Row label="Discount (10%)" value={-order.discount} />}' } }] },
      { calls: [{ tool: 'Edit', input: { file_path: P('web/src/api/orders.ts'), old_string: '  shipping: number;\n  total: number;', new_string: '  shipping: number;\n  discount: number;\n  total: number;' } }] },
      { calls: [{ tool: 'Read', input: { file_path: P('web/package.json') }, out: '{\n  "name": "orders-web",\n  "private": true,\n  "scripts": {\n    "dev": "vite",\n    "build": "tsc -b && vite build",\n    "test": "vitest run"\n  }\n}' }] },
      { calls: [{ tool: 'Read', input: { file_path: P('Dockerfile') }, out: 'FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build\nWORKDIR /src\nCOPY . .\nRUN dotnet publish src/Orders.Api -c Release -o /out\n\nFROM mcr.microsoft.com/dotnet/aspnet:8.0\nWORKDIR /app\nCOPY --from=build /out .\nCOPY web/dist ./wwwroot\nENTRYPOINT ["dotnet", "Orders.Api.dll"]' }] },
      { calls: [{ tool: 'Edit', input: { file_path: P('deploy/values.staging.yaml'), old_string: '  tag: "1.8.3"', new_string: '  tag: "1.9.0"' } }] },
      { calls: [bash('cd web && npm ci && npm run build', 'added 312 packages in 6s\n\n> orders-web@1.9.0 build\n> tsc -b && vite build\n\nvite v5.4.2 building for production...\n✓ 148 modules transformed.\ndist/index.html                  0.46 kB\ndist/assets/index-4f2c1a9e.css   7.91 kB\ndist/assets/index-b83d07e1.js  164.22 kB\n✓ built in 2.31s', { description: 'Build the web client', ms: 7400 })] },
      { calls: [bash('git stash && dotnet test && git stash pop', `Saved working directory and index state WIP on main: 9c1e4d2 Monthly totals report\n${BUILD}\n\nPassed!  - Failed:     0, Passed:    46, Skipped:     0, Total:    46, Duration: 1 s - Orders.Api.Tests.dll (net8.0)`, { description: 'Run all tests on a clean tree', ms: 6800 })] },
      { calls: [bash('git pull --rebase &&\n  npm --prefix web ci &&\n  dotnet publish -c Release -o out &&\n  docker build -t orders-api:1.9.0 . &&\n  kubectl rollout restart deploy/orders-api', 'Successfully built orders-api:1.9.0\ndeployment.apps/orders-api restarted', { description: 'Publish, build the image and restart staging', ms: 15800 })] },
      { calls: [bash('python3 scripts/smoke_check.py --env staging', 'GET /health            200   18 ms\nGET /orders/1042       200   41 ms   total 200.96 (discount 21.24)\nGET /cart/preview      200   37 ms\n3 checks passed', { description: 'Smoke-test staging', ms: 3100 })] },
      { calls: [bash('git add -A && git commit -m "Order discount over 200 EUR" && gh pr create --fill', '[feature/order-discount 7d2e9a1] Order discount over 200 EUR\n 6 files changed, 41 insertions(+), 4 deletions(-)\nhttps://git.example.com/acme/orders-api/pull/87', { description: 'Commit and open a PR', ms: 2600 })] },
    ],
    reply: 'Web client updated: the order summary shows a "Discount (10%)" line and takes the total from the API instead of adding it up itself.\n\nImage `orders-api:1.9.0` is built and running on staging, and the smoke check passes (order #1042 now totals €200.96 with a €21.24 discount). PR #87 is open.',
  },
];

// two earlier sessions in other projects, already ended
const STORE = session('storefront', '3f9b2d70-1c8e-4a55-b0d2-6e4f7a9c1b38');
const storeTurns = [{
  prompt: 'Make the header sticky on scroll', gap: 0,
  steps: [
    { calls: [{ tool: 'Glob', input: { pattern: 'src/components/Header*' }, out: 'src/components/Header.tsx\nsrc/components/Header.module.css' }] },
    { calls: [{ tool: 'Read', input: { file_path: STORE.abs('src/components/Header.module.css') }, out: '.header {\n  display: flex;\n  align-items: center;\n  padding: 12px 24px;\n  background: var(--surface);\n}' }] },
    { calls: [{ tool: 'Edit', input: { file_path: STORE.abs('src/components/Header.module.css'), old_string: '  background: var(--surface);\n}', new_string: '  background: var(--surface);\n  position: sticky;\n  top: 0;\n  z-index: 10;\n}' } }] },
    { calls: [bash('npm run lint', '> storefront@2.3.0 lint\n> eslint src\n\n✔ No problems found', { description: 'Lint', ms: 3900 })] },
  ],
  reply: 'The header is sticky now: `position: sticky; top: 0` with a z-index above the page content. Lint passes.',
}];
const INFRA = session('infra', '8c2e5a91-4d7f-4b13-a6e0-f1d3b97c2e05');
const infraTurns = [{
  prompt: 'Bump Node to 22 in the CI workflow', gap: 0,
  steps: [
    { calls: [{ tool: 'Read', input: { file_path: INFRA.abs('.github/workflows/ci.yml') }, out: 'name: CI\non: [push, pull_request]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 20\n      - run: npm ci && npm test' }] },
    { calls: [{ tool: 'Edit', input: { file_path: INFRA.abs('.github/workflows/ci.yml'), old_string: 'node-version: 20', new_string: 'node-version: 22' } }] },
    { calls: [bash('git diff --stat', ' .github/workflows/ci.yml | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)', { description: 'Check the change', ms: 120 })] },
  ],
  reply: 'CI now runs on Node 22 (`actions/setup-node`, `node-version: 22`).',
}];

const CLAUDE_MD = '# orders-api\n\n.NET 8 order service (`src/Orders.Api`) with a React client in `web/`.\n\n- Run tests with `dotnet test`; the web client with `npm --prefix web test`.\n- EF Core: read-only queries use `AsNoTracking()`.\n- Staging deploys go through `deploy/values.staging.yaml`.';
const now = Date.now();
writeSession(INFRA, infraTurns, now - 5.2 * 3600e3, { ended: true, instructions: '# infra\n\nCI and deployment config.' });
writeSession(STORE, storeTurns, now - 3.1 * 3600e3, { ended: true, instructions: '# storefront\n\nNext.js shop front. `npm run lint` before committing.' });
writeSession(ORDERS, ordersTurns, now - 7 * 60e3, { instructions: CLAUDE_MD });

// ---------------------------------------------------------------- server + a session that keeps working
const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
  stdio: 'inherit', env: { ...process.env, OBSERVER_PORT: String(PORT), OBSERVER_DATA_DIR: DIR },
});
process.on('SIGINT', () => { server.kill(); process.exit(0); });
process.on('exit', () => server.kill());

const LIVE = session('billing-service', 'b41d7e08-92c6-4e3a-8f15-0a7c3d6e2b94');
const liveTurns = [
  { prompt: 'Add rate limiting to the public invoice endpoints',
    steps: [
      { say: "I'll check how the routes are wired first.", calls: [{ tool: 'Grep', input: { pattern: 'router\\.(get|post)', path: 'src/routes', output_mode: 'content', '-n': true }, out: 'src/routes/invoices.ts:12:router.get("/invoices/:id", getInvoice);\nsrc/routes/invoices.ts:13:router.post("/invoices/:id/pay", payInvoice);' }] },
      { calls: [{ tool: 'Read', input: { file_path: LIVE.abs('src/app.ts') }, out: 'import express from "express";\nimport { invoices } from "./routes/invoices";\n\nexport const app = express();\napp.use(express.json());\napp.use("/api", invoices);' }] },
      { calls: [{ tool: 'Edit', input: { file_path: LIVE.abs('src/app.ts'), old_string: 'app.use("/api", invoices);', new_string: 'app.use("/api", rateLimit({ windowMs: 60_000, limit: 120 }), invoices);' } }] },
      { calls: [bash('npm test -- invoices', 'PASS  test/invoices.test.ts\n  ✓ returns an invoice (31 ms)\n  ✓ pays an invoice (22 ms)\n  ✓ answers 429 after 120 requests a minute (140 ms)\n\nTests: 3 passed, 3 total', { description: 'Run the invoice tests', ms: 4200 })] },
    ],
    reply: 'The public invoice routes are limited to 120 requests a minute per IP (`express-rate-limit` in `src/app.ts`). A test checks the 429.' },
  { prompt: 'Keep the limiter counters in Redis so it works across instances',
    steps: [
      { say: 'Checking how Redis is used elsewhere before wiring the store.', calls: [{ tool: 'Agent', input: { subagent_type: 'Explore', description: 'Find Redis usage', prompt: 'Find where the app creates a Redis client and how it is configured. Read-only.' },
        agent: { type: 'Explore', steps: [
          { calls: [{ tool: 'Grep', input: { pattern: 'createClient|REDIS_URL', path: 'src', output_mode: 'content', '-n': true }, out: 'src/lib/redis.ts:3:export const redis = createClient({ url: process.env.REDIS_URL });' }] },
          { calls: [{ tool: 'Read', input: { file_path: LIVE.abs('src/lib/redis.ts') }, out: 'import { createClient } from "redis";\n\nexport const redis = createClient({ url: process.env.REDIS_URL });\nawait redis.connect();' }] },
        ], report: 'One shared client in `src/lib/redis.ts`, from `REDIS_URL`, connected at start-up.' } }] },
      { calls: [{ tool: 'Edit', input: { file_path: LIVE.abs('src/app.ts'), old_string: 'rateLimit({ windowMs: 60_000, limit: 120 })', new_string: 'rateLimit({ windowMs: 60_000, limit: 120, store: new RedisStore({ sendCommand: (...a) => redis.sendCommand(a) }) })' } }] },
      { calls: [bash('docker compose up -d redis && npm test -- invoices', 'Container billing-redis-1  Started\nPASS  test/invoices.test.ts\n\nTests: 3 passed, 3 total', { description: 'Start Redis and run the tests', ms: 6100 })] },
    ],
    reply: 'The limiter now keeps its counters in Redis through the shared client in `src/lib/redis.ts`, so all instances share one limit. Tests pass against the local Redis container.' },
];
(async () => {
  await new Promise(r => setTimeout(r, 1500));
  console.log(`Demo running → http://localhost:${PORT}  (Ctrl+C to stop)`);
  const ops = [], plan = (t, f) => ops.push([t, f]);
  let t = start(LIVE, 0, plan, '# billing-service\n\nExpress + TypeScript API for invoices.');
  for (let k = 0; k < 6; k++) t = playTurn(LIVE, t + 8000, liveTurns[k % liveTurns.length], plan);
  ops.sort((a, b) => a[0] - b[0]);
  let prev = 0;
  for (const [x, f] of ops) { await new Promise(r => setTimeout(r, x - prev)); prev = x; f(Date.now()); }
})();
