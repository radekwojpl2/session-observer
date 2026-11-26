// Model steps an agent reports itself, instead of the server reading them from a transcript: Codex's (a hook event
// turned into a ModelStep, codex-model-steps.js), and pi's and omp's (their extension writes ModelStep events). Here
// each one's tokens are added to its session's totals and, for the main agent, its context window use.
'use strict';
const { CONTEXT_WINDOW } = require('../../building-blocks/config');

// the agents whose extension writes ModelStep and ModelText events of its own (pi-extension/)
const EXTENSION_AGENTS = new Set(['pi', 'omp']);
const isExtensionModelStep = event => event.event === 'ModelStep' && !event.synthetic && EXTENSION_AGENTS.has(event.agent);

const count = value => (Number.isFinite(Number(value)) ? Number(value) : 0);

// `fallbackWindow`: the context window when the step names none
function addStepUsage(session, step, fallbackWindow = CONTEXT_WINDOW) {
  const { tokens, model, subagent, token_usage: usage } = step.data;
  if (!tokens) return;
  const totals = session.usage;
  totals.input += count(tokens.input);
  totals.output += count(tokens.output);
  totals.cache_read += count(tokens.cache_read);
  totals.cache_write += count(tokens.cache_write);
  totals.turns++;
  if (model) totals.models[model] = (totals.models[model] || 0) + 1;
  const context = count(tokens.context);
  if (subagent || !context) return;
  const window = count(usage?.model_context_window ?? step.data.model_context_window) || fallbackWindow;
  session.context = { tokens: context, window, pct: Math.min(1, context / window), ts: step.ts };
}

module.exports = { EXTENSION_AGENTS, isExtensionModelStep, addStepUsage };
