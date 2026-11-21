// What a Codex model wrote, read from Codex's session file (its "rollout", which every Codex hook event points to as
// transcript_path): its replies and the summaries of its reasoning, as the same ModelText events the transcript
// reader makes for Claude Code. Reasoning without a summary is stored encrypted, so it stays out.
//
// A response's rows come first and its token_usage_record after them, carrying the response_id that its ModelStep
// (from the PostModelRequest hook) has as msg_id: the texts wait for that row, then go out with that id.
// The file is Codex's own record, not a stable interface: rows this reader doesn't know are skipped.
'use strict';

const MODEL_TEXT_MAX = 2000; // characters kept of one text / reasoning summary
const waitingTexts = new Map(); // session id → [{ kind, text, ts }] since the last token_usage_record

const payloadOf = row => (row && typeof row.payload === 'object' && row.payload) || {};
const partsText = parts => (Array.isArray(parts) ? parts : [])
  .map(part => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : ''))
  .filter(Boolean).join('\n\n').trim();

// a response_item's text: an assistant message's reply, or a reasoning row's summary
function textOf(payload) {
  if (payload.type === 'message' && payload.role === 'assistant') return { kind: 'text', text: partsText(payload.content) };
  if (payload.type === 'reasoning') return { kind: 'thinking', text: partsText(payload.summary) };
  return null;
}

function modelTextEvent(session, item, responseId, ts) {
  const text = item.text.length > MODEL_TEXT_MAX ? item.text.slice(0, MODEL_TEXT_MAX) + '…' : item.text;
  return {
    ts, event: 'ModelText', session_id: session.id, synthetic: true,
    data: { kind: item.kind, text, msg_id: responseId, subagent: false, agent_id: null },
  };
}

// one row of the rollout → the ModelText events it completes. `stepOf(responseId)`: that response's ModelStep, if it
// arrived already (the texts then take its time, so they show with it)
function codexRolloutTexts(session, row, stepOf) {
  const payload = payloadOf(row);
  // only from the logged part of the session: after "Clear log" the earlier history must not come back
  const logged = !(session.started && row.timestamp && row.timestamp < session.started);
  if (row.type === 'response_item') {
    const item = textOf(payload);
    if (!item?.text || !logged) return [];
    if (!waitingTexts.has(session.id)) waitingTexts.set(session.id, []);
    waitingTexts.get(session.id).push({ ...item, ts: row.timestamp || new Date().toISOString() });
    return [];
  }
  // the response is done: its token use, or the turn ended without one (cancelled)
  const turnEnded = row.type === 'event_msg' && (payload.type === 'task_complete' || payload.type === 'turn_aborted');
  if (row.type !== 'token_usage_record' && !turnEnded) return [];
  const items = waitingTexts.get(session.id) || [];
  waitingTexts.delete(session.id);
  const responseId = row.type === 'token_usage_record' ? payload.response_id || null : null;
  const step = responseId && stepOf(responseId);
  return items.map(item => modelTextEvent(session, item, responseId, step ? step.ts : item.ts));
}

const resetCodexRolloutTexts = () => waitingTexts.clear();

module.exports = { codexRolloutTexts, resetCodexRolloutTexts };
