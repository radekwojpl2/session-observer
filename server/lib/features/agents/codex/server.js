// What the server does differently for Codex. Its model steps come from its PostModelRequest hook events
// (model-steps.js), what the model wrote from its session file, the "rollout" (rollout-texts.js), and its Context
// view from the same file (context.js). The generic code calls these hooks (features/agents/registry.js, agentServer).
'use strict';
const { isCodexModelRequest, noteCodexEvent, toCodexModelStep, addCodexUsage, resetCodexSteps, clearCodexSession } = require('./model-steps');
const { codexRolloutTexts, resetCodexRolloutTexts, clearCodexSession: clearCodexRolloutSession } = require('./rollout-texts');
const { codexSessionContext } = require('./context');

module.exports = {
  // every Codex event, before it is taken in: its tool calls wait for the model step that asked for them
  noteEvent: noteCodexEvent,
  // turns a model request into a ModelStep, in place; true when it did
  modelStepFrom(event) {
    if (!isCodexModelRequest(event)) return false;
    toCodexModelStep(event);
    return true;
  },
  // adds a step's tokens to its session's totals and context window use
  addStepUsage: addCodexUsage,
  // the events one line of its session file makes (what the model wrote), instead of reading it as a Claude transcript
  transcriptRowEvents: codexRolloutTexts,
  // Codex keeps each subagent in a session file of its own, not beside the main one
  readsSubagentTranscripts: false,
  sessionContext: codexSessionContext,
  reset() {
    resetCodexSteps();
    resetCodexRolloutTexts();
  },
  clearSession(sessionId) {
    clearCodexSession(sessionId);
    clearCodexRolloutSession(sessionId);
  },
};
