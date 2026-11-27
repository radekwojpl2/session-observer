// What each model step cost, and its session's running total: the cost the agent reports itself (OpenCode), else an
// estimate from the step's tokens at its model's API prices (prices.js). A step of a model with no price is counted,
// so the dashboard can say the total leaves some out.
'use strict';
const { estimateStepCost } = require('./prices');

const newSessionCost = () => ({ usd: 0, priced: 0, unpriced: 0, reported: 0 });
const TOKEN_FIELDS = ['input', 'output', 'cache_read', 'cache_write'];
// a step that used no tokens costs nothing, whatever its model (Claude Code's "<synthetic>" placeholder replies)
const usedNoTokens = tokens => !tokens || TOKEN_FIELDS.every(name => !(Number(tokens[name]) > 0));

// sets step.cost_usd (null: no price), and adds it to the session's cost
function addStepCost(session, step) {
  const data = step.data || {};
  const reported = Number.isFinite(data.cost) && data.cost >= 0 ? data.cost : null;
  const usd = reported ?? (usedNoTokens(data.tokens) ? 0 : estimateStepCost(data.model || session.model, data.tokens));
  step.cost_usd = usd;
  const cost = session.cost;
  if (usd === null) {
    cost.unpriced++;
    return;
  }
  cost.usd += usd;
  cost.priced++;
  if (reported !== null) cost.reported++;
}

module.exports = { newSessionCost, addStepCost };
