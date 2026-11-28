'use strict';
// Session Observer dashboard — Overview: stat tiles, then charts and lists for the session (or all activity).
// Charts are drawn in px: measured card widths by chart, so the next draw matches its card.
let measuredChartWidths = {};

const statTileHtml = (label, value, note, isBad) =>
  `<div class="tile ${isBad ? 'bad' : ''}"><div class="l">${label}</div><div class="v">${escapeHtml(value)}</div>${note ? `<div class="s">${escapeHtml(note)}</div>` : ''}</div>`;
// a card of the Overview: a title, a note beside it, and its body
const overviewCardHtml = (title, note, body, isWide) =>
  `<div class="vcard ${isWide ? 'wide' : ''}"><div class="vh">${title}<span>${note || ''}</span></div>${body}</div>`;
// text for the floating tooltip (overview/controls.js shows it)
const tooltipAttribute = text => `data-tip="${escapeHtml(text)}"`;

function overviewChartsHtml(session, filterNote) {
  const width = measuredChartWidths.turns || Math.max(300, (elementById('mid').clientWidth || 700) - 30);
  const turns = allTurns.filter(turnMatchesFilters), events = state.events.filter(eventMatchesFilters);
  return '<div class="viz">'
    + turnChartHtml(turns, width, filterNote)
    + (session ? contextChartHtml(session, measuredChartWidths.ctx || Math.max(300, width / 2 - 14)) : '')
    + toolGroupCardsHtml()
    + filesListHtml(events) + commandsListHtml(events) + subagentsListHtml(events) + problemsListHtml(events)
    + '</div>';
}

const sumOf = (sessions, field) => sessions.reduce((total, session) => total + (session[field] || 0), 0);

// the estimated cost at API prices, for one session or several; – when none of their steps has a price
function costTileHtml(sessions) {
  const costs = sessions.map(sessionCostOf).filter(cost => cost !== null);
  const note = sessions.some(isCostPartial) ? TEXT.costPartial : TEXT.costNote;
  return statTileHtml(TEXT.tiles.cost, costs.length ? formatUsd(costs.reduce((total, cost) => total + cost, 0)) : '–', costs.length ? note : '');
}

function allActivityHtml(filterNote) {
  const cutoff = rangeCutoffIso();
  const sessions = [...state.sessions.values()].filter(session => !cutoff || (session.last || '') >= cutoff);
  const outputTokens = sessions.reduce((total, session) => total + (session.usage?.output || 0), 0);
  const labels = TEXT.tiles, failures = sumOf(sessions, 'failures');
  return `<h2>${escapeHtml(TEXT.allActivity)}</h2><p class="lead">${escapeHtml(TEXT.allLead(selectedRangeLabel()))}</p>
      <div class="tiles">${statTileHtml(labels.sessions, sessions.length)}${statTileHtml(labels.turns, sumOf(sessions, 'turns'))}${statTileHtml(labels.toolCalls, sumOf(sessions, 'toolCalls'))}${statTileHtml(labels.modelSteps, sumOf(sessions, 'modelSteps'))}${statTileHtml(labels.problems, failures, labels.failedOrDenied, failures > 0)}${statTileHtml(labels.outputTokens, formatCompactNumber(outputTokens))}${costTileHtml(sessions)}</div>
      ${overviewChartsHtml(null, filterNote)}`;
}

function sessionLeadHtml(session) {
  const [status, dotClass] = sessionStatus(session);
  return `<span class="state"><span class="${dotClass}"></span>${status}</span> · <span class="mono">${escapeHtml(session.cwd || '')}</span> · ${escapeHtml(session.model || '')}`
    + (session.permission_mode ? ' · ' + escapeHtml(session.permission_mode) : '')
    + ` · <span class="mono">${escapeHtml(session.id.slice(0, 8))}</span>`
    + (session.ended && session.endReason ? ' · ' + escapeHtml(TEXT.endedX(session.endReason)) : '');
}

// the agent session that started this one, and the ones it started (links.js), or ''
function sessionLinksHtml(session) {
  const parent = parentSessionOf(session), children = childSessionsOf(session);
  const startedBy = parent ? `<div class="slinks"><span class="muted">${escapeHtml(TEXT.startedBy)}</span>${sessionLinkHtml(parent)}</div>` : '';
  const started = children.length ? `<div class="slinks"><span class="muted">${escapeHtml(TEXT.startedSessions(children.length))}</span>${children.map(sessionLinkHtml).join('')}</div>` : '';
  return startedBy + started;
}

function sessionTilesHtml(session) {
  const labels = TEXT.tiles, usage = session.usage || {}, context = session.context;
  const totalTokens = (usage.input || 0) + (usage.cache_read || 0) + (usage.cache_write || 0);
  return `${statTileHtml(labels.turns, session.turns || 0)}${statTileHtml(labels.toolCalls, session.toolCalls, TEXT.inTools(formatDuration(session.toolMs)))}${statTileHtml(labels.modelSteps, session.modelSteps || 0)}${statTileHtml(labels.subagents, session.subagents || 0)}${statTileHtml(labels.problems, session.failures, '', session.failures > 0)}
        ${statTileHtml(labels.duration, formatDuration(Date.parse(session.last) - Date.parse(session.started)))}`
    + statTileHtml(labels.context, context ? Math.round(context.pct * 100) + '%' : '–', context ? `${formatCompactNumber(context.tokens)} / ${formatCompactNumber(context.window)}` : '')
    + statTileHtml(labels.tokens, formatCompactNumber(totalTokens), TEXT.tokSub(formatCompactNumber(usage.output || 0)))
    + costTileHtml([session]);
}

function sessionOverviewHtml(session, filterNote) {
  return `<h2>${escapeHtml(shorten(stripTags(session.title) || baseName(session.cwd) || session.id, TITLE_PREVIEW_MAX))}</h2>
      <p class="lead">${sessionLeadHtml(session)}</p>${sessionLinksHtml(session)}
      <div class="tiles">${sessionTilesHtml(session)}</div>
      ${overviewChartsHtml(session, filterNote)}`;
}

// if a chart's card turned out a different width than estimated, remember the real one; true when any did
function measureChartWidths(container) {
  let changed = false;
  for (const chart of container.querySelectorAll('svg.vchart[data-w]')) {
    const width = Math.round(chart.getBoundingClientRect().width);
    if (width && Math.abs(width - Number(chart.dataset.w)) > 4) {
      measuredChartWidths[chart.dataset.k] = width;
      changed = true;
    }
  }
  return changed;
}

function renderOverview(isSecondPass) {
  if (state.view !== 'overview') return;
  const container = elementById('mid'), scrollTop = container.scrollTop;
  const filterNote = anyFilterActive() ? ` <span class="muted">· ${escapeHtml(TEXT.filtered)}</span>` : '';
  if (state.scope === ALL_SESSIONS) {
    container.innerHTML = withAnimationPhase(allActivityHtml(filterNote), performance.now());
  } else {
    const session = state.sessions.get(state.scope);
    if (!session) {
      container.innerHTML = `<div class="empty">${escapeHtml(TEXT.sessionNotFound)}</div>`;
      return;
    }
    container.innerHTML = withAnimationPhase(sessionOverviewHtml(session, filterNote), performance.now());
  }
  container.scrollTop = scrollTop;
  // charts are drawn in px: if a card turned out a different width than estimated, draw again at the real width
  if (measureChartWidths(container) && !isSecondPass) renderOverview(true);
}
