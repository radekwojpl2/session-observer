// Context thresholds: each time the main agent's context fills past 50%, 75% or 90% of its window, the session keeps
// the model step that took it there, so the dashboard can tell you and open the turn behind the jump.
// A compaction (the context shrinks below a threshold) arms that threshold again.
//
// Only a known window counts: the one Codex reports, the one Claude Code's status line reported (observed-context.js),
// or a model named as 1M. Otherwise the size is a guess (200k until the context goes past it), and a 1M model
// guessed at 200k would alert at 100k, 150k and 180k for nothing.
'use strict';
const { agentById } = require('../agents/registry');
const { contextUsage } = require('./observed-context');
const { hasOneMillionWindow } = require('../../building-blocks/token-usage');

const CONTEXT_THRESHOLDS = [0.5, 0.75, 0.9];
const CROSSINGS_KEPT_MAX = 20;

const lastSeen = new WeakMap(); // session → { level, tokens } after its last main-agent step with a known window

// how many thresholds a share of the window is at or past (0 – 3)
const levelOf = pct => CONTEXT_THRESHOLDS.filter(threshold => pct >= threshold).length;

function isWindowKnown(session) {
  const { context, observedContext } = session;
  if (agentById(session.agent)?.reportsContextWindow) return true;
  if (observedContext && observedContext.model === context.model) return true;
  return hasOneMillionWindow(context.model || session.model);
}

// called after a main-agent ModelStep (already ingested, so it has its seq) set session.context
function noteContextThresholds(session, step) {
  if (!session.context?.tokens || step?.seq == null || !isWindowKnown(session)) return;
  const context = contextUsage(session);
  const before = lastSeen.get(session) || { level: 0, tokens: null };
  const level = levelOf(context.pct);
  lastSeen.set(session, { level, tokens: context.tokens });
  if (level <= before.level) return;
  // a step that jumps past two thresholds at once counts as crossing the higher one
  session.contextCrossings.push({
    threshold: CONTEXT_THRESHOLDS[level - 1], tokens: context.tokens, window: context.window, pct: context.pct,
    change: before.tokens == null ? null : context.tokens - before.tokens, seq: step.seq, ts: step.ts,
  });
  if (session.contextCrossings.length > CROSSINGS_KEPT_MAX) session.contextCrossings.shift();
}

module.exports = { CONTEXT_THRESHOLDS, noteContextThresholds };
