#!/usr/bin/env node
// Starts a new agent: creates server/lib/features/agents/<id>/ from a template (manifest, tool map, translation, server
// hooks, FIDELITY.md, an empty fixtures.json) and adds the id to AGENT_IDS in the registry. The conformance test
// (test/agents.test.js) then fails until the folder has a recorded session: that failure is the to-do list.
// The steps after it are in docs/adding-an-agent.md.
// Usage: node scripts/new-agent.js <id> "<Product name>"
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const AGENTS_DIR = path.join(__dirname, '..', 'server', 'lib', 'features', 'agents');
const crlf = text => text.replace(/\r?\n/g, '\r\n');

const templates = (id, name) => ({
  'manifest.js': `// ${name}: how its events reach the log (capture/), and what makes it differ from Claude Code.
'use strict';

module.exports = {
  id: '${id}',
  name: '${name}', // product names: the same in every language
  shortName: '${name}', // over its replies in the chat
  color: { light: '#5b5f97', dark: '#a9adf0' }, // its tag and badge colour, light and dark theme
  command: '${id}', // the command word that starts it, to link sessions it starts from a shell call
  capture: 'in-process plugin', // or 'hook commands'
  runtime: 'node', // or 'bun': the dashboard server is then started with the node on PATH
  parentEnv: null, // { session: ['ITS_SESSION_ID_VARIABLE'], toolCall?: 'ITS_TOOL_CALL_ID_VARIABLE' }
  reportsContextWindow: true, // its steps carry model_context_window
  statusLineContext: false,
  autocompactBuffer: false,
  contextNoteKey: null, // a TEXT key for a note over its Context view
};
`,
  'tools.js': `// ${name}'s tools: which part of the dashboard's map each belongs to, what role it plays, and where its input names
// a file. Use the agent's own tool names, as it reports them.
'use strict';

module.exports = {
  groups: {
    files: [], // work on files
    shell: [], // run or watch shell commands
  },
  roles: {
    command: [], // run input.command in a shell
    subagentCall: [], // start a subagent
    subagent: [], // count as subagent activity
    question: [], // wait for your answer
    asyncQuestion: [], // ask, and also wait for your next message
    task: [], // a to-do or plan list
    patch: [], // edit files with a patch in their input
    read: [], // read the file they name
    edit: [], // change the file they name
  },
  pathFields: [], // where a file tool's input names its file, e.g. 'file_path'
};
`,
  'translate.js': `// ${name}'s own events, as contract events (docs/events.md). No I/O: \`emit(eventName, sessionId, data, { native,
// parents, ts })\` writes each one, so tests can feed it what ${name} sends. Keep each event's own as \`native\`; map what
// has a real equivalent, pass the rest through as AgentEvent, and list what you drop in FIDELITY.md.
'use strict';

function create${pascal(id)}Translator({ emit }) {
  return {
    // one handler per kind of event ${name} sends, e.g.:
    sessionStarted(native) {
      emit('SessionStart', native.sessionId, { source: 'startup', cwd: native.cwd || null }, { native: { event: 'session.started', data: native } });
    },
  };
}

module.exports = { create${pascal(id)}Translator };
`,
  'server.js': `// What the server does differently for ${name}. Every hook is optional; see claude/, codex/ and opencode/:
//   modelStepFrom(event) / addStepUsage(session, step): steps it reports itself (features/sessions/reported-steps.js)
//   sessionFiles(session) / readSessionFileRow(session, row, isSubagentFile, read): a session file to read
//   sessionContext(session): its Context view
'use strict';
const { isReportedStep, addReportedUsage } = require('../../sessions/reported-steps');

module.exports = {
  modelStepFrom: isReportedStep,
  addStepUsage: addReportedUsage,
  sessionContext: session => ({ error: "${name}'s Context view is not available yet.", transcript: null, session: session.id }),
};
`,
  'FIDELITY.md': `# ${name}: what is kept

How ${name}'s own events become contract events (\`translate.js\`). Every recorded event keeps ${name}'s own as \`native\`.

Checked against ${name} <version>.

## Mapped

| Contract event | From ${name} |
| --- | --- |

## Passed through as \`AgentEvent\`

## Dropped, and why

| What | Why |
| --- | --- |
`,
  'fixtures/fixtures.json': JSON.stringify({ agentVersion: `${name} <version>`, fixtures: [] }, null, 2) + '\n',
});

function pascal(id) {
  return id.split(/[^a-z0-9]+/i).filter(Boolean).map(part => part[0].toUpperCase() + part.slice(1)).join('');
}

// `agentsDir`: where the agent folders and registry.js are (tests use a copy)
function createAgent(id, name, agentsDir = AGENTS_DIR) {
  const registryFile = path.join(agentsDir, 'registry.js');
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`"${id}": use lower-case letters, digits and dashes, starting with a letter`);
  const dir = path.join(agentsDir, id);
  if (fs.existsSync(dir)) throw new Error(`server/lib/features/agents/${id}/ already exists`);
  const registry = fs.readFileSync(registryFile, 'utf8');
  const line = registry.match(/const AGENT_IDS = \[([^\]]*)\];/);
  if (!line) throw new Error('could not find AGENT_IDS in features/agents/registry.js');
  for (const [file, text] of Object.entries(templates(id, name))) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), crlf(text));
  }
  fs.writeFileSync(registryFile, registry.replace(line[0], `const AGENT_IDS = [${line[1]}, '${id}'];`));
  return dir;
}

if (require.main === module) {
  const [id, name] = process.argv.slice(2);
  if (!id || !name) {
    console.error('usage: node scripts/new-agent.js <id> "<Product name>"');
    process.exit(2);
  }
  try {
    const dir = createAgent(id, name);
    console.log(`Created ${path.relative(process.cwd(), dir)} and registered "${id}".`);
    console.log('Next: record a real session into fixtures/, then make node --test test/agents.test.js pass (docs/adding-an-agent.md).');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { createAgent };
