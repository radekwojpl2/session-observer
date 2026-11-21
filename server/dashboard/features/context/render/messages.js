'use strict';
// Session Observer dashboard — Context view, the conversation as messages, the way the model reads them: an assistant
// message is one model step and the blocks it produced (thinking, text, tool calls); a user message is what comes
// between (prompts, tool results, reminders and other attachments). Messages are newest first unless the order is
// switched; blocks keep their own order.
const CARD_NOTE_MAX = 90;       // the one-line preview after a card's title
const LONG_CARD_NOTE_MAX = 110; // the same for thinking and injected text, whose title is a single word
const ASSISTANT_ITEM_KINDS = new Set(['step', 'thinking', 'text', 'call']);
// ---- the blocks of a message
function attachmentBlockHtml(item, id, hasSteps) {
  // bookkeeping only when asked for; the lists pinned on top only when they change later in the session
  if (item.role === 'meta' ? !showBookkeeping : item.role === 'pinned' && !hasSteps) return '';
  const note = item.role === 'meta' ? TEXT.notSentModel : item.role === 'pinned' ? TEXT.pinnedChange : item.rendered ? TEXT.sentAsText : TEXT.sentModel;
  const size = item.role === 'meta' ? escapeHtml(TEXT.notSent) : approxTokensLabel(textLength(item.text));
  return contextCardHtml(id, item.role === 'meta' ? 'att meta' : 'att',
    cardHeader({ title: escapeHtml(item.label || TEXT.attachment), note: escapeHtml(shorten(item.text, CARD_NOTE_MAX)), size }),
    `<div class="muted">${escapeHtml(note)}</div>${preText(item.text)}`);
}

function toolResultBlockHtml(item, id) {
  const call = item.call;
  const failed = item.error ? ` <span class="err">✕ ${escapeHtml(TEXT.failedLc)}</span>` : '';
  return contextCardHtml(id, 'tool',
    `${toolIconHtml(call.name, call.input, toolGroupOf(call.name, call.input))}<b>${escapeHtml(TEXT.result)}</b> <span class="muted">${escapeHtml(toolDisplayName(call.name))} · ${escapeHtml(shorten(item.text, CARD_NOTE_MAX))}</span>${failed}<span class="grow"></span><span class="sz">${approxTokensLabel(textLength(item.text))}</span>`,
    fullToolOutputHtml(item.text, item.error));
}

// a subagent hangs under the call that started it: its own prompt and conversation
function subagentUnderCallHtml(subagent, id, searchText) {
  const toolCalls = subagent.items.filter(item => item.kind === 'call').length;
  const title = `${iconSvg('agents')} ${escapeHtml(TEXT.subagent)}${subagent.type ? ' · ' + escapeHtml(subagent.type) : ''}${subagent.description ? ` <span class="muted">${escapeHtml(subagent.description)}</span>` : ''} <span class="muted">· ${escapeHtml(TEXT.ownContext(countOf(toolCalls, 'toolCall')))}</span>`;
  return `<div class="cxsub"><div class="cxl">${title}</div>${contextPreludeHtml(subagent, id + '.', false)}${contextMessagesHtml(subagent.items, id + '.', searchText, true)}</div>`;
}

function toolCallBlockHtml(item, id, searchText) {
  const result = item.result, group = toolGroupOf(item.name, item.input);
  const status = !result ? `<span class="run">● ${escapeHtml(TEXT.running)}</span>` : result.error ? `<span class="err">✕ ${escapeHtml(TEXT.failedLc)}</span>` : '<span class="ok">✓</span>';
  const argument = toolArgument({ tool_name: item.name, tool_input: item.input || {} });
  const header = `${toolIconHtml(item.name, item.input, group)}<b>${escapeHtml(toolDisplayName(item.name))}</b> <span class="muted mono">${escapeHtml(shorten(argument, 100))}</span><span class="grow"></span><span class="sz">${status} ${approxTokensLabel(callInputLength(item))}</span>`;
  const subagent = item.sub ? subagentUnderCallHtml(item.sub, id, searchText) : '';
  return contextCardHtml(id, 'tool', header, `<div class="lbl2">${escapeHtml(TEXT.input)}</div>${fullToolInputHtml(item.name, item.input)}${subagent}`);
}

const matchesSearch = (item, searchText) => !searchText || itemSearchText(item).includes(searchText)
  || (item.sub && item.sub.items.some(subItem => itemSearchText(subItem).includes(searchText)));

function blockHtml(item, id, searchText, hasSteps) {
  if (!matchesSearch(item, searchText)) return '';
  switch (item.kind) {
    case 'user': return `<div class="cxt">${escapeHtml(item.text)}</div>`;
    case 'text': return `<div class="cxt">${markdownLiteHtml(item.text)}</div>`;
    case 'summary':
      return contextCardHtml(id, 'sum', `${iconSvg('context')} <b>${escapeHtml(TEXT.compactionSummary)}</b><span class="grow"></span><span class="sz">${approxTokensLabel(textLength(item.text))}</span>`, preText(item.text), true);
    case 'thinking': return contextCardHtml(id, 'think', `<b>${escapeHtml(TEXT.thinking)}</b> <span class="muted">${escapeHtml(shorten(item.text, LONG_CARD_NOTE_MAX))}</span>`, preText(item.text));
    case 'meta':
      return contextCardHtml(id, 'att', cardHeader({ title: escapeHtml(TEXT.injected), note: escapeHtml(shorten(item.text, LONG_CARD_NOTE_MAX)), size: approxTokensLabel(textLength(item.text)) }), preText(item.text));
    case 'attachment': return attachmentBlockHtml(item, id, hasSteps);
    case 'result': return toolResultBlockHtml(item, id);
    case 'orphan': return contextCardHtml(id, 'tool', `<b>${escapeHtml(TEXT.toolResult)}</b> <span class="muted">${escapeHtml(shorten(item.text, CARD_NOTE_MAX))}</span>`, fullToolOutputHtml(item.text, item.error));
    case 'call': return toolCallBlockHtml(item, id, searchText);
    default: return '';
  }
}

// ---- messages
// items → messages: { role, step, change (context since the step before), ts, prompt, items, blocks, size } or
// { compaction }
function groupIntoMessages(items, idPrefix, searchText) {
  const messages = [];
  let current = null, lastContextTokens = null, hasSteps = false;
  items.forEach((item, index) => {
    if (item.kind === 'compact') {
      messages.push({ compaction: item });
      current = null;
      return;
    }
    const role = ASSISTANT_ITEM_KINDS.has(item.kind) ? 'assistant' : 'user';
    if (!current || current.role !== role || item.kind === 'step') messages.push(current = { role, blocks: [], size: 0 });
    if (item.kind === 'step') {
      current.step = item;
      current.change = lastContextTokens != null ? item.ctx - lastContextTokens : null;
      lastContextTokens = item.ctx;
      hasSteps = true;
      return;
    }
    if (!current.ts && item.ts) current.ts = item.ts;
    if (item.kind === 'user' && current.prompt == null) current.prompt = item.text ?? ''; // a prompt opens a turn
    (current.items ||= []).push(item);
    const html = blockHtml(item, idPrefix + index, searchText, hasSteps);
    if (html) {
      current.blocks.push(html);
      current.size += textLength(item.text) + (item.kind === 'call' ? callInputLength(item) : 0);
    }
  });
  return messages;
}

function compactionHtml(item, oldestFirst) {
  const details = (item.trigger ? ' (' + escapeHtml(item.trigger) + ')' : '') + (item.preTokens ? ' ' + escapeHtml(TEXT.atTokens(formatCompactNumber(item.preTokens))) : '') + (item.ts ? ' · ' + formatTime(item.ts) : '');
  return `<div class="cxcomp">${iconSvg('context')} ${escapeHtml(TEXT.compacted)}${details} — ${escapeHtml(oldestFirst ? TEXT.replacedAbove : TEXT.replacedBelow)}</div>`;
}

function messageHtml(message, number, isSubagent) {
  const step = message.step, ts = step?.ts || message.ts;
  // the assistant by name: "Claude", or the product's name for another agent ("Codex")
  const agent = agentOfSession(contextView.sessionId);
  const assistantName = agent === DEFAULT_AGENT ? TEXT.claude : agentName(agent);
  const label = message.role === 'assistant' ? `${iconSvg('model')} ${escapeHtml(assistantName)}`
    : isSubagent ? `${iconSvg('model')} ${escapeHtml(TEXT.taskAndResults)}` : `${iconSvg('you')} ${escapeHtml(TEXT.groups.you)}`;
  const size = step
    ? `${contextBadgeHtml(contextSizeInfo(step.ctx, message.change))} <span class="sz muted">${escapeHtml(TEXT.outX(formatCompactNumber(step.out)))}</span>`
    : `<span class="sz muted">${approxTokensLabel(message.size)}</span>`;
  // the hook events this message matches: its header opens their turn in Details, hovering lights their rows there
  const seqs = message.seqs = hookSeqsOfMessage(message);
  const link = seqs.length ? ` data-seq="${seqs[0]}" title="${escapeHtml(TEXT.showInDetails)}"` : '';
  const attributes = (ts ? ` data-t="${Date.parse(ts)}"` : '') + (seqs.length ? ` data-seqs="${seqs.join(' ')}"` : '') + (step?.model ? ` title="${escapeHtml(step.model)}"` : '');
  return `<div class="cxw ${message.role}"${attributes}><div class="cxl${seqs.length ? ' go' : ''}"${link}>${label} <span class="muted">#${number}${ts ? ' · ' + formatTime(ts) : ''}</span><span class="grow"></span>${size}</div>${message.blocks.join('')}</div>`;
}

// the conversation of the session (in turns) or of a subagent (a plain list of messages)
function contextMessagesHtml(items, idPrefix, searchText, isSubagent = false) {
  const messages = groupIntoMessages(items, idPrefix, searchText);
  const oldestFirst = contextOrder === 'old';
  let number = 0;
  const html = messages.map(message => {
    if (message.compaction) return compactionHtml(message.compaction, oldestFirst);
    number++;
    return message.blocks.length ? messageHtml(message, number, isSubagent) : '';
  });
  if (isSubagent) {
    if (!oldestFirst) html.reverse();
    return html.join('');
  }
  return contextTurnsHtml(messages, html, oldestFirst);
}

// ---- turns
// The turn of Details that a group of messages matches: by the hook events its messages match (the most common wins).
function detailsTurnKeyOf(messages) {
  const votes = new Map();
  for (const message of messages) {
    for (const seq of message.seqs || []) {
      const key = turnBySeq.get(seq)?.key;
      if (key) votes.set(key, (votes.get(key) || 0) + 1);
    }
  }
  return [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

function contextTurnHeaderHtml(group, number, id, key, collapsed) {
  const isSelected = key && key === state.selectedTurnKey;
  const steps = group.messages.filter(message => message.step).length;
  const calls = group.messages.reduce((sum, message) => sum + (message.items || []).filter(item => item.kind === 'call').length, 0);
  const title = escapeHtml(group.prompt != null ? TEXT.turnN(number) : group.messages[0].compaction ? TEXT.afterCompaction : TEXT.beforeFirstPrompt);
  return `<div class="cxth${key ? ' go' : ''}"${key ? ` data-key="${escapeHtml(key)}" title="${escapeHtml(TEXT.showTurnInDetails)}"` : ''}>`
    + `<button class="cxtog" data-cxtt="${escapeHtml(id)}" title="${escapeHtml(collapsed ? TEXT.expandTurn : TEXT.collapseTurn)}" aria-expanded="${!collapsed}"></button>${iconSvg('you')}<b>${title}</b>`
    + `${group.ts ? `<span class="muted">${formatTime(group.ts)}</span>` : ''}<span class="cxtp">${group.prompt != null ? escapeHtml(shorten(group.prompt, 160)) : ''}</span><span class="grow"></span>`
    + `<span class="muted">${escapeHtml(countOf(steps, 'step'))} · ${escapeHtml(countOf(calls, 'toolCall'))}</span>${key ? `<span class="cxtgo">${escapeHtml(isSelected ? TEXT.inDetails : TEXT.detailsGo)}</span>` : ''}</div>`;
}

// The main conversation in turns, the same turns as Details: a turn starts at a prompt and runs to the next one. Each
// turn is a box with a sticky header (its prompt, size, and a link that opens it in Details); the turn Details shows
// is highlighted.
function contextTurnsHtml(messages, messagesHtml, oldestFirst) {
  const groups = [];
  let group = null;
  messages.forEach((message, index) => {
    if (!group || message.prompt != null) groups.push(group = { prompt: message.prompt ?? null, ts: message.ts || message.step?.ts, messages: [], html: [] });
    group.messages.push(message);
    group.html.push(messagesHtml[index]);
  });
  let number = 0;
  const html = groups.map(turnGroup => {
    if (turnGroup.prompt != null) number++;
    if (!turnGroup.html.some(Boolean)) return '';
    const key = detailsTurnKeyOf(turnGroup.messages), isSelected = key && key === state.selectedTurnKey;
    // remembered by when the turn started: stable while hook events load and across the two ranges, unlike its number or key
    const id = 't' + (turnGroup.ts || number), collapsed = collapsedContextTurns.has(id);
    const body = oldestFirst ? turnGroup.html : [...turnGroup.html].reverse();
    return `<section class="cxturn${isSelected ? ' sel' : ''}${collapsed ? ' shut' : ''}" data-cxt="${escapeHtml(id)}"${key ? ` data-tk="${escapeHtml(key)}"` : ''}>${contextTurnHeaderHtml(turnGroup, number, id, key, collapsed)}${body.join('')}</section>`;
  });
  if (!oldestFirst) html.reverse();
  return html.join('');
}

// open or close a turn box in place (no re-render), and remember it for the next one
function setContextTurnCollapsed(section, collapsed) {
  const id = section.dataset.cxt, toggle = section.querySelector(':scope > .cxth > .cxtog');
  if (collapsed) collapsedContextTurns.add(id);
  else collapsedContextTurns.delete(id);
  section.classList.toggle('shut', collapsed);
  if (toggle) {
    toggle.title = collapsed ? TEXT.expandTurn : TEXT.collapseTurn;
    toggle.setAttribute('aria-expanded', String(!collapsed));
  }
}

