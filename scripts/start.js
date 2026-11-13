#!/usr/bin/env node
// Starts the dashboard server in the background (if it isn't running) and prints its URL.
'use strict';
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const PORT = Number(process.env.OBSERVER_PORT || 4777);
const url = `http://localhost:${PORT}`;
const sock = net.connect({ port: PORT, host: '127.0.0.1' });
sock.once('connect', () => { sock.destroy(); console.log(`Session Observer already running → ${url}`); });
sock.once('error', () => {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], { detached: true, stdio: 'ignore', env: process.env });
  child.unref();
  console.log(`Session Observer started → ${url}`);
});
