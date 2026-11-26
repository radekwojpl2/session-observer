'use strict';
// Session Observer dashboard — Home: what waits on you, on top, then every agent as a tree: project folder → session
// → its subagents, and the agent sessions it started (Claude Code running Codex, or Codex Claude Code). A row opens its
// session.
const WAIT_TEXT_MAX = 160;
const SUBAGENT_DESCRIPTION_MAX = 90;
const HOME_DOT = { needsYou: 'dot need', working: 'dot busy', yourTurn: 'dot on', inactive: 'dot', ended: 'dot' };
const homePastShown = new Map(); // project → whether you opened (true) or closed (false) its past sessions

const homeSessionName = session => stripTags(session.title) || baseName(session.cwd) || session.id.slice(0, 8);
const homeAgentTag = session => `<span class="agent-tag agent-${agentKey(session.agent)}">${escapeHtml(agentName(session.agent))}</span>`;
const openAttributes = session => `data-home-session="${escapeHtml(session.id)}" title="${escapeHtml(TEXT.home.open)}"`;

function waitTitle(wait) {
  if (wait.kind === 'permission') return TEXT.home.permission(wait.tool ? toolDisplayName(wait.tool) : '');
  if (wait.kind === 'mcp') return TEXT.home.mcp(wait.tool || '');
  return TEXT.home.question;
}

function waitHtml(wait) {
  const where = wait.agentType || wait.agentId != null ? ` <span class="muted">· ${escapeHtml(TEXT.home.inSubagent(wait.agentType || ''))}</span>` : '';
  return `<div class="hwait hwait-${escapeHtml(wait.kind)}">${iconSvg('you')}<b>${escapeHtml(waitTitle(wait))}</b>${where}`
    + `<span class="grow"></span><span class="muted">${wait.since ? escapeHtml(formatAgo(wait.since)) : ''}</span>`
    + (wait.text ? `<div class="hwait-text mono">${escapeHtml(shorten(wait.text, WAIT_TEXT_MAX))}</div>` : '') + '</div>';
}

// one card per session waiting on you, with everything it waits for: every loaded session, whatever the range, agent
// filter or search (as the header counts them), so a wait is never hidden
function needsYouHtml(sessions) {
  const waiting = sessionsNeedingYou(sessions);
  if (!waiting.length) {
    return `<section class="hsec hneeds hneeds-empty"><span class="hclear-icon" aria-hidden="true">✓</span><span class="muted">${escapeHtml(TEXT.home.allClear)}</span></section>`;
  }
  const cards = waiting.map(session => `<div class="hneed">
      <button class="hneed-open" type="button" ${openAttributes(session)}>
        <div class="hrow"><span class="dot need"></span><b class="hname">${escapeHtml(homeSessionName(session))}</b>${homeAgentTag(session)}<span class="muted hpath">${escapeHtml(baseName(session.cwd) || '')}</span></div>
        ${session.needsYou.map(waitHtml).join('')}
      </button>
    </div>`).join('');
  return `<section class="hsec hneeds on"><h3>${iconSvg('you')} ${escapeHtml(TEXT.home.needsYou)} <span class="hcount">${waiting.length}</span></h3>${cards}</section>`;
}

function subagentRowHtml(subagent) {
  const running = !subagent.ended;
  const duration = subagent.started ? formatDuration(Date.parse(subagent.ended || new Date().toISOString()) - Date.parse(subagent.started)) : '';
  return `<li class="hsub"><span class="dot ${running ? 'busy' : ''}"></span>${iconSvg('agents')}<b>${escapeHtml(subagent.type || TEXT.subagentLc)}</b>`
    + `<span class="muted">${escapeHtml(shorten(subagent.description || '', SUBAGENT_DESCRIPTION_MAX))}</span><span class="grow"></span>`
    + `<span class="muted">${escapeHtml(running ? TEXT.sessionState.working : TEXT.home.done)}${duration ? ' · ' + escapeHtml(duration) : ''}</span></li>`;
}

// a session's row, with the agent sessions it started that nest under it (homeStartedTree) and its subagents
function sessionRowHtml(session, startedUnder) {
  const compact = !startedUnder;
  const activity = sessionActivity(session);
  const lastTool = activity === 'working' && session.lastTool
    ? `<span class="muted mono hlast">${escapeHtml(toolDisplayName(session.lastTool.name))} ${escapeHtml(shorten(session.lastTool.arg, 60))}</span>` : '';
  let children = '';
  if (startedUnder) {
    const { subagents, folded } = shownSubagents(session);
    children = (startedUnder.get(session.id) || []).map(child => sessionRowHtml(child, startedUnder)).join('')
      + subagents.map(subagentRowHtml).join('')
      + (folded ? `<li class="hsub muted">${escapeHtml(TEXT.home.more(folded))}</li>` : '');
  }
  const name = homeSessionName(session);
  const project = compact && session.cwd ? `<span class="hpath" title="${escapeHtml(session.cwd)}">· ${escapeHtml(baseName(session.cwd) || session.cwd)}</span>` : '';
  return `<li class="hsess act-${activity} ${session.id === state.scope ? 'sel' : ''}">
      <button class="hsess-main" type="button" ${openAttributes(session)}><span class="${HOME_DOT[activity]}"></span>
        <span class="hsess-content"><span class="hsess-title"><span class="hname" title="${escapeHtml(name)}">${escapeHtml(name)}</span>${homeAgentTag(session)}<span class="hstate">${escapeHtml(TEXT.sessionState[activity])}</span></span>
        <span class="hsess-meta">${escapeHtml(countOf(session.turns || 0, 'turn'))}${session.last ? ` · ${escapeHtml(formatAgo(session.last))}` : ''}${project}${lastTool}</span></span></button>
      ${sessionPinHtml(session, 'home-session-pin')}
      ${compact ? '' : `<button class="home-session-delete" type="button" data-delete-session="${escapeHtml(session.id)}" title="${escapeHtml(TEXT.deleteSessionTitle)}" aria-label="${escapeHtml(TEXT.deleteSessionTitle)}">×</button>`}
      ${children ? `<ul>${children}</ul>` : ''}</li>`;
}

function projectHtml(project, startedUnder) {
  const name = baseName(project.path) || project.path || '?';
  const current = project.sessions.filter(session => !isPastSession(session));
  const past = project.sessions.filter(isPastSession);
  const projectId = projectKey(project.path);
  // open when you opened it, or, unless you closed it, while a search runs or it holds the selected session
  const shown = homePastShown.get(projectId) ?? (!!state.searchText || past.some(session => session.id === state.scope));
  const openPast = shown ? ' open' : '';
  const archived = past.length
    ? `<li class="harchive"><details data-home-project="${escapeHtml(projectId)}"${openPast}><summary>${escapeHtml(TEXT.home.more(past.length))}</summary><ul>${past.map(session => sessionRowHtml(session, startedUnder)).join('')}</ul></details></li>`
    : '';
  return `<li class="hproj"><div class="hrow">${iconSvg('files')}<b>${escapeHtml(name)}</b><span class="muted mono hpath" title="${escapeHtml(project.path)}">${escapeHtml(project.path)}</span></div>
    <ul>${current.map(session => sessionRowHtml(session, startedUnder)).join('')}${archived}</ul></li>`;
}

function homeViewHtml() {
  const matching = homeMatchingSessions();
  const cutoff = rangeCutoffIso();
  const shown = matching.filter(session => !cutoff || (session.last || '') >= cutoff);
  const pinned = matching.filter(session => session.pinned).sort(byActivityThenRecent);
  const pins = pinned.length
    ? `<section class="hsec hpins"><div class="home-heading"><h2>${escapeHtml(TEXT.home.pinned)}</h2><span class="muted">${pinned.length}</span></div><ul class="htree">${pinned.map(session => sessionRowHtml(session)).join('')}</ul></section>` : '';
  // a session started by another one Home shows sits under it, not at the top of its project
  const { top, startedUnder } = homeStartedTree(shown);
  const tree = top.length
    ? `<ul class="htree">${projectTree(top).map(project => projectHtml(project, startedUnder)).join('')}</ul>`
    : `<div class="cempty">${escapeHtml(TEXT.home.noSessions)}</div>`;
  return `<div class="home">${needsYouHtml([...state.sessions.values()])}${pins}<section class="hsec hsessions"><div class="home-heading"><h2>${escapeHtml(TEXT.sessions)}</h2><span class="muted">${shown.length}</span></div>${tree}</section></div>`;
}
