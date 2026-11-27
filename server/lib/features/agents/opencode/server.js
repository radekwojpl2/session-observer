// What the server does for OpenCode: its plugin reports its own model steps (with tokens and the model's window),
// so they only need adding up. It has no session file to read; its Context view is not built yet (FIDELITY.md).
'use strict';
const { isReportedStep, addReportedUsage } = require('../../sessions/reported-steps');

module.exports = {
  modelStepFrom: isReportedStep, // already a ModelStep: nothing to rewrite
  addStepUsage: addReportedUsage,
  sessionContext: session => ({
    error: "OpenCode's Context view is not available yet: its plugin records the conversation, not a session file this view can read.",
    transcript: null, session: session.id,
  }),
};
