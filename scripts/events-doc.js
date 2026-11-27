#!/usr/bin/env node
// Writes docs/events.md from the event contract (server/lib/building-blocks/event-contract.js), so the doc can't
// drift from the code. `--check`: write nothing, exit 1 when the doc is out of date (test/check.js runs this).
// Usage: node scripts/events-doc.js [--check]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { CONTRACT_VERSION, ENVELOPE, EVENTS } = require('../server/lib/building-blocks/event-contract');

const DOC = path.join(__dirname, '..', 'docs', 'events.md');

// a table cell's text: backslashes first, then the pipes that would end the cell
const cell = text => String(text).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
const fieldRows = fields => Object.entries(fields)
  .map(([name, spec]) => `| \`${name}\` | ${spec.type} | ${spec.required ? 'yes' : ''} | ${cell(spec.about)} |`);
const fieldTable = fields => ['| Field | Type | Always | What it holds |', '| --- | --- | --- | --- |', ...fieldRows(fields)];
const AGENT_WORDS = { server: 'the server', translated: 'agents with a translation' };
const agentList = agents => agents.map(agent => AGENT_WORDS[agent] || `\`${agent}\``).join(', ');

function render() {
  const lines = [
    '# Events',
    '',
    '<!-- Written by `node scripts/events-doc.js` from server/lib/building-blocks/event-contract.js. Do not edit by hand. -->',
    '',
    `Every line of a session log is one event. This is the contract (version ${CONTRACT_VERSION}) the server and the`,
    "dashboard read. Each agent's own events are turned into these; anything else an agent sends is kept as it came,",
    'and an event or field the contract doesn\'t know is never an error.',
    '',
    '## When events change',
    '',
    "- **An agent changes its own events:** only that agent's translation changes; this contract stays.",
    '- **Adding an event or an optional field** is free.',
    '- **Renaming or removing one** bumps the contract version, which each event stores as `v`. The server keeps',
    '  reading older events, because logs are kept for days.',
    '- This file is generated: change `event-contract.js`, then run `node scripts/events-doc.js`.',
    '  `node test/check.js` fails when the two differ.',
    '',
    '## The line',
    '',
    ...fieldTable(ENVELOPE),
    '',
    '## Events',
    '',
    '| Event | Category | Sent by | What happens |',
    '| --- | --- | --- | --- |',
    ...Object.entries(EVENTS).map(([name, spec]) =>
      `| [\`${name}\`](#${name.toLowerCase()}) | ${spec.category || 'from the tool'} | ${agentList(spec.agents)} | ${cell(spec.about)} |`),
  ];
  for (const [name, spec] of Object.entries(EVENTS)) {
    lines.push('', `### ${name}`, '', spec.about, '');
    lines.push(`Category: ${spec.category || 'from the tool it calls'}. Sent by ${agentList(spec.agents)}.`);
    if (Object.keys(spec.fields).length) lines.push('', ...fieldTable(spec.fields));
  }
  return lines.join('\r\n') + '\r\n';
}

const sameText = (a, b) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');

function isUpToDate() {
  try { return sameText(fs.readFileSync(DOC, 'utf8'), render()); } catch { return false; }
}

if (require.main === module) {
  if (process.argv.includes('--check')) {
    if (!isUpToDate()) {
      console.error('docs/events.md is out of date: run node scripts/events-doc.js');
      process.exit(1);
    }
  } else {
    fs.writeFileSync(DOC, render());
    console.log(`wrote ${path.relative(process.cwd(), DOC)}`);
  }
}

module.exports = { render, isUpToDate };
