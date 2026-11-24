#!/usr/bin/env node
// session-observer for pi and omp (oh-my-pi): installs the Session Observer extension, so their sessions show up on
// the same dashboard as Claude Code's and Codex's. Each gets a one-line extensions/session-observer.js that loads
// pi-extension/session-observer.js from this folder with its agent's name.
//
//   node scripts/setup-pi.js            install for each of pi and omp that is set up here (~/.pi, ~/.omp)
//   node scripts/setup-pi.js pi omp     install for these, set up or not
//   node scripts/setup-pi.js --remove   take it out again (of both, unless named)
//   node scripts/setup-pi.js omp --data-dir ~/.omp/session-observer
//                                       log to this folder instead of ~/.claude/session-observer, however the agent
//                                       starts (a sandbox that hides ~/.claude, a scheduled run without your shell's
//                                       variables). OBSERVER_DATA_DIR still wins when it is set. Give the dashboard
//                                       server the same folder.
//
// pi's folder follows PI_CODING_AGENT_DIR. An omp profile's follows OMP_PROFILE; OMP_AGENT_DIR names another.
// The file points at this clone: run this again after moving it. Restart pi / omp, or run /reload, to load it.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const EXTENSION = path.join(__dirname, '..', 'pi-extension', 'session-observer.js');
const FILE_NAME = 'session-observer.js';
const MARK = '// Session Observer extension, written by'; // how a later run knows the file is ours

// omp keeps a profile's extensions in the profile's folder (OMP_PROFILE)
const ompProfile = process.env.OMP_PROFILE || process.env.PI_PROFILE;
const ompDir = ompProfile ? path.join(os.homedir(), '.omp', 'profiles', ompProfile, 'agent') : path.join(os.homedir(), '.omp', 'agent');
const AGENTS = {
  pi: { name: 'pi', home: path.join(os.homedir(), '.pi'), dir: process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent') },
  omp: { name: 'omp', home: path.join(os.homedir(), '.omp'), dir: process.env.OMP_AGENT_DIR || ompDir },
};

// An ES module: omp (Bun) takes an ES module's default export as the extension, pi (jiti) takes either. It loads the
// extension itself, a CommonJS file like the rest of this plugin, with require.
// `dataDir`: the log folder it sets before the extension loads, unless OBSERVER_DATA_DIR is set already.
const shimText = (agent, dataDir = null) =>
  `${MARK} ${__filename}.\r\n// Run it again after moving that folder, or with --remove to take this out.\r\n` +
  "import { createRequire } from 'node:module';\r\n" +
  (dataDir ? `process.env.OBSERVER_DATA_DIR ||= ${JSON.stringify(dataDir)};\r\n` : '') +
  `export default createRequire(import.meta.url)(${JSON.stringify(EXTENSION)}).forAgent(${JSON.stringify(agent)});\r\n`;

// a folder as given on the command line: ~ is the home folder, and a relative path is from here
const expandHome = dir => path.resolve(dir === '~' || /^~[\\/]/.test(dir) ? path.join(os.homedir(), dir.slice(1)) : dir);

const isOurs = file => { try { return fs.readFileSync(file, 'utf8').startsWith(MARK); } catch { return false; } };

function install(agent, dataDir) {
  const target = path.join(agent.dir, 'extensions', FILE_NAME);
  if (fs.existsSync(target) && !isOurs(target)) {
    console.error(`${agent.name}: ${target} exists and is not Session Observer's. Move it, then run this again.`);
    return false;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, shimText(agent.name, dataDir));
  console.log(`${agent.name}: installed ${target}${dataDir ? `, logging to ${dataDir}` : ''}`);
  return true;
}

function remove(agent) {
  const target = path.join(agent.dir, 'extensions', FILE_NAME);
  if (!fs.existsSync(target)) return true;
  if (!isOurs(target)) {
    console.error(`${agent.name}: ${target} is not Session Observer's; left as it is.`);
    return false;
  }
  fs.unlinkSync(target);
  console.log(`${agent.name}: removed ${target}`);
  return true;
}

function main() {
  const args = process.argv.slice(2);
  const removing = args.includes('--remove');
  const dataDirAt = args.indexOf('--data-dir');
  if (dataDirAt >= 0 && (!args[dataDirAt + 1] || args[dataDirAt + 1].startsWith('--'))) {
    console.error('--data-dir needs a folder, e.g. --data-dir ~/.omp/session-observer');
    process.exit(1);
  }
  const dataDir = dataDirAt >= 0 ? expandHome(args[dataDirAt + 1]) : null;
  const named = args.filter((arg, index) => !arg.startsWith('--') && (dataDirAt < 0 || index !== dataDirAt + 1));
  const unknown = named.filter(name => !AGENTS[name]);
  if (unknown.length) {
    console.error(`Unknown agent: ${unknown.join(', ')}. Use pi, omp or both.`);
    process.exit(1);
  }
  let agents = named.length ? named.map(name => AGENTS[name]) : Object.values(AGENTS);
  if (!named.length && !removing) {
    agents = agents.filter(agent => fs.existsSync(agent.home) || fs.existsSync(agent.dir));
    if (!agents.length) {
      console.error('Neither pi (~/.pi) nor omp (~/.omp) is set up here. Name one to install anyway: node scripts/setup-pi.js pi');
      process.exit(1);
    }
  }
  const ok = agents.map(agent => (removing ? remove(agent) : install(agent, dataDir))).every(Boolean);
  if (!removing && ok) console.log('Restart pi / omp (or run /reload) to load it. The dashboard starts with the first session.');
  if (!removing && ok && dataDir) console.log(`Start the dashboard server with OBSERVER_DATA_DIR=${dataDir} so it reads the same folder.`);
  process.exit(ok ? 0 : 1);
}

if (require.main === module) main();

module.exports = { shimText };
