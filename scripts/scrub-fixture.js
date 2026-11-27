#!/usr/bin/env node
// Turns a real session log into a fixture an agent folder can commit: the project folder becomes /work/project, the
// home folder ~, links to the sessions that started it are dropped, and the result is refused if the user name, an
// email address or an API-key-like string is still in it.
// Usage: node scripts/scrub-fixture.js <session log .jsonl> <fixture .jsonl> --project <the project folder>
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// every way a path shows up in a log line: as written, with the other slash, JSON-escaped, and as the dashed folder
// name Claude Code keeps a project's transcripts under (C:\a\b → C--a-b)
function spellings(folder) {
  const forward = folder.replace(/\\/g, '/');
  const back = folder.replace(/\//g, '\\');
  return [...new Set([back.replace(/\\/g, '\\\\'), back, forward, folder.replace(/[^A-Za-z0-9]/g, '-')])];
}

function scrubLine(line, replacements) {
  let text = line;
  for (const [from, to] of replacements) text = text.split(from).join(to);
  const event = JSON.parse(text);
  delete event.parents; // the session that started the recording: not part of the agent's own events
  return JSON.stringify(event);
}

function leaks(text) {
  const user = os.userInfo().username;
  const found = [];
  if (user && new RegExp(`\\b${user}\\b`, 'i').test(text)) found.push(`the user name "${user}"`);
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) found.push('an email address');
  if (/\b(sk|pk|ghp|gho|xox[abp])[-_][A-Za-z0-9]{16,}/.test(text)) found.push('a key-like string');
  return found;
}

function scrub(input, output, project) {
  const replacements = [
    ...spellings(path.resolve(project)).map(spelling => [spelling, '/work/project']),
    ...spellings(os.homedir()).map(spelling => [spelling, '~']),
  ];
  const lines = fs.readFileSync(input, 'utf8').split(/\r?\n/).filter(Boolean).map(line => scrubLine(line, replacements));
  const text = lines.join('\n') + '\n';
  const found = leaks(text);
  if (found.length) throw new Error(`not written: still contains ${found.join(', ')}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, text);
  return lines.length;
}

if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  const projectAt = process.argv.indexOf('--project');
  const project = projectAt > 0 ? process.argv[projectAt + 1] : null;
  if (!input || !output || !project) {
    console.error('usage: node scripts/scrub-fixture.js <session log .jsonl> <fixture .jsonl> --project <folder>');
    process.exit(2);
  }
  try {
    console.log(`wrote ${scrub(input, output, project)} events to ${output}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { scrub, leaks };
