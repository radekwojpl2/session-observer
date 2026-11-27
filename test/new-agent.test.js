// scripts/new-agent.js: a new agent's folder from the template, registered, loading, and failing the conformance test
// only for its missing recorded session.
// Zero dependencies — run with `node --test test/new-agent.test.js`.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAgent } = require('../scripts/new-agent');

const AGENTS_DIR = path.join(__dirname, '..', 'server', 'lib', 'features', 'agents');

// a copy of the agents folder's registry, so the real one is left alone
function scratchAgents() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'so-new-agent-'));
  fs.copyFileSync(path.join(AGENTS_DIR, 'registry.js'), path.join(dir, 'registry.js'));
  return dir;
}

test('a new agent gets a complete folder and its id in the registry', () => {
  const dir = scratchAgents();
  try {
    createAgent('my-agent', 'My Agent', dir);
    for (const file of ['manifest.js', 'tools.js', 'translate.js', 'server.js', 'FIDELITY.md', 'fixtures/fixtures.json']) {
      assert.ok(fs.existsSync(path.join(dir, 'my-agent', file)), file);
    }
    assert.match(fs.readFileSync(path.join(dir, 'registry.js'), 'utf8'), /const AGENT_IDS = \['claude', 'codex', 'opencode', 'my-agent'\];/);
    const manifest = require(path.join(dir, 'my-agent', 'manifest.js'));
    assert.equal(manifest.id, 'my-agent');
    assert.equal(manifest.name, 'My Agent');
    const tools = require(path.join(dir, 'my-agent', 'tools.js'));
    assert.ok(Array.isArray(tools.roles.subagentCall) && Array.isArray(tools.pathFields));
    assert.equal(typeof require(path.join(dir, 'my-agent', 'translate.js')).createMyAgentTranslator, 'function');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'my-agent', 'fixtures', 'fixtures.json'), 'utf8')).fixtures, [],
      'no recorded session yet: the conformance test fails until one is added');
    assert.match(fs.readFileSync(path.join(dir, 'my-agent', 'manifest.js'), 'utf8'), /\r\n/, 'CRLF, like the rest of the repository');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a bad or taken id is refused, and nothing is written', () => {
  const dir = scratchAgents();
  try {
    assert.throws(() => createAgent('My Agent', 'My Agent', dir), /lower-case/);
    fs.mkdirSync(path.join(dir, 'taken'));
    assert.throws(() => createAgent('taken', 'Taken', dir), /already exists/);
    assert.match(fs.readFileSync(path.join(dir, 'registry.js'), 'utf8'), /const AGENT_IDS = \['claude', 'codex', 'opencode'\];/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
