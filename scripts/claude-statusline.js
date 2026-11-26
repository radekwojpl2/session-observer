#!/usr/bin/env node
// Optional Claude Code status line filter: record window metadata and pass the original input through.
'use strict';

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const input = Buffer.concat(chunks);
  process.stdout.write(input);
  try {
    const { recordStatuslineContext } = require('../server/lib/features/sessions/observed-context');
    recordStatuslineContext(JSON.parse(input.toString('utf8')));
  } catch { /* keep the existing status line usable if recording fails */ }
}

main().catch(() => {});
