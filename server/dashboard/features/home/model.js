'use strict';
// Session Observer dashboard — Home, its data: every session in the range as a tree (project folder → session →
// its subagents), and the sessions waiting on you. Home shows every session, whatever session is selected; the tree
// follows the range, agent filter and search, and the sessions waiting on you don't.
const FINISHED_SUBAGENTS_SHOWN = 3; // a session's finished subagents beyond these fold into "+N more"
const HOME_LINK_DEPTH_MAX = 4; // sessions started by started sessions nest this deep; deeper ones stay at the top

// Search and agent filters apply to both the project tree and pinned sessions.
function homeMatchingSessions() {
  const search = state.searchText;
  return [...state.sessions.values()]
    .filter(session => isAgentShown(session.agent || DEFAULT_AGENT))
    .filter(session => !search || [session.title, session.cwd, session.id].join(' ').toLowerCase().includes(search));
}

// an inactive or ended session: Home folds these into a project's "+N more"
const isPastSession = session => ['inactive', 'ended'].includes(sessionActivity(session));

// which shown sessions nest under the shown session that started them (links.js): { top, startedUnder } — the sessions
// at the top of their project, and parent id → the started sessions under it, oldest first. A current session never
// nests under a past one, so it never hides in a closed "+N more"; and none nests more than HOME_LINK_DEPTH_MAX deep or
// in a loop: those stay at the top, so no shown session is left out.
function homeStartedTree(shown) {
  const shownById = new Map(shown.map(session => [session.id, session]));
  const parentShown = session => {
    const parent = session.parent && shownById.get(session.parent.id);
    return parent && !(isPastSession(parent) && !isPastSession(session)) ? parent : null;
  };
  const nests = session => {
    const seen = new Set([session.id]);
    let depth = 0;
    for (let parent = parentShown(session); parent; parent = parentShown(parent)) {
      if (seen.has(parent.id) || ++depth > HOME_LINK_DEPTH_MAX) return false;
      seen.add(parent.id);
    }
    return depth > 0;
  };
  const top = [], startedUnder = new Map();
  for (const session of [...shown].sort((a, b) => (a.started || '').localeCompare(b.started || ''))) {
    if (!nests(session)) { top.push(session); continue; }
    const parentId = session.parent.id;
    if (!startedUnder.has(parentId)) startedUnder.set(parentId, []);
    startedUnder.get(parentId).push(session);
  }
  return { top, startedUnder };
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
