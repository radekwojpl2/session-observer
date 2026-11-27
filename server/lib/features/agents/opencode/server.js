// What the server does for OpenCode: its plugin reports its own model steps (with tokens and the model's window),
// so they only need adding up. Its Context view reads OpenCode's own database (context.js).
'use strict';
const { isReportedStep, addReportedUsage } = require('../../sessions/reported-steps');
const { opencodeSessionContext } = require('./context');

module.exports = {
  modelStepFrom: isReportedStep, // already a ModelStep: nothing to rewrite
  addStepUsage: addReportedUsage,
  sessionContext: opencodeSessionContext,
};
