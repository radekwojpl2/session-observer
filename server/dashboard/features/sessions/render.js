'use strict';
// Session Observer dashboard — the sessions panel: All activity, and each session in the range with a hover card.
// [state word, dot class] for each activity (session-activity.js)
const SESSION_STATUS = {
  needsYou: () => [TEXT.sessionState.needsYou, 'dot need'],
  working: () => [TEXT.sessionState.working, 'dot busy'],
  yourTurn: () => [TEXT.sessionState.live, 'dot on'],
  inactive: () => [TEXT.sessionState.inactive, 'dot'],
  ended: () => [TEXT.sessionState.ended, 'dot'],
};
const sessionStatus = session => SESSION_STATUS[sessionActivity(session)]();

const sessionName = session => stripTags(session.title) || baseName(session.cwd) || session.id.slice(0, 8);

// the sessions in the range that match the search (the selected one always), newest first
function visibleSessions() {
  const cutoff = rangeCutoffIso();
  const matchesSearch = session => !state.searchText
    || ((session.title || '') + ' ' + (session.cwd || '') + ' ' + session.id).toLowerCase().includes(state.searchText)
    || state.scope === session.id;
  return [...state.sessions.values()]
    .filter(session => !cutoff || (session.last || '') >= cutoff)
    .filter(session => isAgentShown(session.agent || DEFAULT_AGENT) || state.scope === session.id)
    .filter(matchesSearch)
    .sort((a, b) => (b.last || '').localeCompare(a.last || ''));
}

function selectedRangeLabel() {
  const option = elementById('range').selectedOptions[0];
  return option ? option.textContent : '';
}

// a badge colored by agent, so Claude Code and Codex sessions tell apart at a glance
const agentBadgeHtml = (agent, className) =>
  `<span class="${className} agent-${agentKey(agent)}">${escapeHtml(agentName(agent))}</span>`;

function sessionChipsHtml(session) {
  return agentBadgeHtml(session.agent, 'chip')
    + (session.cwd ? `<span class="chip" title="${escapeHtml(session.cwd)}">${iconSvg('files')}${escapeHtml(baseName(session.cwd) || '?')}</span>` : '')
    + (session.model ? `<span class="chip">${escapeHtml(session.model)}</span>` : '')
    + (session.subagents ? `<span class="chip">${iconSvg('agents')}${session.subagents}</span>` : '')
    + (session.failures ? `<span class="chip"><span class="x">✕ ${session.failures}</span></span>` : '')
    + (session.context ? `<span class="chip" title="${escapeHtml(TEXT.ctxWindow)}">${escapeHtml(TEXT.ctxShort)} ${formatCompactNumber(session.context.tokens)}</span>` : '');
}

// The list shows the state dot, the title, and under it when and where; the rest is in a card that floats beside it on hover.
// The agent badge shows only when the list has sessions of more than one agent.
function sessionCardHtml(session, showAgent) {
  const [status, dotClass] = sessionStatus(session);
  const outputTokens = session.usage ? session.usage.output : 0;
  const lastTool = !session.ended && session.lastTool
    ? `<div class="meta">${escapeHtml(TEXT.lastLbl)} <b>${escapeHtml(toolDisplayName(session.lastTool.name))}</b> <span class="mono">${escapeHtml(shorten(session.lastTool.arg, 60))}</span></div>` : '';
  const name = escapeHtml(sessionName(session));
  const agentTag = showAgent ? agentBadgeHtml(session.agent, 'agent-tag') : '';
  const where = [session.last ? formatAgo(session.last) : '', baseName(session.cwd || '')].filter(Boolean).join(' · ');
  const meta = `${session.last ? escapeHtml(formatAgo(session.last)) : ''} · ${escapeHtml(countOf(session.turns || 0, 'turn'))} · ${escapeHtml(countOf(session.toolCalls || 0, 'tool'))}`
    + (outputTokens ? ` · ${escapeHtml(TEXT.outX(formatCompactNumber(outputTokens)))}` : '');
  return `<div class="card ${session.id === state.scope ? 'sel' : ''}" data-id="${escapeHtml(session.id)}">
        <div class="row1"><span class="${dotClass}" title="${status}"></span><span class="name">${name}</span>${agentTag}<button class="session-delete" type="button" data-delete-session="${escapeHtml(session.id)}" title="${escapeHtml(TEXT.deleteSessionTitle)}" aria-label="${escapeHtml(TEXT.deleteSessionTitle)}">×</button></div>
        ${where ? `<div class="sline">${escapeHtml(where)}</div>` : ''}
        <template class="sdet"><div class="row1"><span class="name">${name}</span><span class="state"><span class="${dotClass}"></span>${status}</span></div>
        <div class="meta">${meta}</div>${lastTool}
        <div class="chips">${sessionChipsHtml(session)}</div></template>
      </div>`;
}

// older day folders stay on disk until asked for
function olderSessionsHtml() {
  const { loadedFrom, olderDays } = state.history;
  if (!loadedFrom || !olderDays) return '';
  return `<button class="load-older" type="button" data-load-older title="${escapeHtml(TEXT.loadOlderTitle)}">${escapeHtml(TEXT.loadOlderSessions(loadedFrom))}</button>`;
}

function renderSessions() {
  // the agent filter shows once there is more than one agent to choose from (or one is chosen)
  elementById('agentFilter').style.display = seesSeveralAgents() || state.agent ? '' : 'none';
  const sessions = visibleSessions();
  const showAgent = new Set(sessions.map(session => session.agent || DEFAULT_AGENT)).size > 1;
  const panel = elementById('sessions'), scrollTop = panel.scrollTop;
  panel.innerHTML = `
    <div class="card ${state.scope === ALL_SESSIONS ? 'sel' : ''}" data-id="all">
      <div class="row1"><span class="name">${escapeHtml(TEXT.allActivity)}</span></div>
      <div class="meta">${escapeHtml(TEXT.everySession)}</div>
    </div>
    <div class="sect">${escapeHtml(TEXT.sessions)} <span>${sessions.length}</span></div>
    <div class="sess-list">${sessions.map(session => sessionCardHtml(session, showAgent)).join('') || `<div class="empty">${escapeHtml(TEXT.noSessions)}</div>`}</div>${olderSessionsHtml()}`;
  panel.scrollTop = scrollTop;
  renderSessionHoverCard(); // the list was rebuilt: refresh (or hide) the hover card
}

// The hover card: one floating box beside the list (a box inside the list would be clipped by its scrolling).
let hoveredSessionId = null;

function sessionHoverCard() {
  return elementById('sesstip') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'sesstip' }));
}

function renderSessionHoverCard() {
  const hoverCard = sessionHoverCard();
  const card = hoveredSessionId && elementById('sessions').querySelector(`.card[data-id="${CSS.escape(hoveredSessionId)}"]`);
  const details = card?.querySelector('template.sdet');
  if (!details) {
    hoverCard.style.display = 'none';
    return;
  }
  hoverCard.innerHTML = details.innerHTML;
  hoverCard.style.display = 'block';
  const cardBox = card.getBoundingClientRect(), hoverBox = hoverCard.getBoundingClientRect();
  hoverCard.style.left = Math.min(innerWidth - hoverBox.width - 8, cardBox.right + 8) + 'px';
  hoverCard.style.top = Math.max(8, Math.min(innerHeight - hoverBox.height - 8, cardBox.top)) + 'px';
}

function hoverSession(sessionId) {
  if (sessionId === hoveredSessionId) return;
  hoveredSessionId = sessionId;
  renderSessionHoverCard();
}

