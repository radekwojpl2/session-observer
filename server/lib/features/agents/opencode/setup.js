// Installs or removes the Session Observer plugin for OpenCode: a small ES module in OpenCode's global plugin folder
// ($XDG_CONFIG_HOME/opencode/plugin, else ~/.config/opencode/plugin) that loads capture/plugin.js from this copy.
// CLI: scripts/setup-opencode.js.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const PLUGIN_FILE = 'session-observer.js';
const MARKER = 'session-observer: OpenCode plugin loader';
const PLUGIN_MODULE = path.join(__dirname, 'capture', 'plugin.js');

const pluginDir = (env = process.env) => path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'opencode', 'plugin');

// the loader: OpenCode wants an ES module; this copy's plugin is CommonJS, so it is required through createRequire
const loaderSource = (modulePath = PLUGIN_MODULE) => [
  `// ${MARKER}. Written by Session Observer (scripts/setup-opencode.js); remove with --remove.`,
  "import { createRequire } from 'node:module';",
  'const require = createRequire(import.meta.url);',
  `const { createOpencodePlugin } = require(${JSON.stringify(modulePath)});`,
  'export const SessionObserver = createOpencodePlugin();',
  '',
].join('\n');

function install(env = process.env) {
  const dir = pluginDir(env);
  const file = path.join(dir, PLUGIN_FILE);
  if (fs.existsSync(file) && !fs.readFileSync(file, 'utf8').includes(MARKER)) {
    throw new Error(`${file} exists and was not written by Session Observer: not replacing it`);
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, loaderSource());
  return file;
}

function remove(env = process.env) {
  const file = path.join(pluginDir(env), PLUGIN_FILE);
  if (!fs.existsSync(file)) return null;
  if (!fs.readFileSync(file, 'utf8').includes(MARKER)) throw new Error(`${file} was not written by Session Observer: leaving it`);
  fs.rmSync(file);
  return file;
}

module.exports = { install, remove, pluginDir, loaderSource, PLUGIN_FILE };
