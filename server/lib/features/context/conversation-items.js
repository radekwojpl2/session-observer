// A transcript as the list of items the Context view shows, in order: prompts, replies, thinking, tool calls and
// results, attachments, compactions; plus the context window and the measured size of the first request.
'use strict';
const { clipText, clipDeep, contentText, textLength } = require('./transcript-rows');
const { attachmentRole, attachmentItem } = require('./attachments');
const { contextTokensOf } = require('../../building-blocks/token-usage');

const contentBlocks = message => (Array.isArray(message.content) ? message.content : []);

function userItems(row, ts) {
  const message = row.message;
  const kind = row.isCompactSummary ? 'summary' : row.isMeta ? 'meta' : 'user';
  if (typeof message.content === 'string') return [{ kind, ts, text: clipText(message.content) }];
  const items = [];
  for (const block of contentBlocks(message)) {
    if (block?.type === 'tool_result') {
      items.push({
        kind: 'result', ts, id: block.tool_use_id, error: !!block.is_error,
        text: clipText(contentText(block.content)), agentId: row.toolUseResult?.agentId || null,
      });
    } else if (block?.type === 'text') {
      items.push({ kind, ts, text: clipText(block.text || '') });
    } else if (block?.type === 'image') {
      items.push({ kind, ts, text: '[image]' });
    }
  }
  return items;
}

function assistantBlockItem(block, ts) {
  if (block?.type === 'text' && block.text?.trim()) return { kind: 'text', ts, text: clipText(block.text) };
  if (block?.type === 'thinking' && block.thinking?.trim()) return { kind: 'thinking', ts, text: clipText(block.thinking) };
  if (block?.type === 'tool_use') return { kind: 'call', ts, id: block.id, name: block.name, input: clipDeep(block.input) };
  return null;
}

function conversationItems(rows) {
  const items = [], seenSteps = new Set();
  for (const row of rows) {
    const ts = row.timestamp || null;
    if (row.type === 'system' && row.subtype === 'compact_boundary') {
      items.push({ kind: 'compact', ts, trigger: row.compactMetadata?.trigger || null, preTokens: row.compactMetadata?.preTokens || null });
      continue;
    }
    if (row.type === 'attachment' && row.attachment) {
      items.push(attachmentItem(row.attachment, ts));
      continue;
    }
    const message = row.message;
    if (!message || (row.type !== 'user' && row.type !== 'assistant')) continue;
    if (row.type === 'user') {
      items.push(...userItems(row, ts));
      continue;
    }
    // one API response spans several lines (one per content block); its first line marks the model step
    const usage = message.usage, stepId = message.id || row.uuid;
    if (usage && stepId && !seenSteps.has(stepId)) {
      seenSteps.add(stepId);
      items.push({ kind: 'step', ts, model: message.model || null, out: usage.output_tokens || 0, ctx: contextTokensOf(usage), cached: usage.cache_read_input_tokens || 0 });
    }
    for (const block of contentBlocks(message)) {
      const item = assistantBlockItem(block, ts);
      if (item) items.push(item);
    }
  }
  return items;
}

// Measured size: the first model step's context (from usage) is everything the model was given up front, so it sets
// this session's characters per token, used for the cards' sizes instead of a flat 4.
const PLAUSIBLE_CHARS_PER_TOKEN = [1.5, 8];

function charactersBeforeFirstStep(rows, firstStepRow) {
  let characters = 0;
  for (const row of rows) {
    if (row === firstStepRow) break;
    if (row.type === 'attachment' && row.attachment && attachmentRole(row.attachment.type) !== 'meta') {
      characters += attachmentItem(row.attachment, null).text.length;
    } else if (row.type === 'user' && row.message) {
      characters += textLength(contentText(row.message.content));
    }
  }
  return characters;
}

function measuredSize(rows, firstShape, sentMessages) {
  const firstStepRow = rows.find(row => row.type === 'assistant' && row.message?.usage);
  const usage = firstStepRow?.message.usage;
  if (!usage) return null;
  const firstCtx = contextTokensOf(usage);
  let chars = null;
  if (firstShape) {
    chars = (firstShape.system || []).reduce((sum, block) => sum + textLength(block?.text), 0) + JSON.stringify(firstShape.tools || []).length;
    chars += sentMessages?.firstChars != null ? sentMessages.firstChars : charactersBeforeFirstStep(rows, firstStepRow);
  }
  const charsPerToken = chars && firstCtx ? chars / firstCtx : null;
  const [lowest, highest] = PLAUSIBLE_CHARS_PER_TOKEN;
  return { firstCtx, chars, cpt: charsPerToken && charsPerToken >= lowest && charsPerToken <= highest ? charsPerToken : null };
}

// The context window, from the latest /context report in the transcript ("**Tokens:** 51.9k / 1m (5%)"): the model
// id doesn't always say whether the session has the 1M window.
const CONTEXT_REPORT = /\*\*Tokens:\*\*\s*[\d.]+[km]?\s*\/\s*([\d.]+)([km]?)/i;
const UNIT_MULTIPLIER = { k: 1e3, m: 1e6 };

function reportedContextWindow(rows) {
  for (let index = rows.length - 1; index >= 0; index--) {
    const content = rows[index].type === 'user' ? rows[index].message?.content : null;
    if (typeof content !== 'string' || !content.startsWith('## Context Usage')) continue;
    const match = CONTEXT_REPORT.exec(content);
    if (match) return Math.round(parseFloat(match[1]) * (UNIT_MULTIPLIER[match[2].toLowerCase()] || 1)) || null;
  }
  return null;
}

module.exports = { conversationItems, measuredSize, reportedContextWindow };
