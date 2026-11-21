#!/usr/bin/env node
// session-observer for the Codex CLI: adds this plugin's hooks to the user's Codex hooks file
// ($CODEX_HOME/hooks.json, by default ~/.codex/hooks.json), so Codex sessions show up on the same dashboard as
// Claude Code's. The Codex desktop app can load the hooks from the plugin itself (.codex-plugin/plugin.json) instead.
//
//   node scripts/setup-codex.js           add or update the hooks (safe to run again, e.g. after moving this folder)
//   node scripts/setup-codex.js --remove  take them out again
//
// Other hooks in the file are kept as they are. Codex runs a new or changed hook only after you trust it: run /hooks
// in Codex once after this.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const PLUGIN_ROOT = path.join(__dirname, '..');
const HOOK_SCRIPT = path.join(PLUGIN_ROOT, 'scripts', 'hook.js');
const PLUGIN_MANIFEST = path.join(PLUGIN_ROOT, '.codex-plugin', 'plugin.json'); // its "hooks" are the Codex hooks
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const HOOKS_FILE = path.join(CODEX_HOME, 'hooks.json');
// our hook commands end with this, which is how a later run finds (and replaces) them
const OUR_COMMAND = /scripts[\\/]+hook\.js"?\s+\w+\s+--agent codex\s*$/;

const isOurHook = handler => handler && typeof handler.command === 'string' && OUR_COMMAND.test(handler.command);

// the plugin's Codex hooks, with ${PLUGIN_ROOT} replaced by this folder's real path (a user hooks file has no plugin root)
function ourHooks() {
  const pluginHooks = JSON.parse(fs.readFileSync(PLUGIN_MANIFEST, 'utf8')).hooks.hooks;
  const command = event => `node "${HOOK_SCRIPT}" ${event} --agent codex`;
  return Object.fromEntries(Object.entries(pluginHooks).map(([event, groups]) => [event,
    groups.map(group => ({ ...group, hooks: group.hooks.map(handler => ({ ...handler, command: command(event) })) }))]));
}

function readHooksFile() {
  let text;
  try { text = fs.readFileSync(HOOKS_FILE, 'utf8'); } catch { return { hooks: {} }; }
  const config = JSON.parse(text); // a broken file is reported, never overwritten
  if (!config.hooks || typeof config.hooks !== 'object') config.hooks = {};
  return config;
}

// every group without our handlers; groups left empty are dropped, and so are events left with no groups
function withoutOurHooks(hooks) {
  const kept = {};
  for (const [event, groups] of Object.entries(hooks)) {
    const remaining = (Array.isArray(groups) ? groups : [])
      .map(group => ({ ...group, hooks: (group.hooks || []).filter(handler => !isOurHook(handler)) }))
      .filter(group => group.hooks.length);
    if (remaining.length) kept[event] = remaining;
  }
  return kept;
}

function main() {
  const remove = process.argv.includes('--remove');
  let config;
  try {
    config = readHooksFile();
  } catch (error) {
    console.error(`Could not read ${HOOKS_FILE}: ${error.message}. Fix or move it, then run this again.`);
    process.exit(1);
  }
  const hooks = withoutOurHooks(config.hooks);
  if (!remove) {
    for (const [event, groups] of Object.entries(ourHooks())) hooks[event] = [...(hooks[event] || []), ...groups];
  }
  config.hooks = hooks;
  fs.mkdirSync(CODEX_HOME, { recursive: true });
  fs.writeFileSync(HOOKS_FILE, JSON.stringify(config, null, 2) + '\n');
  if (remove) {
    console.log(`Removed the Session Observer hooks from ${HOOKS_FILE}.`);
    return;
  }
  console.log(`Added the Session Observer hooks to ${HOOKS_FILE}.`);
  console.log('Next: start Codex, run /hooks and trust the new hooks. Then open http://localhost:4777.');
  console.log('If you move or update this folder, run this script again from the new place.');
}

main();
