'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('repeated subagent starts keep their lane and a restart gets a separate branch', () => {
  const agent = { agent_id: 'same-id', agent_type: 'Explore' };
  const call = description => ({ tool_name: 'Agent', tool_input: { description } });
  const events = [
    ['PreToolUse', call('first task')],
    ['SubagentStart', agent],
    ['ModelStep', { ...agent, subagent: true }],
    ['PreToolUse', call('second task')],
    ['SubagentStart', agent],
    ['SubagentStop', agent],
    ['SubagentStart', agent],
    ['ModelText', { ...agent, subagent: true, text: 'second branch text' }],
    ['SubagentStop', agent],
    ['Stop', {}],
  ].map(([event, data], seq) => ({ event, data, seq, ts: new Date(seq * 1000).toISOString() }));
  const turn = { key: 'test:1', start: events[0].ts, events };
  const context = vm.createContext({
    turn, activity: { runningTools: new Map(), runningSubagents: new Map() },
    eventTime: event => Date.parse(event.ts), eventTooltip: () => '', toolGroupOfEvent: () => null,
    firstTechOfEvent: () => null, techsOfEvent: () => [], toolDisplayName: name => name,
    toolArgument: () => '', isSubagentCall: name => name === 'Agent', formatDuration: String,
    TEXT: { subagentLc: 'subagent', backX: String },
  });
  for (const file of ['model.js', 'render/draw.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../server/dashboard/features/route', file), 'utf8');
    vm.runInContext(source, context, { filename: file });
  }
  const result = vm.runInContext(`
    updateOpenTurns([turn], turn);
    const { stops, models } = collectRouteStops([turn], 10000);
    const rows = layoutRows([turn], stops, 160);
    const height = placeRowsVertically(rows, stops, routeLinks(stops));
    const { branches } = models.get(turn.key);
    const forkStops = stops.filter(stop => stop.startsBranch);
    ({ height, branches, forkStops, laneKeys: new Set(forkStops.map(lineKeyOfStop)),
      finiteStops: stops.every(stop => Number.isFinite(stop.lane) && Number.isFinite(stop.y)),
      firstStepText: stops.find(stop => stop.isStep).text });
  `, context);
  assert.equal(result.branches.length, 2);
  assert.deepEqual(Array.from(result.forkStops, stop => stop.detail), ['first task', 'second task']);
  assert.equal(result.laneKeys.size, 2);
  assert.equal(result.firstStepText, undefined, 'text from the restarted branch must not attach to the first branch');
  assert.ok(result.finiteStops);
  assert.ok(Number.isFinite(result.height));
});
