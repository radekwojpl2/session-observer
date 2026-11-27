'use strict';
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../../building-blocks/config');
const { sessionLogName } = require('../../building-blocks/session-logs');
const { agentById } = require('../agents/registry');

const directory = path.join(DATA_DIR, 'context-windows');
const nameOf = id => sessionLogName(id).replace(/\.jsonl$/, '.json');
const fileOf = id => path.join(directory, nameOf(id));
const valid = sample => typeof sample?.model === 'string' && sample.model.length > 0
  && Number.isSafeInteger(sample.window) && sample.window > 0;

function readObservedContext(id) {
  try {
    const sample = JSON.parse(fs.readFileSync(fileOf(id), 'utf8'));
    return valid(sample) ? sample : null;
  } catch {
    return null;
  }
}

function recordStatuslineContext(payload) {
  const id = payload?.session_id;
  const sample = { model: payload?.model?.id, window: payload?.context_window?.context_window_size };
  if (typeof id !== 'string' || !id || !valid(sample)) return;
  const prior = readObservedContext(id);
  if (prior?.model === sample.model && prior?.window === sample.window) return;

  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = fileOf(id);
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(sample), { mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

const removeObservedContext = id => fs.rmSync(fileOf(id), { force: true });
const clearObservedContext = () => fs.rmSync(directory, { recursive: true, force: true });

// The optional sidecar is separate from the event log, so a status refresh never marks a session active.
function refreshObservedContexts(sessions) {
  let names;
  try { names = new Set(fs.readdirSync(directory)); } catch { names = new Set(); }
  const changed = [];
  for (const session of sessions) {
    if (!agentById(session.agent)?.statusLineContext) continue; // (scripts/claude-statusline.js writes them)
    const sample = names.size && names.has(nameOf(session.id)) ? readObservedContext(session.id) : null;
    const prior = session.observedContext;
    if (sample?.model === prior?.model && sample?.window === prior?.window) continue;
    session.observedContext = sample;
    changed.push(session);
  }
  return changed;
}

function contextUsage(session) {
  const { context, observedContext } = session;
  if (!context || !observedContext || observedContext.model !== context.model) return context;
  const { window } = observedContext;
  return { ...context, window, pct: Math.min(1, context.tokens / window) };
}

module.exports = { recordStatuslineContext, refreshObservedContexts, removeObservedContext, clearObservedContext, contextUsage };
