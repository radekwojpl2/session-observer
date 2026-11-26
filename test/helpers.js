// Helpers the end-to-end tests share: a free port, polling until a check passes, and stopping a server process.
'use strict';
const net = require('node:net');

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
    probe.on('error', reject);
  });
}

// polls check() until it returns something truthy; fails early if `child` (a server process) has exited
async function waitFor(check, ms = 8000, child = null) {
  const end = Date.now() + ms;
  let lastError;
  while (Date.now() < end) {
    if (child && child.exitCode != null) throw new Error(`the server exited (${child.exitCode})`);
    try { const value = await check(); if (value) return value; } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw lastError || new Error('timed out');
}

// kills a child process and resolves once it has exited
async function stopProcess(child) {
  if (!child) return;
  const running = child.exitCode == null && child.signalCode == null;
  const exited = running ? new Promise(resolve => child.once('exit', resolve)) : null;
  child.kill();
  if (exited) await exited;
}

module.exports = { freePort, waitFor, stopProcess };
