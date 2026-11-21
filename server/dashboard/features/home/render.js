'use strict';
// Session Observer dashboard — Home: what waits on you, on top, then every agent as a tree: project folder → session
// → its subagents. A row opens its session.
const WAIT_TEXT_MAX = 160;
const SUBAGENT_DESCRIPTION_MAX = 90;
const HOME_DOT = { needsYou: 'dot need', working: 'dot busy', yourTurn: 'dot on', inactive: 'dot', ended: 'dot' };
const homeExpandedProjects = new Set();

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

// one card per session waiting on you, with everything it waits for
function needsYouHtml(sessions) {
  const waiting = sessionsNeedingYou(sessions);
  if (!waiting.length) {
    return `<section class="hsec hneeds hneeds-empty"><span class="hclear-icon" aria-hidden="true">✓</span><span class="muted">${escapeHtml(TEXT.home.allClear)}</span></section>`;
  }
  const cards = waiting.map(session => `<button class="hneed" ${openAttributes(session)}>
      <div class="hrow"><span class="dot need"></span><b class="hname">${escapeHtml(homeSessionName(session))}</b>${homeAgentTag(session)}<span class="muted hpath">${escapeHtml(baseName(session.cwd) || '')}</span></div>
      ${session.needsYou.map(waitHtml).join('')}</button>`).join('');
  return `<section class="hsec hneeds on"><h3>${iconSvg('you')} ${escapeHtml(TEXT.home.needsYou)} <span class="hcount">${waiting.length}</span></h3>${cards}</section>`;
}

function subagentRowHtml(subagent) {
  const running = !subagent.ended;
  const duration = subagent.started ? formatDuration(Date.parse(subagent.ended || new Date().toISOString()) - Date.parse(subagent.started)) : '';
  return `<li class="hsub"><span class="dot ${running ? 'busy' : ''}"></span>${iconSvg('agents')}<b>${escapeHtml(subagent.type || TEXT.subagentLc)}</b>`
    + `<span class="muted">${escapeHtml(shorten(subagent.description || '', SUBAGENT_DESCRIPTION_MAX))}</span><span class="grow"></span>`
    + `<span class="muted">${escapeHtml(running ? TEXT.sessionState.working : TEXT.home.done)}${duration ? ' · ' + escapeHtml(duration) : ''}</span></li>`;
}

function sessionRowHtml(session) {
  const activity = sessionActivity(session);
  const { subagents, folded } = shownSubagents(session);
  const lastTool = activity === 'working' && session.lastTool
    ? `<span class="muted mono hlast">${escapeHtml(toolDisplayName(session.lastTool.name))} ${escapeHtml(shorten(session.lastTool.arg, 60))}</span>` : '';
  const children = subagents.map(subagentRowHtml).join('') + (folded ? `<li class="hsub muted">${escapeHtml(TEXT.home.more(folded))}</li>` : '');
  const name = homeSessionName(session);
  return `<li class="hsess act-${activity} ${session.id === state.scope ? 'sel' : ''}">
      <button class="hsess-main" type="button" ${openAttributes(session)}><span class="${HOME_DOT[activity]}"></span>
        <span class="hsess-content"><span class="hsess-title"><span class="hname" title="${escapeHtml(name)}">${escapeHtml(name)}</span>${homeAgentTag(session)}<span class="hstate">${escapeHtml(TEXT.sessionState[activity])}</span></span>
        <span class="hsess-meta">${escapeHtml(countOf(session.turns || 0, 'turn'))}${session.last ? ` · ${escapeHtml(formatAgo(session.last))}` : ''}${lastTool}</span></span></button>
      ${children ? `<ul>${children}</ul>` : ''}</li>`;
}

function projectHtml(project) {
  const name = baseName(project.path) || project.path || '?';
  const current = project.sessions.filter(session => !['inactive', 'ended'].includes(sessionActivity(session)));
  const past = project.sessions.filter(session => ['inactive', 'ended'].includes(sessionActivity(session)));
  const projectId = projectKey(project.path);
  const openPast = state.searchText || past.some(session => session.id === state.scope) || homeExpandedProjects.has(projectId) ? ' open' : '';
  const archived = past.length
    ? `<li class="harchive"><details data-home-project="${escapeHtml(projectId)}"${openPast}><summary>${escapeHtml(TEXT.home.more(past.length))}</summary><ul>${past.map(sessionRowHtml).join('')}</ul></details></li>`
    : '';
  const repository = project.sessions.find(session => session.repositoryUrl)?.repositoryUrl;
  const repoLink = repository ? `<a class="hrepo" href="${escapeHtml(repository)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(TEXT.home.openRepository)}">GitHub ↗</a>` : '';
  return `<li class="hproj"><div class="hrow">${iconSvg('files')}<b>${escapeHtml(name)}</b><span class="muted mono hpath" title="${escapeHtml(project.path)}">${escapeHtml(project.path)}</span>${repoLink}</div>
    <ul>${current.map(sessionRowHtml).join('')}${archived}</ul></li>`;
}

function homeViewHtml() {
  const sessions = homeSessions();
  const tree = sessions.length
    ? `<ul class="htree">${projectTree(sessions).map(projectHtml).join('')}</ul>`
    : `<div class="cempty">${escapeHtml(TEXT.home.noSessions)}</div>`;
  return `<div class="home">${needsYouHtml(sessions)}<section class="hsec hsessions"><div class="home-heading"><h2>${escapeHtml(TEXT.sessions)}</h2><span class="muted">${sessions.length}</span></div>${tree}</section></div>`;
}
