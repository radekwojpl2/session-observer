// What the server does for Claude Code beyond its hook events: it reads the transcript the hooks point at (and its
// subagents' transcripts) for model steps, texts, interrupts and tool results (transcript-events.js), and builds the
// Context view from it (context.js). The generic code calls these hooks (features/agents/registry.js, agentServer).
'use strict';
const { readSessionFileRow, sessionFiles } = require('./transcript-events');
const { claudeSessionContext } = require('./context');

module.exports = {
  // the files to tail: the main transcript and each subagent's
  sessionFiles,
  // the events one line makes, ingested through the generic reader
  readSessionFileRow,
  // a subagent call refused at its prompt shows only in the transcript: read it before a SubagentStart takes the
  // next call's description (subagent-list.js)
  readBeforeSubagentStart: true,
  sessionContext: claudeSessionContext,
};
