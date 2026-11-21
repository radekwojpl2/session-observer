'use strict';
// Session Observer dashboard — Home, its data: every session in the range as a tree (project folder → session →
// its subagents), and the sessions waiting on you. Home shows every session, whatever session is selected.
const FINISHED_SUBAGENTS_SHOWN = 3; // a session's finished subagents beyond these fold into "+N more"

// the sessions Home shows: in the range, from the agents the filter shows, matching the search
function homeSessions() {
  const cutoff = rangeCutoffIso();
  const search = state.searchText;
  return [...state.sessions.values()]
    .filter(session => !cutoff || (session.last || '') >= cutoff)
    .filter(session => isAgentShown(session.agent || DEFAULT_AGENT))
    .filter(session => !search || [session.title, session.cwd, session.id].join(' ').toLowerCase().includes(search));
}

// "D:\repo\" and "D:\repo" are one folder
const projectKey = cwd => String(cwd || '').replace(/[\\/]+$/, '');

// [{ path, sessions }], each project's sessions most urgent first, the projects in the order of their first session
function projectTree(sessions) {
  const byProject = new Map();
  for (const session of [...sessions].sort(byActivityThenRecent)) {
    const key = projectKey(session.cwd);
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key).push(session);
  }
  return [...byProject].map(([path, list]) => ({ path, sessions: list }));
}

// a session's subagents to show: the running ones, then the latest finished ones; and how many finished ones fold
function shownSubagents(session) {
  const list = session.subagentList || [];
  const running = list.filter(subagent => !subagent.ended);
  const finished = list.filter(subagent => subagent.ended).reverse();
  return { subagents: [...running, ...finished.slice(0, FINISHED_SUBAGENTS_SHOWN)], folded: Math.max(0, finished.length - FINISHED_SUBAGENTS_SHOWN) };
}
