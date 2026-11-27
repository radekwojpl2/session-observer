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

// the loader: OpenCode wants an ES module; this copy's plugin is CommonJS, so it is required through createRequire.
// If this copy has moved or gone, the loader exports a plugin that does nothing, so OpenCode still starts.
const loaderSource = (modulePath = PLUGIN_MODULE) => [
  `// ${MARKER}. Written by Session Observer (scripts/setup-opencode.js); remove with --remove.`,
  `// If ${path.basename(modulePath)} has moved, this plugin does nothing: run setup-opencode.js again from the new copy.`,
  "import { createRequire } from 'node:module';",
  'const require = createRequire(import.meta.url);',
  'let SessionObserver = async () => ({});',
  'try {',
  `  const { createOpencodePlugin } = require(${JSON.stringify(modulePath)});`,
  '  SessionObserver = createOpencodePlugin();',
  '} catch {}',
  'export { SessionObserver };',
  '',
].join('\n');

function install(env = process.env) {
  const dir = pluginDir(env);
  const file = path.join(dir, PLUGIN_FILE);
  fs.mkdirSync(dir, { recursive: true });
  // one open, no check-then-write: create the file, or else open the existing one and replace it only if it is ours
  let fd;
  try {
    fd = fs.openSync(file, 'wx');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    fd = fs.openSync(file, 'r+');
    try {
      if (!fs.readFileSync(fd, 'utf8').includes(MARKER)) throw new Error(`${file} exists and was not written by Session Observer: not replacing it`);
      fs.ftruncateSync(fd, 0);
    } catch (readError) {
      fs.closeSync(fd);
      throw readError;
    }
  }
  try {
    fs.writeSync(fd, loaderSource(), 0);
  } finally {
    fs.closeSync(fd);
  }
  return file;
}

// the file's text, or null when there is none
function readIfThere(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function remove(env = process.env) {
  const file = path.join(pluginDir(env), PLUGIN_FILE);
  const text = readIfThere(file);
  if (text === null) return null;
  if (!text.includes(MARKER)) throw new Error(`${file} was not written by Session Observer: leaving it`);
  fs.rmSync(file, { force: true });
  return file;
}

module.exports = { install, remove, pluginDir, loaderSource, PLUGIN_FILE };
