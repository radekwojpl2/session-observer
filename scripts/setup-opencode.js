#!/usr/bin/env node
// Adds the Session Observer plugin to OpenCode, or removes it (--remove). OpenCode then sends its sessions to the
// dashboard like Claude Code and Codex do. Usage: node scripts/setup-opencode.js [--remove]
'use strict';
const { install, remove } = require('../server/lib/features/agents/opencode/setup');

try {
  if (process.argv.includes('--remove')) {
    const file = remove();
    console.log(file ? `Removed ${file}` : 'The OpenCode plugin was not installed.');
  } else {
    console.log(`Installed ${install()}\nRestart OpenCode: its sessions will show on the dashboard (http://127.0.0.1:4777).`);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
