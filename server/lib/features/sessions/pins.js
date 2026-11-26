'use strict';
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../../building-blocks/config');

const file = path.join(DATA_DIR, 'pins.json');
let pins = new Set();

function loadPins() {
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(saved) || !saved.every(id => typeof id === 'string' && id)) throw new Error('expected session IDs');
    pins = new Set(saved);
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('session-observer: could not load pins:', error.message);
  }
}

function savePins(next) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify([...next]) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, file);
  pins = next;
}

function setPin(id, pinned) {
  if (pins.has(id) === pinned) return;
  const next = new Set(pins);
  if (pinned) next.add(id);
  else next.delete(id);
  savePins(next);
}

function clearPins() {
  if (pins.size) savePins(new Set());
}

module.exports = { loadPins, setPin, clearPins, isPinned: id => pins.has(id), pinnedIds: () => pins.values() };
