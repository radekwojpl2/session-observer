// Claude Code's whole context, in full, for the Context view (GET /api/context), read from its transcript: every
// prompt, reply, thinking block, tool call with its input and result, attachment and compaction, its subagents', and
// the shape of the requests it sent. The hook log keeps at most OBSERVER_MAX_FIELD chars per field and the model's text
// at 2000, so this view reads the transcript itself. Read on request (only while the view is open), cached per file.
'use strict';
const fs = require('fs');
const path = require('path');
const { readTranscriptRows } = require('../../context/transcript-rows');
const { systemPromptOf, firstRequestShape } = require('../../context/system-prompt');
const { sentMessagesOf } = require('../../context/sent-messages');
const { conversationItems, measuredSize, reportedContextWindow } = require('../../context/conversation-items');
const { contextUsage } = require('../../sessions/observed-context');
const { subagentDirOf } = require('./transcript-events');

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

function claudeSessionContext(session) {
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

module.exports = { claudeSessionContext };
