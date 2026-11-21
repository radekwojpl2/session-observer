'use strict';
// Session Observer dashboard — Route view, around the drawing: the turn's header, the scroll box and the turn navigator.

// What a running turn is doing right now: running tools on the main line, subagents still working, a permission
// prompt waiting on you, or — with nothing else in flight — the model generating its next step.
function describeRouteActivity(model, now) {
  if (!model) return '';
  const parts = [];
  const runningBranches = [...model.branches.values()].filter(branch => !branch.closed && branch.running);
  for (const stop of model.stops) {
    if (!stop.running || stop.onBranch) continue;
    const what = `${stop.label}${stop.detail ? ' ' + truncateToColumns(baseName(String(stop.detail)), 40) : ''}`;
    parts.push(TEXT.runningX(what, formatDuration(now - stop.startedAt)));
  }
  if (runningBranches.length) parts.push(TEXT.subagentsWorking(runningBranches.length));
  const lastMainStop = model.lastMainStopIndex != null ? model.stops[model.lastMainStopIndex] : null;
  if (!parts.length) {
    parts.push(lastMainStop?.label === TEXT.event.permission ? TEXT.waitingPermission : TEXT.modelGenerating(formatDuration(Math.max(0, now - model.lastEventTime))));
  }
  return parts.join(' · ');
}

function routeStateHtml(isLive, endEvent) {
  if (isLive) return `<span class="dot busy"></span>${escapeHtml(TEXT.running)}`;
  if (!endEvent) return `<span class="dot"></span>${escapeHtml(TEXT.unfinished)}`;
  if (endEvent.event === 'StopFailure') return `<span class="err">✕</span> ${escapeHtml(TEXT.failedLc)}`;
  if (endEvent.event === 'Interrupt') return `<span class="muted">■</span> ${escapeHtml(TEXT.interrupted)}`;
  return `<span style="color:var(--ok)">✓</span> ${escapeHtml(TEXT.event.done)}`;
}

// live: what it is doing now, and the latest thing the model wrote in this turn
function routeNowHtml(model) {
  const now = displayTime();
  const written = model.lastText
    ? ` · “${escapeHtml(shorten(model.lastText.text, 220))}” <span class="muted">${escapeHtml(TEXT.ago(formatAge(now - model.lastText.ts)))}</span>` : '';
  return `<div class="la"><b>${escapeHtml(TEXT.nowLbl)}</b> <span class="act">${escapeHtml(describeRouteActivity(model, now))}</span>${written}</div>`;
}

function routeHeaderHtml(turn, model, isLive, sessionTurns, limit) {
  const prompt = turn.prompt !== null ? escapeHtml(shorten(stripTags(turn.prompt), 240)) : `<span class="muted">${escapeHtml(TEXT.sessionStart)}</span>`;
  const subagents = model.branches.size;
  const counts = `${escapeHtml(countOf(model.stepCount, 'step'))} · ${escapeHtml(countOf(model.toolCount, 'tool'))}${subagents ? ` · ${escapeHtml(countOf(subagents, 'subagent'))}` : ''}`;
  const problems = model.problemCount ? `·<span class="err">${escapeHtml(countOf(model.problemCount, 'problem'))}</span>` : '';
  return `<div class="lhead${isLive ? ' live' : ''}"><div class="lp">${prompt}</div>
    <div class="lm"><span class="state">${routeStateHtml(isLive, model.endEvent)}</span>·<span>${escapeHtml(baseName(state.sessions.get(turn.sessionId)?.cwd))}</span>·<span>${formatTime(turn.start)}</span>·<span>${counts}</span>${contextBadgeHtml(turnContextInfo(sessionTurns, turn, limit))}${problems}
</div>${isLive ? routeNowHtml(model) : ''}</div>`;
}

// previous / next turn, position, and a way back to the live (latest) turn
function turnNavigatorHtml(turn, pinned, sessionTurns) {
  const index = sessionTurns.indexOf(turn);
  const navButton = (target, label) => (target
    ? `<button class="seg" data-key="${escapeHtml(target.key)}" title="${escapeHtml(formatTime(target.start) + ' · ' + shorten(target.prompt ?? TEXT.sessionStart, 120))}">${label}</button>`
    : `<button class="seg" disabled>${label}</button>`);
  const position = TEXT.turnOf('<b style="color:var(--text)">' + (index + 1) + '</b>', sessionTurns.length);
  const follow = pinned
    ? `<button class="seg" data-follow>${escapeHtml(TEXT.backToLatest)}</button>`
    : `<span class="muted"><span class="dot busy"></span> ${escapeHtml(TEXT.showingLatest)}</span>`;
  return `<div class="lhist">${navButton(sessionTurns[index - 1], escapeHtml(TEXT.prevTurn))}<span class="muted">${position}</span>${navButton(sessionTurns[index + 1], escapeHtml(TEXT.nextTurn))}
    <span class="grow"></span>${follow}</div>`;
}

// header + scroll box + turn navigator around a drawn route
function routeFrameHtml({ focused, pinned, sessionTurns, models, limit, boxHeight, svg, focusedY }) {
  const model = models.get(focused.key) || buildRouteModel(focused, limit);
  const isLive = !model.endEvent && (state.replayCursor != null || isTurnRunning(focused));
  const scrollHeight = boxHeight - (isLive ? 70 : 50) - 48;
  return routeHeaderHtml(focused, model, isLive, sessionTurns, limit)
    + `<div class="mscroll" data-focus="${escapeHtml(focused.key)}" data-fy="${isFinite(focusedY) ? focusedY : 0}" style="height:${scrollHeight}px">${svg}</div>`
    + turnNavigatorHtml(focused, pinned, sessionTurns);
}
