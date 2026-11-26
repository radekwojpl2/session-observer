// One session's whole context, in full, for the Context view (GET /api/context).
//
// The hook log keeps at most OBSERVER_MAX_FIELD chars per field and the model's text at 2000, so this view reads the
// transcript itself: every prompt, reply, thinking block, tool call with its input and result, attachment and
// compaction. Read on request (only while the view is open), cached per file until it changes.
'use strict';
const fs = require('fs');
const path = require('path');
const { readTranscriptRows } = require('./transcript-rows');
const { systemPromptOf, firstRequestShape } = require('./system-prompt');
const { sentMessagesOf } = require('./sent-messages');
const { conversationItems, measuredSize, reportedContextWindow } = require('./conversation-items');
const { subagentDirOf } = require('../sessions/transcript-steps');
const { CODEX } = require('../sessions/codex-model-steps');
const { codexSessionContext } = require('./codex/codex-context');
const { contextUsage } = require('../sessions/observed-context');

const SUBAGENT_TRANSCRIPT = /^agent-([\w-]+)\.jsonl$/;

function readSubagentMeta(subagentDir, agentId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(subagentDir, `agent-${agentId}.meta.json`), 'utf8'));
  } catch {
    return {}; // optional
  }
}

// subagents: <transcript>/subagents/agent-<id>.jsonl, with agent-<id>.meta.json next to it. A subagent has its own
// system prompt (a custom agent's is the body of its .md file), tools and instructions.
function subagentContexts(mainTranscript) {
  const subagentDir = subagentDirOf(mainTranscript);
  let files = [];
  try { files = fs.readdirSync(subagentDir).filter(name => SUBAGENT_TRANSCRIPT.test(name)); } catch { /* none */ }
  const subagents = {};
  for (const file of files) {
    const agentId = SUBAGENT_TRANSCRIPT.exec(file)[1];
    const rows = readTranscriptRows(path.join(subagentDir, file)) || [];
    const meta = readSubagentMeta(subagentDir, agentId);
    subagents[agentId] = {
      type: meta.agentType || null, description: meta.description || null, toolUseId: meta.toolUseId || null,
      ...systemPromptOf(rows), items: conversationItems(rows),
    };
  }
  return subagents;
}

function sessionContext(session) {
  if (session.agent === CODEX) return codexSessionContext(session); // Codex's session file has its own format
  const mainTranscript = session.transcript_path;
  const rows = mainTranscript && readTranscriptRows(mainTranscript);
  if (!rows) return { error: 'transcript not found', transcript: mainTranscript || null };
  const subagents = subagentContexts(mainTranscript);
  const sentMessages = sentMessagesOf(rows);
  const observed = session.observedContext;
  return {
    session: session.id, transcript: mainTranscript, model: session.model, context: contextUsage(session),
    window: observed && observed.model === session.model ? observed.window : reportedContextWindow(rows),
    ...systemPromptOf(rows),
    items: conversationItems(rows),
    subagents,
    wire: sentMessages,
    measured: measuredSize(rows, firstRequestShape(rows), sentMessages),
  };
}

module.exports = { sessionContext };
