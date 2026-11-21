'use strict';
// Session Observer dashboard — Chat view: the conversation as a messenger.
const CHAT_TURNS_MAX = 150;
let chatScroll = { turnKey: null, atBottom: true, top: 0 };

// a little markdown for the agent's replies: fenced code, `inline code`, **bold**
function markdownLiteHtml(source) {
  const parts = String(source ?? '').split(/```[\w-]*\n?([\s\S]*?)(?:```|$)/);
  return parts.map((part, index) => {
    const isCode = index % 2 === 1;
    if (isCode) return `<pre>${escapeHtml(part.replace(/\n$/, ''))}</pre>`;
    return escapeHtml(part).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  }).join('').trim();
}

// A tool chip is written before its result arrives, so it carries two placeholders, filled in once the result is
// known: its state class ("run" / "fail" / nothing) and the result's seq (added to its data-seqs).
const chipStatePlaceholder = toolUseId => `__R${toolUseId || ''}__`;
const chipResultPlaceholder = toolUseId => `__S${toolUseId || ''}__`;
const removeUnfilledPlaceholders = html => html.replace(/__R\S*?__(?=[\s"])/g, '').replace(/__S\S*?__(?=")/g, '');

// the events the chat shows: the main agent's, plus subagents starting and stopping
const isShownInChat = event => (!event.data?.subagent && event.data?.agent_id == null) || event.event === 'SubagentStart' || event.event === 'SubagentStop';

function chatSessionHeader(sessionId) {
  const session = state.sessions.get(sessionId);
  const name = stripTags(session?.title) || baseName(session?.cwd) || sessionId.slice(0, 8);
  return `<div class="csess">${escapeHtml(truncateToColumns(name, 60))}</div>`;
}

function chatTurnHeader(turn) {
  const classes = [state.selectedTurnKey === turn.key && 'sel', anyFilterActive() && !turnMatchesFilters(turn) && 'dim'].filter(Boolean).join(' ');
  const summary = `${formatTime(turn.start)}${turn.toolCount ? ' · ' + escapeHtml(countOf(turn.toolCount, 'tool')) : ''}${turn.problemCount ? ' · ✕' + turn.problemCount : ''}`;
  return `<div class="cturn ${classes}" data-tk="${escapeHtml(turn.key)}"><div class="cth" data-key="${escapeHtml(turn.key)}" title="${escapeHtml(TEXT.openTurn)}">${summary}</div>`;
}

const chipHtml = (event, { classes = '', seqs = event.seq, color, icon, body }) =>
  `<span class="ctool${classes ? ' ' + classes : ''}" data-seq="${event.seq}" data-seqs="${seqs}"${color ? ` style="--c:var(--s-${color})"` : ''} title="${eventTooltip(event)}">${icon}<span>${body}</span></span>`;

function toolCallChip(event) {
  const data = event.data || {}, group = toolGroupOfEvent(event) || 'other';
  const argument = group === 'files' ? baseName(String(toolArgument(data) || '')) : shorten(toolArgument(data), 60);
  return chipHtml(event, {
    classes: chipStatePlaceholder(data.tool_use_id),
    seqs: `${event.seq}${chipResultPlaceholder(data.tool_use_id)}`,
    color: group,
    icon: eventIconHtml(event, group),
    body: `<b>${escapeHtml(toolDisplayName(data.tool_name))}</b> ${escapeHtml(truncateToColumns(argument, 40))}`,
  });
}

const subagentChip = (event, word) => chipHtml(event, {
  color: 'agents', icon: iconSvg('agents'),
  body: `<b>${escapeHtml(event.data?.agent_type || TEXT.subagentLc)}</b> ${escapeHtml(word)}`,
});

const bubbleTime = ts => `<span class="bt">${formatTime(ts)}</span>`;

// One turn as bubbles and chips, added to chat.html. A text bubble belongs to the model step it came from: hovering /
// clicking it reaches that step's row in Details. A tool result can come in a later turn (a background command): its
// placeholders are filled in the whole chat written so far.
function addChatTurn(chat, turn, limit) {
  const stepSeqByMessage = new Map(turn.events.filter(event => event.event === 'ModelStep' && event.data?.msg_id).map(event => [event.data.msg_id, event.seq]));
  const seqsOfText = event => [event.seq, stepSeqByMessage.get(event.data?.msg_id)].filter(seq => seq != null).join(' ');
  const runningToolIds = new Set();
  let chips = [], modelSaidSomething = false, stopEvent = null;
  chat.html += chatTurnHeader(turn);

  const flushChips = () => {
    if (chips.length) chat.html += `<div class="ctools">${chips.join('')}</div>`;
    chips = [];
  };
  // fill a placeholder in the chips not yet written out and in the chat already written
  const fill = (placeholder, value) => {
    chips = chips.map(chip => chip.replace(placeholder, value));
    chat.html = chat.html.replace(placeholder, value);
  };

  for (const event of turn.events.filter(candidate => eventTime(candidate) <= limit && isShownInChat(candidate))) {
    const data = event.data || {};
    switch (event.event) {
      case 'UserPromptSubmit':
        flushChips();
        chat.html += `<div class="bub me" data-seq="${event.seq}" data-seqs="${event.seq}">${escapeHtml(data.prompt)}${bubbleTime(event.ts)}</div>`;
        break;
      case 'ModelText': {
        const text = String(data.text || '').trim();
        if (!text) break;
        flushChips();
        const seqAttributes = `data-seq="${stepSeqByMessage.get(data.msg_id) ?? event.seq}" data-seqs="${seqsOfText(event)}"`;
        if (data.kind === 'thinking') {
          chat.html += `<div class="bub think" ${seqAttributes}>${escapeHtml(text)}</div>`;
        } else {
          modelSaidSomething = true;
          chat.html += `<div class="bub ai ${agentClass(event)}" ${seqAttributes}>${markdownLiteHtml(text)}${bubbleTime(event.ts)}</div>`;
        }
        break;
      }
      case 'PreToolUse':
        chips.push(toolCallChip(event));
        if (data.tool_use_id) runningToolIds.add(data.tool_use_id);
        break;
      case 'PostToolUse': case 'PostToolUseFailure':
        if (data.tool_use_id) {
          runningToolIds.delete(data.tool_use_id);
          fill(chipResultPlaceholder(data.tool_use_id), ' ' + event.seq);
        }
        if (event.event === 'PostToolUseFailure') fill(`__R${data.tool_use_id}__`, 'fail');
        break;
      case 'SubagentStart': chips.push(subagentChip(event, TEXT.event.started)); break;
      case 'SubagentStop': chips.push(subagentChip(event, TEXT.event.done)); break;
      case 'PermissionDenied':
        chips.push(chipHtml(event, { classes: 'fail', icon: iconSvg('you'), body: `${escapeHtml(TEXT.event.deniedLc)} ${escapeHtml(toolDisplayName(data.tool_name))}` }));
        break;
      case 'Stop': case 'StopFailure': stopEvent = event; break;
    }
  }
  flushChips();
  chat.html += finalReplyBubble(stopEvent, modelSaidSomething);
  if (!stopEvent && isTurnRunning(turn) && state.replayCursor == null) {
    chat.html += `<div class="ctyping"><span class="dot busy"></span>${escapeHtml(TEXT.agentWorking(agentName(agentOfSession(turn.sessionId))))}</div>`;
  }
  chat.html += '</div>';
  // tool chips still open are running; the rest are plain
  for (const toolUseId of runningToolIds) chat.html = chat.html.replace(chipStatePlaceholder(toolUseId), 'run');
}

// the hook's final message, when the transcript text never arrived
function finalReplyBubble(stopEvent, modelSaidSomething) {
  if (!stopEvent || modelSaidSomething) return '';
  const failed = stopEvent.event === 'StopFailure';
  if (!stopEvent.data?.last_assistant_message && !failed) return '';
  const text = stopEvent.data?.last_assistant_message || stopEvent.data?.error || TEXT.event.turnFailedLc;
  return `<div class="bub ai ${agentClass(stopEvent)} ${failed ? 'fail' : ''}" data-seq="${stopEvent.seq}" data-seqs="${stopEvent.seq}">${markdownLiteHtml(text)}${bubbleTime(stopEvent.ts)}</div>`;
}

function chatViewHtml() {
  const limit = replayLimit(), showsSessionNames = state.scope === ALL_SESSIONS;
  const turns = allTurns.filter(turn => eventTime(turn.events[0]) <= limit).slice(-CHAT_TURNS_MAX);
  if (!turns.length) return `<div class="chat"><div class="cempty">${TEXT.noConversation}</div></div>`;
  const chat = { html: '<div class="chat">' };
  let lastSessionId = null;
  for (const turn of turns) {
    if (showsSessionNames && turn.sessionId !== lastSessionId) chat.html += chatSessionHeader(turn.sessionId);
    lastSessionId = turn.sessionId;
    addChatTurn(chat, turn, limit);
  }
  return removeUnfilledPlaceholders(chat.html) + '</div>';
}
