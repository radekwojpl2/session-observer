// Model steps an agent reports itself (an in-process plugin's ModelStep events), instead of the server making them
// from a session file: each one's tokens are added to its session's totals and, for the main agent, its context
// window use. Agents whose server hooks take reported steps use these (features/agents/<agent>/server.js).
'use strict';
const { CONTEXT_WINDOW } = require('../../building-blocks/config');

const isReportedStep = event => event.event === 'ModelStep' && !event.synthetic;
const count = value => (Number.isFinite(Number(value)) ? Number(value) : 0);

// `fallbackWindow`: the window when the step names none
function addReportedUsage(session, step, fallbackWindow = CONTEXT_WINDOW) {
  const { tokens, model, subagent } = step.data || {};
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
  const window = count(step.data.model_context_window) || fallbackWindow;
  session.context = { tokens: context, window, pct: Math.min(1, context / window), ts: step.ts, model: model || session.model };
}

module.exports = { isReportedStep, addReportedUsage };
